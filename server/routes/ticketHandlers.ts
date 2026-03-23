import type { Context } from 'hono'
import { z } from 'zod'
import { db as appDb } from '../db/index'
import { profiles } from '../db/schema'
import { PROFILE_DEFAULTS } from '../db/defaults'
import {
  createTicketActor,
  ensureActorForTicket,
  sendTicketEvent,
  getTicketState,
  stopActor,
} from '../machines/persistence'
import { abortTicketSessions } from '../opencode/sessionManager'
import { clearContextCache } from '../opencode/contextBuilder'
import { isMockOpenCodeMode } from '../opencode/factory'
import { broadcaster } from '../sse/broadcaster'
import { appendLogEvent } from '../log/executionLog'
import { cancelTicket, handleInterviewQABatch, processInterviewBatchAsync, skipAllInterviewQuestionsToApproval } from '../workflow/runner'
import { createTicket as createTicketRecord } from '../ticket/create'
import { TicketInitializationError, initializeTicket } from '../ticket/initialize'
import { getProjectContextById } from '../storage/projects'
import { validateModelSelection } from '../opencode/modelValidation'
import {
  getLatestPhaseArtifact,
  getTicketByRef,
  getTicketContext,
  getTicketPaths,
  deleteTicket as deleteStoredTicket,
  listPhaseArtifacts,
  listTickets,
  lockTicketStartConfiguration,
  updateTicket,
  upsertLatestPhaseArtifact,
} from '../storage/tickets'
import { parseCompiledInterviewArtifact } from '../phases/interview/compiled'
import {
  buildInterviewQuestionViews,
  INTERVIEW_SESSION_ARTIFACT,
  parseInterviewSessionSnapshot,
  serializeInterviewSessionSnapshot,
  updateInterviewAnswer,
} from '../phases/interview/sessionState'
import type { InterviewDocument } from '@shared/interviewArtifact'
import {
  approveInterviewDocument,
  readInterviewDocument,
  saveInterviewAnswerUpdates,
  saveInterviewRawContent,
} from '../phases/interview/finalDocument'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const createTicketSchema = z.object({
  projectId: z.number().int().positive(),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  priority: z.number().int().min(1).max(5).optional(),
})

export const updateTicketSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  priority: z.number().int().min(1).max(5).optional(),
})

const uiStateScopeSchema = z.object({
  scope: z.string().min(1).max(80).regex(/^[a-zA-Z0-9:_-]+$/),
})

const upsertUiStateSchema = z.object({
  scope: z.string().min(1).max(80).regex(/^[a-zA-Z0-9:_-]+$/),
  data: z.unknown(),
})

export const interviewAnswerPayloadSchema = z.object({
  answers: z.record(z.string(), z.string()).default({}),
  selectedOptions: z.record(z.string(), z.array(z.string())).optional().default({}),
})

export const editAnswerSchema = z.object({
  questionId: z.string().min(1),
  answer: z.string(),
})

const interviewApprovalAnswerSchema = z.object({
  questions: z.array(z.object({
    id: z.string().min(1),
    answer: z.object({
      skipped: z.boolean(),
      selected_option_ids: z.array(z.string()).default([]),
      free_text: z.string(),
    }),
  })).min(1),
})

const rawInterviewSaveSchema = z.object({
  content: z.string(),
})

import { MAX_UI_STATE_BYTES } from '../lib/constants'

const UI_STATE_PHASE = 'UI_STATE'
const UI_STATE_ARTIFACT_PREFIX = 'ui_state:'

function uiStateArtifactType(scope: string): string {
  return `${UI_STATE_ARTIFACT_PREFIX}${scope}`
}

function readUiState(ticketId: string, scope: string): { data: unknown; updatedAt: string | null } | null {
  const artifact = getLatestPhaseArtifact(ticketId, uiStateArtifactType(scope), UI_STATE_PHASE)
  if (!artifact) return null

  try {
    const parsed = JSON.parse(artifact.content) as { data?: unknown; updatedAt?: string | null }
    if (parsed && typeof parsed === 'object' && 'data' in parsed) {
      return {
        data: parsed.data,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : artifact.createdAt,
      }
    }
    return { data: parsed, updatedAt: artifact.createdAt }
  } catch {
    return { data: null, updatedAt: artifact.createdAt }
  }
}

function upsertUiState(ticketId: string, scope: string, data: unknown): { updatedAt: string } {
  const now = new Date().toISOString()
  const payload = JSON.stringify({ data, updatedAt: now })
  if (Buffer.byteLength(payload, 'utf8') > MAX_UI_STATE_BYTES) {
    throw new Error(`UI state payload exceeds ${MAX_UI_STATE_BYTES} bytes`)
  }

  upsertLatestPhaseArtifact(ticketId, uiStateArtifactType(scope), UI_STATE_PHASE, payload)
  return { updatedAt: now }
}

function getProfileDefaults() {
  return appDb.select().from(profiles).get()
}

function respondWithState(c: Context, ticketId: string, message: string) {
  const updated = getTicketByRef(ticketId)
  const state = getTicketState(ticketId)
  return c.json({
    message,
    ticketId,
    status: state?.state ?? updated?.status,
    state: state?.state,
    ...(updated ? { ticket: updated } : {}),
  })
}

function getTicketParam(c: Context): string {
  return c.req.param('id') || c.req.param('ticketId')
}

function buildInterviewPayload(ticketId: string): {
  winnerId: string | null
  raw: string | null
  document: InterviewDocument | null
  session: ReturnType<typeof parseInterviewSessionSnapshot>
  questions: ReturnType<typeof buildInterviewQuestionViews>
} {
  const sessionArtifact = getLatestPhaseArtifact(ticketId, INTERVIEW_SESSION_ARTIFACT)
  const session = parseInterviewSessionSnapshot(sessionArtifact?.content)
  const questions = session ? buildInterviewQuestionViews(session) : []

  let document: InterviewDocument | null = null
  let raw: string | null = null
  try {
    const parsed = readInterviewDocument(ticketId)
    document = parsed.document
    raw = parsed.raw
  } catch {
    raw = null
  }

  if (!raw) {
    const ticketPaths = getTicketPaths(ticketId)
    const canonicalInterviewPath = ticketPaths ? resolve(ticketPaths.ticketDir, 'interview.yaml') : null
    if (canonicalInterviewPath && existsSync(canonicalInterviewPath)) {
      try {
        raw = readFileSync(canonicalInterviewPath, 'utf-8')
      } catch {
        raw = null
      }
    }
  }

  const artifact = getLatestPhaseArtifact(ticketId, 'interview_compiled')
  if (!artifact) {
    return {
      winnerId: session?.winnerId ?? null,
      raw,
      document,
      session,
      questions,
    }
  }

  try {
    const parsed = parseCompiledInterviewArtifact(artifact.content)
    return {
      raw: raw ?? parsed.refinedContent,
      document,
      winnerId: session?.winnerId ?? parsed.winnerId,
      session,
      questions,
    }
  } catch {
    return {
      raw: raw ?? artifact.content,
      document,
      winnerId: session?.winnerId ?? null,
      session,
      questions,
    }
  }
}

function approveSpecific(
  ticketId: string,
  expectedStatus: string,
  failureMessage: string,
  successMessage: string,
): { type: 'success'; message: string } | { type: 'response'; body: { error: string; details?: string }; status: 404 | 409 | 500 } {
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return { type: 'response' as const, body: { error: 'Ticket not found' }, status: 404 }
  if (ticket.status !== expectedStatus) {
    return { type: 'response' as const, body: { error: failureMessage }, status: 409 }
  }

  try {
    ensureActorForTicket(ticketId)
    sendTicketEvent(ticketId, { type: 'APPROVE' })
  } catch (err) {
    console.error(`[tickets] Failed to approve ${ticketId}:`, err)
    return { type: 'response' as const, body: { error: `Failed to approve ticket`, details: String(err) }, status: 500 }
  }

  return { type: 'success' as const, message: successMessage }
}

export function handleListTickets(c: Context) {
  const projectId = c.req.query('project') ?? c.req.query('projectId')
  const parsedProjectId = projectId ? Number(projectId) : undefined
  if (projectId && Number.isNaN(parsedProjectId)) {
    return c.json({ error: 'Invalid project ID' }, 400)
  }
  return c.json(listTickets(parsedProjectId))
}

export function handleGetTicket(c: Context) {
  const ticket = getTicketByRef(c.req.param('id'))
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  return c.json(ticket)
}

export function handleGetUiState(c: Context) {
  const ticketId = getTicketParam(c)
  const parsed = uiStateScopeSchema.safeParse({ scope: c.req.query('scope') ?? '' })
  if (!parsed.success) {
    return c.json({ error: 'Invalid scope', details: parsed.error.flatten() }, 400)
  }

  if (!getTicketByRef(ticketId)) return c.json({ error: 'Ticket not found' }, 404)

  const state = readUiState(ticketId, parsed.data.scope)
  if (!state) {
    return c.json({
      scope: parsed.data.scope,
      exists: false,
      data: null,
      updatedAt: null,
    })
  }

  return c.json({
    scope: parsed.data.scope,
    exists: true,
    data: state.data,
    updatedAt: state.updatedAt,
  })
}

export async function handlePutUiState(c: Context) {
  const ticketId = getTicketParam(c)
  const body = await c.req.json().catch(() => ({}))
  const parsed = upsertUiStateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid UI state payload', details: parsed.error.flatten() }, 400)
  }

  if (!getTicketByRef(ticketId)) return c.json({ error: 'Ticket not found' }, 404)

  try {
    const result = upsertUiState(ticketId, parsed.data.scope, parsed.data.data)
    return c.json({ success: true, scope: parsed.data.scope, updatedAt: result.updatedAt })
  } catch (err) {
    return c.json({ error: 'Failed to persist UI state', details: String(err) }, 500)
  }
}

export async function handleCreateTicket(c: Context) {
  const body = await c.req.json()
  const parsed = createTicketSchema.safeParse(body)
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors
    const message = Object.entries(fieldErrors)
      .map(([field, errors]) => `${field}: ${(errors as string[]).join(', ')}`)
      .join('; ')
    return c.json({ error: 'Invalid input', details: parsed.error.flatten(), message }, 400)
  }

  let result: ReturnType<typeof createTicketRecord>
  try {
    result = createTicketRecord(parsed.data)
  } catch (err) {
    if (err instanceof Error && err.message === 'Project not found') {
      return c.json({ error: 'Project not found' }, 404)
    }
    return c.json({ error: 'Failed to create ticket', details: String(err) }, 500)
  }

  const projectContext = getProjectContextById(result.projectId)
  const profile = getProfileDefaults()
  createTicketActor(result.id, {
    ticketId: result.id,
    projectId: result.projectId,
    externalId: result.externalId,
    title: result.title,
    maxIterations: projectContext?.project.maxIterations ?? profile?.maxIterations ?? undefined,
  })

  return c.json(getTicketByRef(result.id) ?? result, 201)
}

export async function handlePatchTicket(c: Context) {
  const ticketId = getTicketParam(c)
  const body = await c.req.json()

  if ('status' in body) {
    return c.json({ error: 'Status field is API-protected. Use workflow actions to change status.' }, 403)
  }

  const parsed = updateTicketSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.flatten() }, 400)
  }

  const existing = getTicketByRef(ticketId)
  if (!existing) return c.json({ error: 'Ticket not found' }, 404)

  const result = updateTicket(ticketId, parsed.data)
  return c.json(result ?? existing)
}

export async function handleDeleteTicket(c: Context) {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (!['COMPLETED', 'CANCELED'].includes(ticket.status)) {
    return c.json({ error: 'Only completed or canceled tickets can be deleted' }, 409)
  }

  try {
    cancelTicket(ticketId)
    stopActor(ticketId)
    await abortTicketSessions(ticketId)
    clearContextCache(ticketId)
    broadcaster.clearTicket(ticketId)

    const deleted = deleteStoredTicket(ticketId)
    if (!deleted) return c.json({ error: 'Ticket not found' }, 404)

    return c.json({ success: true, ticketId })
  } catch (err) {
    console.error(`[tickets] Failed to delete ticket ${ticketId}:`, err)
    return c.json({ error: 'Failed to delete ticket', details: String(err) }, 500)
  }
}

export async function handleStartTicket(c: Context) {
  const ticketId = getTicketParam(c)
  const ticketContext = getTicketContext(ticketId)
  if (!ticketContext) return c.json({ error: 'Ticket not found' }, 404)
  if (ticketContext.localTicket.status !== 'DRAFT') {
    return c.json({ error: 'Ticket can only be started from DRAFT status' }, 409)
  }

  const profile = getProfileDefaults()
  const councilRaw = ticketContext.localProject.councilMembers ?? profile?.councilMembers ?? null
  let modelSelection
  try {
    modelSelection = await validateModelSelection(profile?.mainImplementer, councilRaw)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Invalid model configuration' }, 400)
  }

  let init: ReturnType<typeof initializeTicket>
  try {
    init = initializeTicket({
      externalId: ticketContext.externalId,
      projectFolder: ticketContext.projectRoot,
    })
  } catch (err) {
    const initErr = err instanceof TicketInitializationError
      ? err
      : new TicketInitializationError('INIT_UNKNOWN', err instanceof Error ? err.message : String(err))

    try {
      ensureActorForTicket(ticketId)
      sendTicketEvent(ticketId, {
        type: 'INIT_FAILED',
        message: initErr.message,
        codes: [initErr.code],
      })
    } catch (sendErr) {
      console.error(`[tickets] Failed to send INIT_FAILED to ticket ${ticketId}:`, sendErr)
      return c.json({ error: 'Failed to block ticket after initialization error', details: String(sendErr) }, 500)
    }

    const updated = getTicketByRef(ticketId)
    const state = getTicketState(ticketId)
    return c.json({
      message: 'Start blocked during initialization',
      ticketId,
      status: updated?.status,
      state: state?.state,
      details: initErr.message,
      codes: [initErr.code],
    })
  }

  const lockedInterviewQuestions = ticketContext.localProject.interviewQuestions
    ?? profile?.interviewQuestions
    ?? PROFILE_DEFAULTS.interviewQuestions
  const lockedCoverageFollowUpBudgetPercent = profile?.coverageFollowUpBudgetPercent
    ?? PROFILE_DEFAULTS.coverageFollowUpBudgetPercent
  const lockedMaxCoveragePasses = profile?.maxCoveragePasses
    ?? PROFILE_DEFAULTS.maxCoveragePasses
  const lockedMainImplementerVariant = profile?.mainImplementerVariant ?? null
  const lockedCouncilMemberVariants: Record<string, string> | null = profile?.councilMemberVariants
    ? (typeof profile.councilMemberVariants === 'string'
      ? JSON.parse(profile.councilMemberVariants)
      : profile.councilMemberVariants)
    : null
  const startedAt = new Date().toISOString()

  try {
    const lockedTicket = lockTicketStartConfiguration(ticketId, {
      branchName: init.branchName,
      startedAt,
      lockedMainImplementer: modelSelection.mainImplementer,
      lockedMainImplementerVariant: lockedMainImplementerVariant,
      lockedCouncilMembers: modelSelection.councilMembers,
      lockedCouncilMemberVariants: lockedCouncilMemberVariants,
      lockedInterviewQuestions,
      lockedCoverageFollowUpBudgetPercent,
      lockedMaxCoveragePasses,
    })
    if (!lockedTicket) return c.json({ error: 'Ticket not found' }, 404)
  } catch (err) {
    return c.json({
      error: 'Failed to persist ticket start configuration',
      details: err instanceof Error ? err.message : String(err),
    }, 500)
  }

  try {
    ensureActorForTicket(ticketId)
    sendTicketEvent(ticketId, {
      type: 'START',
      lockedMainImplementer: modelSelection.mainImplementer,
      lockedMainImplementerVariant: lockedMainImplementerVariant,
      lockedCouncilMembers: modelSelection.councilMembers,
      lockedCouncilMemberVariants: lockedCouncilMemberVariants,
      lockedInterviewQuestions,
      lockedCoverageFollowUpBudgetPercent,
      lockedMaxCoveragePasses,
    })
  } catch (err) {
    console.error(`[tickets] Failed to send START to ticket ${ticketId}:`, err)
    return c.json({ error: 'Failed to start ticket', details: String(err) }, 500)
  }

  return respondWithState(c, ticketId, 'Start action accepted')
}

export function handleApproveTicket(c: Context) {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)

  const approvalStates = ['WAITING_INTERVIEW_APPROVAL', 'WAITING_PRD_APPROVAL', 'WAITING_BEADS_APPROVAL', 'WAITING_MANUAL_VERIFICATION']
  if (!approvalStates.includes(ticket.status)) {
    return c.json({ error: 'Ticket is not in an approval state' }, 409)
  }

  if (ticket.status === 'WAITING_INTERVIEW_APPROVAL') {
    return handleApproveInterview(c)
  }

  try {
    ensureActorForTicket(ticketId)
    sendTicketEvent(ticketId, { type: 'APPROVE' })
  } catch (err) {
    console.error(`[tickets] Failed to send APPROVE to ticket ${ticketId}:`, err)
    return c.json({ error: 'Failed to approve ticket', details: String(err) }, 500)
  }

  return respondWithState(c, ticketId, 'Approve action accepted')
}

export function handleCancelTicket(c: Context) {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (['COMPLETED', 'CANCELED'].includes(ticket.status)) {
    return c.json({ error: 'Cannot cancel a terminal ticket' }, 409)
  }

  try {
    ensureActorForTicket(ticketId)
    sendTicketEvent(ticketId, { type: 'CANCEL' })
    cancelTicket(ticketId)
    abortTicketSessions(ticketId).catch(err => {
      console.error(`[tickets] Failed to abort sessions for ticket ${ticketId}:`, err)
    })
  } catch (err) {
    console.error(`[tickets] Failed to send CANCEL to ticket ${ticketId}:`, err)
    return c.json({ error: 'Failed to cancel ticket', details: String(err) }, 500)
  }

  return respondWithState(c, ticketId, 'Cancel action accepted')
}

export async function handleAnswerTicket(c: Context) {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  return c.json({
    error: 'Direct interview answer submission is no longer supported. Use /answer-batch instead.',
    ticketId,
    status: ticket.status,
  }, 410)
}

export async function handleSkipTicket(c: Context) {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'WAITING_INTERVIEW_ANSWERS') {
    return c.json({ error: 'Ticket is not waiting for interview answers' }, 409)
  }

  try {
    const body = await c.req.json().catch(() => ({}))
    const parsed = interviewAnswerPayloadSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid answers payload', details: parsed.error.flatten() }, 400)
    }

    ensureActorForTicket(ticketId)
    skipAllInterviewQuestionsToApproval(ticketId, parsed.data.answers)

    try {
      await abortTicketSessions(ticketId)
    } catch (err) {
      console.warn(`[tickets] Failed to abort interview sessions for ${ticketId} after skip-all:`, err)
    }

    sendTicketEvent(ticketId, { type: 'SKIP_ALL_TO_APPROVAL' })
  } catch (err) {
    console.error(`[tickets] Failed to skip remaining interview questions for ticket ${ticketId}:`, err)
    return c.json({ error: 'Failed to skip remaining interview questions', details: String(err) }, 500)
  }

  return respondWithState(c, ticketId, 'Remaining interview questions skipped')
}

export async function handleAnswerBatch(c: Context) {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'WAITING_INTERVIEW_ANSWERS') {
    return c.json({ error: 'Ticket is not waiting for interview answers' }, 409)
  }

  try {
    const body = await c.req.json().catch(() => ({}))
    const parsed = interviewAnswerPayloadSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid answers payload', details: parsed.error.flatten() }, 400)
    }

    // Determine if the batch needs a slow AI call (PROM4) or can be handled fast
    const sessionArt = getLatestPhaseArtifact(ticketId, INTERVIEW_SESSION_ARTIFACT)
    const session = parseInterviewSessionSnapshot(sessionArt?.content)
    const isCoverageBatch = session?.currentBatch?.source === 'coverage'
    const needsAsyncProcessing = !isMockOpenCodeMode() && !isCoverageBatch

    if (needsAsyncProcessing) {
      // ASYNC path: return 202 immediately, process AI call in background.
      // handleInterviewQABatch persists the intermediate state (answers saved,
      // currentBatch cleared) synchronously before its first await, so the
      // snapshot is consistent by the time we return.
      ensureActorForTicket(ticketId)
      sendTicketEvent(ticketId, { type: 'BATCH_ANSWERED', batchAnswers: parsed.data.answers, selectedOptions: parsed.data.selectedOptions })

      processInterviewBatchAsync(ticketId, parsed.data.answers, session!, parsed.data.selectedOptions)
        .then(result => {
          ensureActorForTicket(ticketId)
          if (result.isComplete) {
            sendTicketEvent(ticketId, { type: 'INTERVIEW_COMPLETE' })
          } else {
            broadcaster.broadcast(ticketId, 'needs_input', {
              ticketId,
              type: 'interview_batch',
              batch: result,
            })
          }
        })
        .catch(err => {
          console.error(`[tickets] Async batch processing failed for ${ticketId}:`, err)
          broadcaster.broadcast(ticketId, 'needs_input', {
            ticketId,
            type: 'interview_error',
            error: err instanceof Error ? err.message : String(err),
          })
        })

      return c.json({ accepted: true }, 202)
    }

    // SYNC path: mock mode or coverage batches (fast, no AI call)
    const result = await handleInterviewQABatch(ticketId, parsed.data.answers, parsed.data.selectedOptions)
    ensureActorForTicket(ticketId)
    if (result.isComplete) {
      sendTicketEvent(ticketId, { type: 'INTERVIEW_COMPLETE' })
    } else {
      sendTicketEvent(ticketId, { type: 'BATCH_ANSWERED', batchAnswers: parsed.data.answers, selectedOptions: parsed.data.selectedOptions })
    }

    return c.json({
      questions: result.questions,
      progress: result.progress,
      isComplete: result.isComplete,
      isFinalFreeForm: result.isFinalFreeForm,
      aiCommentary: result.aiCommentary,
      batchNumber: result.batchNumber,
      ...('source' in result && typeof result.source === 'string' ? { source: result.source } : {}),
      ...('roundNumber' in result && typeof result.roundNumber === 'number' ? { roundNumber: result.roundNumber } : {}),
    })
  } catch (err) {
    console.error(`[tickets] Failed to process answer-batch for ticket ${ticketId}:`, err)
    return c.json({ error: 'Failed to process batch', details: String(err) }, 500)
  }
}

export async function handleEditAnswer(c: Context) {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'WAITING_INTERVIEW_ANSWERS') {
    return c.json({ error: 'Ticket is not waiting for interview answers' }, 409)
  }

  try {
    const body = await c.req.json().catch(() => ({}))
    const parsed = editAnswerSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400)
    }

    const sessionArt = getLatestPhaseArtifact(ticketId, INTERVIEW_SESSION_ARTIFACT)
    const session = parseInterviewSessionSnapshot(sessionArt?.content)
    if (!session) {
      return c.json({ error: 'No interview session found' }, 404)
    }

    const { questionId, answer } = parsed.data
    if (!session.answers[questionId]) {
      return c.json({ error: `No existing answer for question ${questionId}` }, 404)
    }

    const updated = updateInterviewAnswer(session, questionId, answer)
    upsertLatestPhaseArtifact(
      ticketId,
      INTERVIEW_SESSION_ARTIFACT,
      'WAITING_INTERVIEW_ANSWERS',
      serializeInterviewSessionSnapshot(updated),
    )

    const questions = buildInterviewQuestionViews(updated)
    return c.json({ success: true, questions })
  } catch (err) {
    console.error(`[tickets] Failed to edit interview answer for ticket ${ticketId}:`, err)
    return c.json({ error: 'Failed to edit answer', details: String(err) }, 500)
  }
}

export async function handlePutInterviewAnswers(c: Context) {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'WAITING_INTERVIEW_APPROVAL') {
    return c.json({ error: 'Ticket is not waiting for interview approval' }, 409)
  }

  const body = await c.req.json().catch(() => ({}))
  const parsed = interviewApprovalAnswerSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid interview answer payload', details: parsed.error.flatten() }, 400)
  }

  try {
    saveInterviewAnswerUpdates(ticketId, parsed.data.questions)
    return c.json({
      success: true,
      ...buildInterviewPayload(ticketId),
    })
  } catch (err) {
    return c.json({
      error: 'Failed to save interview answers',
      details: err instanceof Error ? err.message : String(err),
    }, 400)
  }
}

export async function handlePutInterview(c: Context) {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'WAITING_INTERVIEW_APPROVAL') {
    return c.json({ error: 'Ticket is not waiting for interview approval' }, 409)
  }

  const body = await c.req.json().catch(() => ({}))
  const parsed = rawInterviewSaveSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid interview document payload', details: parsed.error.flatten() }, 400)
  }

  try {
    saveInterviewRawContent(ticketId, parsed.data.content)
    return c.json({
      success: true,
      ...buildInterviewPayload(ticketId),
    })
  } catch (err) {
    return c.json({
      error: 'Failed to save interview document',
      details: err instanceof Error ? err.message : String(err),
    }, 400)
  }
}

export function handleApproveInterview(c: Context) {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'WAITING_INTERVIEW_APPROVAL') {
    return c.json({ error: 'Ticket is not waiting for interview approval' }, 409)
  }

  try {
    approveInterviewDocument(ticketId)
    ensureActorForTicket(ticketId)

    const phase = 'WAITING_INTERVIEW_APPROVAL'
    const message = '[SYS] Interview approved by user.'
    const timestamp = new Date().toISOString()
    broadcaster.broadcast(ticketId, 'log', { ticketId, phase, type: 'info', content: message, timestamp, source: 'system' })
    appendLogEvent(ticketId, 'info', phase, message, { ticketId, timestamp }, 'system', phase, { audience: 'all', kind: 'milestone', op: 'append', streaming: false })

    sendTicketEvent(ticketId, { type: 'APPROVE' })
  } catch (err) {
    console.error(`[tickets] Failed to approve interview for ${ticketId}:`, err)
    return c.json({
      error: 'Failed to approve interview',
      details: err instanceof Error ? err.message : String(err),
    }, 500)
  }

  return respondWithState(c, ticketId, 'Interview approved')
}

export function handleApprovePrd(c: Context) {
  const result = approveSpecific(
    getTicketParam(c),
    'WAITING_PRD_APPROVAL',
    'Ticket is not waiting for PRD approval',
    'PRD approved',
  )
  const ticketId = getTicketParam(c)
  if (result.type === 'response') return c.json(result.body, result.status)
  return respondWithState(c, ticketId, result.message)
}

export function handleApproveBeads(c: Context) {
  const result = approveSpecific(
    getTicketParam(c),
    'WAITING_BEADS_APPROVAL',
    'Ticket is not waiting for beads approval',
    'Beads approved',
  )
  const ticketId = getTicketParam(c)
  if (result.type === 'response') return c.json(result.body, result.status)
  return respondWithState(c, ticketId, result.message)
}

export function handleVerifyTicket(c: Context) {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'WAITING_MANUAL_VERIFICATION') {
    return c.json({ error: 'Ticket is not waiting for manual verification' }, 409)
  }

  try {
    ensureActorForTicket(ticketId)
    sendTicketEvent(ticketId, { type: 'VERIFY_COMPLETE' })
  } catch (err) {
    console.error(`[tickets] Failed to send VERIFY_COMPLETE to ticket ${ticketId}:`, err)
    return c.json({ error: 'Failed to verify completion', details: String(err) }, 500)
  }

  return respondWithState(c, ticketId, 'Verification complete')
}

export function handleRetryTicket(c: Context) {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'BLOCKED_ERROR') {
    return c.json({ error: 'Retry only works from BLOCKED_ERROR state' }, 409)
  }

  try {
    ensureActorForTicket(ticketId)
    sendTicketEvent(ticketId, { type: 'RETRY' })
  } catch (err) {
    console.error(`[tickets] Failed to send RETRY to ticket ${ticketId}:`, err)
    return c.json({ error: 'Failed to retry ticket', details: String(err) }, 500)
  }

  return respondWithState(c, ticketId, 'Retry action accepted')
}

export async function handleDevEvent(c: Context) {
  const ticketId = getTicketParam(c)
  if (!getTicketByRef(ticketId)) return c.json({ error: 'Ticket not found' }, 404)

  try {
    const body = await c.req.json()
    sendTicketEvent(ticketId, body)
  } catch (err) {
    console.error(`[tickets] dev-event failed for ticket ${ticketId}:`, err)
    return c.json({ error: String(err) }, 500)
  }

  const updated = getTicketByRef(ticketId)
  const state = getTicketState(ticketId)
  return c.json({ ticketId, status: updated?.status, state: state?.state })
}

export function handleGetInterview(c: Context) {
  const ticketId = getTicketParam(c)
  if (!getTicketByRef(ticketId)) return c.json({ error: 'Ticket not found' }, 404)
  return c.json(buildInterviewPayload(ticketId))
}

export function handleGetArtifacts(c: Context) {
  const ticketId = getTicketParam(c)
  if (!getTicketByRef(ticketId)) return c.json({ error: 'Ticket not found' }, 404)
  return c.json(listPhaseArtifacts(ticketId))
}
