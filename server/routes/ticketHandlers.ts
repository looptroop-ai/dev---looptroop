import type { Context } from 'hono'
import { z } from 'zod'
import { buildOpenCodeQuestionLogIdentity, type OpenCodeQuestionLogAction } from '@shared/logIdentity'
import type { TicketContext as MachineTicketContext } from '../machines/types'
import { db as appDb } from '../db/index'
import { profiles } from '../db/schema'
import { PROFILE_DEFAULTS } from '../db/defaults'
import {
  createTicketActor,
  ensureActorForTicket,
  revertTicketToApprovalStatus,
  sendTicketEvent,
  getTicketState,
  stopActor,
} from '../machines/persistence'
import { abortTicketSessions, listOpenCodeSessionsForTicket } from '../opencode/sessionManager'
import { clearContextCache } from '../opencode/contextBuilder'
import { getOpenCodeAdapter, isMockOpenCodeMode } from '../opencode/factory'
import { broadcaster } from '../sse/broadcaster'
import { appendLogEvent } from '../log/executionLog'
import { cancelTicket, handleInterviewQABatch, processInterviewBatchAsync, skipAllInterviewQuestionsToApproval } from '../workflow/runner'
import { createTicket as createTicketRecord } from '../ticket/create'
import { TicketInitializationError, initializeTicket } from '../ticket/initialize'
import { withCommandLogging } from '../log/commandLogger'
import { getProjectContextById } from '../storage/projects'
import { validateModelSelection } from '../opencode/modelValidation'
import {
  findProjectExecutionBandConflict,
  getLatestPhaseArtifact,
  getTicketByRef,
  getTicketContext,
  getTicketPaths,
  patchTicket,
  deleteTicket as deleteStoredTicket,
  listPhaseArtifacts,
  listPhaseAttempts,
  listTickets,
  lockTicketStartConfiguration,
  archiveActivePhaseAttempts,
  createFreshPhaseAttempts,
  INTERVIEW_EDIT_RESTART_PHASES,
  PRD_EDIT_RESTART_PHASES,
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
import {
  approvePrdDocument,
  savePrdStructuredContent,
  savePrdRawContent,
} from '../phases/prd/document'
import { approveBeadsDocument } from '../phases/beads/document'
import {
  approveExecutionSetupPlan,
  readExecutionSetupPlan,
  saveExecutionSetupPlan,
  saveExecutionSetupPlanRawContent,
} from '../phases/executionSetupPlan/document'
import type { ExecutionSetupPlan } from '../phases/executionSetupPlan/types'
import { serializeExecutionSetupPlan } from '../phases/executionSetupPlan/types'
import {
  completeCloseUnmerged,
  completeMergedPullRequest,
  readPullRequestReport,
  refreshPullRequestReport,
  refreshPullRequestState,
  type PullRequestReport,
} from '../workflow/phases/pullRequestPhase'
import type { PrdDocument } from '../structuredOutput/types'
import { isBeforeExecution, isStatusAtOrPast } from '@shared/workflowMeta'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { recoverCodingBeadWithReset } from '../workflow/phases/beadsPhase'
import { regenerateExecutionSetupPlanDraft } from '../workflow/phases/executionSetupPlanPhase'
import { isExecutionBandStatus } from '../workflow/executionBand'
import { normalizeExecutionSetupPlanOutput } from '../structuredOutput'

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

const rawPrdSaveSchema = z.object({
  content: z.string(),
})

const structuredPrdSaveSchema = z.object({
  document: z.custom<PrdDocument>((value) => Boolean(value) && typeof value === 'object', {
    message: 'document must be an object',
  }),
})

const rawExecutionSetupPlanSaveSchema = z.object({
  content: z.string(),
})

const structuredExecutionSetupPlanSaveSchema = z.object({
  plan: z.custom<ExecutionSetupPlan>((value) => Boolean(value) && typeof value === 'object', {
    message: 'plan must be an object',
  }),
})

const regenerateExecutionSetupPlanSchema = z.object({
  commentary: z.string().trim().min(1),
  plan: z.custom<ExecutionSetupPlan>((value) => value === undefined || (Boolean(value) && typeof value === 'object'), {
    message: 'plan must be an object when provided',
  }).optional(),
  rawContent: z.string().optional(),
})

const opencodeQuestionReplySchema = z.object({
  answers: z.array(z.array(z.string())),
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

function emitRoutePhaseLog(
  ticketId: string,
  phase: string,
  type: 'info' | 'error',
  content: string,
  data?: Record<string, unknown>,
) {
  const timestamp = new Date().toISOString()
  const source = type === 'error' ? 'error' : 'system'
  const kind = type === 'error' ? 'error' : 'milestone'
  const payload = {
    ticketId,
    phase,
    type,
    content,
    source,
    audience: 'all' as const,
    kind,
    op: 'append' as const,
    streaming: false,
    timestamp,
    ...(data ?? {}),
  }

  broadcaster.broadcast(ticketId, 'log', payload)
  appendLogEvent(
    ticketId,
    type,
    phase,
    content,
    data ? { ticketId, ...data, timestamp } : { ticketId, timestamp },
    source,
    phase,
    {
      audience: 'all',
      kind,
      op: 'append',
      streaming: false,
    },
  )
}

function emitOpenCodeQuestionLog(
  ticketId: string,
  phase: string,
  content: string,
  data: {
    requestId: string
    sessionId?: string
    modelId?: string
    kind?: 'session' | 'error'
    type?: 'info' | 'error'
    action: OpenCodeQuestionLogAction
  },
) {
  const timestamp = new Date().toISOString()
  const logType = data.type ?? (data.kind === 'error' ? 'error' : 'info')
  const source = data.kind === 'error' ? 'error' : data.modelId ? `model:${data.modelId}` as const : 'opencode'
  const identity = buildOpenCodeQuestionLogIdentity({
    sessionId: data.sessionId,
    requestId: data.requestId,
    action: data.action,
  })
  const payload = {
    ticketId,
    phase,
    type: logType,
    content,
    source,
    audience: 'ai' as const,
    kind: data.kind ?? 'session',
    op: 'append' as const,
    streaming: false,
    entryId: identity.entryId,
    fingerprint: identity.fingerprint,
    ...(data.modelId ? { modelId: data.modelId } : {}),
    ...(data.sessionId ? { sessionId: data.sessionId } : {}),
    timestamp,
  }

  broadcaster.broadcast(ticketId, 'log', payload)
  appendLogEvent(
    ticketId,
    logType,
    phase,
    content,
    { ticketId, requestId: data.requestId, fingerprint: identity.fingerprint, timestamp },
    source,
    phase,
    {
      audience: 'ai',
      kind: data.kind ?? 'session',
      op: 'append',
      streaming: false,
      entryId: identity.entryId,
      fingerprint: identity.fingerprint,
      ...(data.modelId ? { modelId: data.modelId } : {}),
      ...(data.sessionId ? { sessionId: data.sessionId } : {}),
    },
  )
}

async function getTicketPendingOpenCodeQuestions(ticketId: string) {
  const ticketContext = getTicketContext(ticketId)
  if (!ticketContext) return null

  const sessions = listOpenCodeSessionsForTicket(ticketId, ['active'])
  if (sessions.length === 0) return []
  const sessionsById = new Map(sessions.map((session) => [session.sessionId, session]))
  const adapter = getOpenCodeAdapter()
  const pending = await adapter.listPendingQuestions(ticketContext.projectRoot)

  return pending
    .filter((request) => sessionsById.has(request.sessionID))
    .map((request) => {
      const session = sessionsById.get(request.sessionID)
      return {
        type: 'opencode_question' as const,
        action: 'asked' as const,
        ticketId,
        ticketExternalId: ticketContext.externalId,
        ticketTitle: ticketContext.localTicket.title,
        status: ticketContext.localTicket.status,
        phase: session?.phase ?? ticketContext.localTicket.status,
        modelId: session?.memberId ?? undefined,
        sessionId: request.sessionID,
        requestId: request.id,
        questions: request.questions,
        questionCount: request.questions.length,
        tool: request.tool,
        timestamp: new Date().toISOString(),
      }
    })
}

async function findPendingOpenCodeQuestionForTicket(ticketId: string, requestId: string) {
  const questions = await getTicketPendingOpenCodeQuestions(ticketId)
  if (!questions) return null
  return questions.find((request) => request.requestId === requestId) ?? null
}

function getTicketParam(c: Context): string {
  const ticketId = c.req.param('id') ?? c.req.param('ticketId')
  if (!ticketId) {
    throw new Error('Ticket route is missing the required id parameter')
  }
  return ticketId
}

function getRequiredRouteParam(c: Context, name: string): string {
  const value = c.req.param(name)
  if (!value) {
    throw new Error(`Route is missing required parameter "${name}"`)
  }
  return value
}

function getMachineContext(ticketId: string): MachineTicketContext {
  ensureActorForTicket(ticketId)
  const state = getTicketState(ticketId)
  if (!state) {
    throw new Error('Ticket actor state is unavailable')
  }
  return state.context as MachineTicketContext
}

function buildExecutionBandConflictMessage(conflict: {
  externalId: string
  title: string
  status: string
}) {
  return `Project execution is busy with ${conflict.externalId} (${conflict.status}): ${conflict.title}`
}

async function preparePlanningRestart(
  ticketId: string,
  targetApprovalStatus: 'WAITING_INTERVIEW_APPROVAL' | 'WAITING_PRD_APPROVAL',
): Promise<void> {
  const restartPhase = targetApprovalStatus === 'WAITING_INTERVIEW_APPROVAL'
    ? 'WAITING_INTERVIEW_APPROVAL'
    : 'WAITING_PRD_APPROVAL'
  const restartReason = targetApprovalStatus === 'WAITING_INTERVIEW_APPROVAL'
    ? 'interview_edit_restart'
    : 'prd_edit_restart'
  const phasesToArchive = targetApprovalStatus === 'WAITING_INTERVIEW_APPROVAL'
    ? INTERVIEW_EDIT_RESTART_PHASES
    : PRD_EDIT_RESTART_PHASES

  emitRoutePhaseLog(ticketId, restartPhase, 'info', 'Archiving downstream planning attempts and aborting active downstream work.')
  cancelTicket(ticketId)
  await abortTicketSessions(ticketId)
  clearContextCache(ticketId)
  archiveActivePhaseAttempts(ticketId, phasesToArchive, restartReason)
  createFreshPhaseAttempts(ticketId, phasesToArchive)

  ensureActorForTicket(ticketId)
  revertTicketToApprovalStatus(ticketId, targetApprovalStatus)
}

function rollbackTicketStartToDraft(ticketId: string): void {
  patchTicket(ticketId, {
    status: 'DRAFT',
    xstateSnapshot: null,
    errorMessage: null,
    branchName: null,
    startedAt: null,
    lockedMainImplementer: null,
    lockedMainImplementerVariant: null,
    lockedCouncilMembers: null,
    lockedCouncilMemberVariants: null,
    lockedInterviewQuestions: null,
    lockedCoverageFollowUpBudgetPercent: null,
    lockedMaxCoveragePasses: null,
    lockedMaxPrdCoveragePasses: null,
    lockedMaxBeadsCoveragePasses: null,
  })
  stopActor(ticketId)
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

export function handleListTickets(c: Context) {
  const projectId = c.req.query('project') ?? c.req.query('projectId')
  const parsedProjectId = projectId ? Number(projectId) : undefined
  if (projectId && Number.isNaN(parsedProjectId)) {
    return c.json({ error: 'Invalid project ID' }, 400)
  }
  return c.json(listTickets(parsedProjectId))
}

function updatePullRequestReportFromLiveState(
  ticketId: string,
  existing: PullRequestReport,
  pr: NonNullable<ReturnType<typeof refreshPullRequestState>>,
) {
  refreshPullRequestReport(ticketId, {
    ...existing,
    completedAt: new Date().toISOString(),
    prNumber: pr.number,
    prUrl: pr.url,
    prState: pr.state,
    prHeadSha: pr.headRefOid,
    title: existing.title ?? pr.title,
    body: existing.body,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    mergedAt: pr.mergedAt,
    closedAt: pr.closedAt,
    message: existing.message,
  })
}

function syncWaitingPullRequestTicket(ticketId: string) {
  const current = getTicketByRef(ticketId)
  if (!current || current.status !== 'WAITING_PR_REVIEW') return current

  const ticketContext = getTicketContext(ticketId)
  const prReport = readPullRequestReport(ticketId)
  if (!ticketContext || !prReport) return current

  const headBranch = current.branchName?.trim() || current.externalId
  const baseBranch = current.runtime.baseBranch

  try {
    const livePr = refreshPullRequestState(ticketContext.projectRoot, headBranch, baseBranch)
    if (!livePr) return current

    if (livePr.state !== prReport.prState || livePr.headRefOid !== prReport.prHeadSha) {
      updatePullRequestReportFromLiveState(ticketId, prReport, livePr)
    }

    if (livePr.state === 'merged') {
      const mergeReport = withCommandLogging(
        ticketId,
        current.externalId,
        'WAITING_PR_REVIEW',
        () => completeMergedPullRequest({
          ticketId,
          externalId: current.externalId,
          projectPath: ticketContext.projectRoot,
          baseBranch,
          headBranch,
          candidateCommitSha: current.runtime.candidateCommitSha,
          prReport: {
            ...prReport,
            prNumber: livePr.number,
            prUrl: livePr.url,
            prState: livePr.state,
            prHeadSha: livePr.headRefOid,
            createdAt: livePr.createdAt,
            updatedAt: livePr.updatedAt,
            mergedAt: livePr.mergedAt,
            closedAt: livePr.closedAt,
          },
          skipRemoteMerge: true,
        }),
        (phase, type, content) => emitRoutePhaseLog(ticketId, phase, type, content),
      )

      emitRoutePhaseLog(ticketId, 'WAITING_PR_REVIEW', 'info', mergeReport.message, {
        prNumber: mergeReport.prNumber,
        prUrl: mergeReport.prUrl,
      })

      ensureActorForTicket(ticketId)
      sendTicketEvent(ticketId, { type: 'MERGE_COMPLETE' })
      return getTicketByRef(ticketId) ?? current
    }
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err)
    emitRoutePhaseLog(ticketId, 'WAITING_PR_REVIEW', 'error', `PR sync failed: ${details}`)
    try {
      ensureActorForTicket(ticketId)
      sendTicketEvent(ticketId, {
        type: 'ERROR',
        message: `PR sync failed: ${details}`,
        codes: ['PULL_REQUEST_SYNC_FAILED'],
      })
    } catch {
      // Best effort only. Return the current ticket below.
    }
  }

  return getTicketByRef(ticketId) ?? current
}

export function handleGetTicket(c: Context) {
  const ticketId = getRequiredRouteParam(c, 'id')
  const ticket = syncWaitingPullRequestTicket(ticketId) ?? getTicketByRef(ticketId)
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

    emitRoutePhaseLog(ticketId, ticket.status, 'info', `Deleting ticket ${ticket.externalId}: removing worktree, branch, and database records.`)
    const deleted = deleteStoredTicket(ticketId)
    if (!deleted) return c.json({ error: 'Ticket not found' }, 404)

    broadcaster.clearTicket(ticketId)
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

  const startPhase = 'DRAFT'
  emitRoutePhaseLog(ticketId, startPhase, 'info', 'Start requested.')

  const profile = getProfileDefaults()
  const councilRaw = ticketContext.localProject.councilMembers ?? profile?.councilMembers ?? null
  emitRoutePhaseLog(ticketId, startPhase, 'info', 'Validating model availability.')
  let modelSelection
  try {
    modelSelection = await validateModelSelection(profile?.mainImplementer, councilRaw)
    emitRoutePhaseLog(
      ticketId,
      startPhase,
      'info',
      `✓ Model Availability: Main implementer ${modelSelection.mainImplementer}; council size ${modelSelection.councilMembers.length}.`,
      {
        mainImplementer: modelSelection.mainImplementer,
        councilMembers: modelSelection.councilMembers,
      },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid model configuration'
    emitRoutePhaseLog(ticketId, startPhase, 'error', `✗ Model Availability: ${message}`, {
      error: message,
    })
    return c.json({ error: message }, 400)
  }

  emitRoutePhaseLog(ticketId, startPhase, 'info', 'Initializing workspace and ticket directories.')
  let init: ReturnType<typeof initializeTicket>
  try {
    init = withCommandLogging(
      ticketId,
      ticketContext.externalId,
      startPhase,
      () => initializeTicket({
        externalId: ticketContext.externalId,
        projectFolder: ticketContext.projectRoot,
      }),
      (phase, type, content) => emitRoutePhaseLog(ticketId, phase, type, content),
    )
    emitRoutePhaseLog(
      ticketId,
      startPhase,
      'info',
      init.reused
        ? `✓ Workspace Init: Ready on branch ${init.branchName} (reused existing worktree).`
        : `✓ Workspace Init: Ready on branch ${init.branchName} (new worktree and ticket directories created).`,
      {
        branchName: init.branchName,
        baseBranch: init.baseBranch,
        worktreePath: init.worktreePath,
        reused: init.reused,
      },
    )
  } catch (err) {
    const initErr = err instanceof TicketInitializationError
      ? err
      : new TicketInitializationError('INIT_UNKNOWN', err instanceof Error ? err.message : String(err))
    emitRoutePhaseLog(ticketId, startPhase, 'error', `✗ Workspace Init: ${initErr.message}`, {
      code: initErr.code,
      error: initErr.message,
    })

    try {
      ensureActorForTicket(ticketId)
      sendTicketEvent(ticketId, {
        type: 'INIT_FAILED',
        message: initErr.message,
        codes: [initErr.code],
      })
    } catch (sendErr) {
      emitRoutePhaseLog(
        ticketId,
        startPhase,
        'error',
        `Failed to block ticket after initialization error: ${String(sendErr)}`,
        {
          code: initErr.code,
          error: String(sendErr),
        },
      )
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
  const lockedMaxPrdCoveragePasses = profile?.maxPrdCoveragePasses
    ?? PROFILE_DEFAULTS.maxPrdCoveragePasses
  const lockedMaxBeadsCoveragePasses = profile?.maxBeadsCoveragePasses
    ?? PROFILE_DEFAULTS.maxBeadsCoveragePasses
  const lockedMainImplementerVariant = profile?.mainImplementerVariant ?? null
  const lockedCouncilMemberVariants: Record<string, string> | null = profile?.councilMemberVariants
    ? (typeof profile.councilMemberVariants === 'string'
      ? JSON.parse(profile.councilMemberVariants)
      : profile.councilMemberVariants)
    : null
  const startedAt = new Date().toISOString()

  emitRoutePhaseLog(ticketId, startPhase, 'info', 'Locking start configuration.')
  // Note: The individual lock steps below use ✓/✗ formatting for consistency with pre-flight checks.
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
      lockedMaxPrdCoveragePasses,
      lockedMaxBeadsCoveragePasses,
    })
    if (!lockedTicket) {
      rollbackTicketStartToDraft(ticketId)
      emitRoutePhaseLog(ticketId, startPhase, 'error', '✗ Start Config: Ticket not found.')
      return c.json({ error: 'Ticket not found' }, 404)
    }
    emitRoutePhaseLog(ticketId, startPhase, 'info', '✓ Start Config: Configuration locked.', {
      branchName: init.branchName,
      startedAt,
    })
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err)
    rollbackTicketStartToDraft(ticketId)
    emitRoutePhaseLog(ticketId, startPhase, 'error', `✗ Start Config: ${details}`, {
      error: details,
      rollback: 'preserved_worktree',
    })
    return c.json({
      error: 'Failed to persist ticket start configuration',
      details,
    }, 500)
  }

  emitRoutePhaseLog(ticketId, startPhase, 'info', '✓ Workflow Dispatch: Start dispatched.')
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
      lockedMaxPrdCoveragePasses,
      lockedMaxBeadsCoveragePasses,
    })
  } catch (err) {
    rollbackTicketStartToDraft(ticketId)
    emitRoutePhaseLog(ticketId, startPhase, 'error', `✗ Workflow Dispatch: ${String(err)}`, {
      error: String(err),
      rollback: 'preserved_worktree',
    })
    console.error(`[tickets] Failed to send START to ticket ${ticketId}:`, err)
    return c.json({ error: 'Failed to start ticket', details: String(err) }, 500)
  }

  return respondWithState(c, ticketId, 'Start action accepted')
}

export function handleApproveTicket(c: Context) {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)

  const approvalStates = ['WAITING_INTERVIEW_APPROVAL', 'WAITING_PRD_APPROVAL', 'WAITING_BEADS_APPROVAL', 'WAITING_EXECUTION_SETUP_APPROVAL']
  if (!approvalStates.includes(ticket.status)) {
    return c.json({ error: 'Ticket is not in an approval state' }, 409)
  }

  if (ticket.status === 'WAITING_INTERVIEW_APPROVAL') {
    return handleApproveInterview(c)
  }
  if (ticket.status === 'WAITING_PRD_APPROVAL') {
    return handleApprovePrd(c)
  }
  if (ticket.status === 'WAITING_BEADS_APPROVAL') {
    return handleApproveBeads(c)
  }
  if (ticket.status === 'WAITING_EXECUTION_SETUP_APPROVAL') {
    return handleApproveExecutionSetupPlan(c)
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
  if (!isStatusAtOrPast(ticket.status, 'WAITING_INTERVIEW_APPROVAL') || !isBeforeExecution(ticket.status, ticket.previousStatus)) {
    return c.json({ error: 'Ticket is not in a state where interview can be edited' }, 409)
  }

  const body = await c.req.json().catch(() => ({}))
  const parsed = interviewApprovalAnswerSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid interview answer payload', details: parsed.error.flatten() }, 400)
  }

  try {
    if (ticket.status !== 'WAITING_INTERVIEW_APPROVAL') {
      await preparePlanningRestart(ticketId, 'WAITING_INTERVIEW_APPROVAL')
    }
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
  if (!isStatusAtOrPast(ticket.status, 'WAITING_INTERVIEW_APPROVAL') || !isBeforeExecution(ticket.status, ticket.previousStatus)) {
    return c.json({ error: 'Ticket is not in a state where interview can be edited' }, 409)
  }

  const body = await c.req.json().catch(() => ({}))
  const parsed = rawInterviewSaveSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid interview document payload', details: parsed.error.flatten() }, 400)
  }

  try {
    if (ticket.status !== 'WAITING_INTERVIEW_APPROVAL') {
      await preparePlanningRestart(ticketId, 'WAITING_INTERVIEW_APPROVAL')
    }
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

export async function handlePutPrd(c: Context) {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (!isStatusAtOrPast(ticket.status, 'WAITING_PRD_APPROVAL') || !isBeforeExecution(ticket.status, ticket.previousStatus)) {
    return c.json({ error: 'Ticket is not in a state where PRD can be edited' }, 409)
  }

  const body = await c.req.json().catch(() => ({}))
  const rawParsed = rawPrdSaveSchema.safeParse(body)
  if (rawParsed.success) {
    try {
      if (ticket.status !== 'WAITING_PRD_APPROVAL') {
        await preparePlanningRestart(ticketId, 'WAITING_PRD_APPROVAL')
      }
      const { raw } = savePrdRawContent(ticketId, rawParsed.data.content)
      return c.json({
        success: true,
        content: raw,
      })
    } catch (err) {
      return c.json({
        error: 'Failed to save PRD document',
        details: err instanceof Error ? err.message : String(err),
      }, 400)
    }
  }

  const structuredParsed = structuredPrdSaveSchema.safeParse(body)
  if (!structuredParsed.success) {
    return c.json({ error: 'Invalid PRD document payload', details: structuredParsed.error.flatten() }, 400)
  }

  try {
    if (ticket.status !== 'WAITING_PRD_APPROVAL') {
      await preparePlanningRestart(ticketId, 'WAITING_PRD_APPROVAL')
    }
    const { raw } = savePrdStructuredContent(ticketId, structuredParsed.data.document)
    return c.json({
      success: true,
      content: raw,
    })
  } catch (err) {
    return c.json({
      error: 'Failed to save PRD document',
      details: err instanceof Error ? err.message : String(err),
    }, 400)
  }
}

export function handleGetExecutionSetupPlan(c: Context) {
  const ticketId = getTicketParam(c)
  if (!getTicketByRef(ticketId)) return c.json({ error: 'Ticket not found' }, 404)

  try {
    const current = readExecutionSetupPlan(ticketId)
    return c.json({
      exists: Boolean(current.plan),
      artifactId: current.artifactId,
      updatedAt: current.updatedAt,
      raw: current.raw,
      plan: current.plan,
    })
  } catch (err) {
    return c.json({
      error: 'Failed to read execution setup plan',
      details: err instanceof Error ? err.message : String(err),
    }, 400)
  }
}

export async function handlePutExecutionSetupPlan(c: Context) {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'WAITING_EXECUTION_SETUP_APPROVAL') {
    return c.json({ error: 'Ticket is not waiting for execution setup plan approval' }, 409)
  }

  const body = await c.req.json().catch(() => ({}))
  const rawParsed = rawExecutionSetupPlanSaveSchema.safeParse(body)
  if (rawParsed.success) {
    try {
      const { raw, plan } = saveExecutionSetupPlanRawContent(ticketId, rawParsed.data.content)
      return c.json({ success: true, raw, plan })
    } catch (err) {
      return c.json({
        error: 'Failed to save execution setup plan',
        details: err instanceof Error ? err.message : String(err),
      }, 400)
    }
  }

  const structuredParsed = structuredExecutionSetupPlanSaveSchema.safeParse(body)
  if (!structuredParsed.success) {
    return c.json({ error: 'Invalid execution setup plan payload', details: structuredParsed.error.flatten() }, 400)
  }

  try {
    const { raw, plan } = saveExecutionSetupPlan(ticketId, structuredParsed.data.plan)
    return c.json({ success: true, raw, plan })
  } catch (err) {
    return c.json({
      error: 'Failed to save execution setup plan',
      details: err instanceof Error ? err.message : String(err),
    }, 400)
  }
}

export async function handleRegenerateExecutionSetupPlan(c: Context) {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'WAITING_EXECUTION_SETUP_APPROVAL') {
    return c.json({ error: 'Ticket is not waiting for execution setup plan approval' }, 409)
  }

  const body = await c.req.json().catch(() => ({}))
  const parsed = regenerateExecutionSetupPlanSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid regenerate payload', details: parsed.error.flatten() }, 400)
  }

  let currentPlan = parsed.data.plan ?? null
  if (!currentPlan && parsed.data.rawContent) {
    const normalized = normalizeExecutionSetupPlanOutput(parsed.data.rawContent)
    if (!normalized.ok) {
      return c.json({ error: 'Invalid raw setup plan draft', details: normalized.error }, 400)
    }
    currentPlan = normalized.value
  }
  if (!currentPlan) {
    currentPlan = readExecutionSetupPlan(ticketId).plan
  }

  try {
    const report = await regenerateExecutionSetupPlanDraft({
      ticketId,
      context: getMachineContext(ticketId),
      commentary: parsed.data.commentary,
      currentPlan,
    })
    if (!report.plan) {
      return c.json({
        error: 'Failed to regenerate execution setup plan',
        details: report.errors.join('; ') || 'Generation failed',
      }, 400)
    }
    return c.json({
      success: true,
      raw: serializeExecutionSetupPlan(report.plan),
      plan: report.plan,
      report,
    })
  } catch (err) {
    return c.json({
      error: 'Failed to regenerate execution setup plan',
      details: err instanceof Error ? err.message : String(err),
    }, 500)
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
    emitRoutePhaseLog(ticketId, phase, 'info', 'Interview approved by user.')

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
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'WAITING_PRD_APPROVAL') {
    return c.json({ error: 'Ticket is not waiting for PRD approval' }, 409)
  }

  try {
    approvePrdDocument(ticketId)
    ensureActorForTicket(ticketId)

    const phase = 'WAITING_PRD_APPROVAL'
    emitRoutePhaseLog(ticketId, phase, 'info', 'PRD approved by user.')

    sendTicketEvent(ticketId, { type: 'APPROVE' })
  } catch (err) {
    console.error(`[tickets] Failed to approve PRD for ${ticketId}:`, err)
    return c.json({
      error: 'Failed to approve PRD',
      details: err instanceof Error ? err.message : String(err),
    }, 500)
  }

  return respondWithState(c, ticketId, 'PRD approved')
}

export function handleApproveBeads(c: Context) {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'WAITING_BEADS_APPROVAL') {
    return c.json({ error: 'Ticket is not waiting for beads approval' }, 409)
  }

  const executionConflict = findProjectExecutionBandConflict(ticket.projectId, ticket.id)
  if (executionConflict) {
    return c.json({ error: buildExecutionBandConflictMessage(executionConflict) }, 409)
  }

  try {
    approveBeadsDocument(ticketId)
    ensureActorForTicket(ticketId)

    const phase = 'WAITING_BEADS_APPROVAL'
    emitRoutePhaseLog(ticketId, phase, 'info', 'Beads approved by user.')

    sendTicketEvent(ticketId, { type: 'APPROVE' })
  } catch (err) {
    console.error(`[tickets] Failed to approve beads for ${ticketId}:`, err)
    return c.json({
      error: 'Failed to approve beads',
      details: err instanceof Error ? err.message : String(err),
    }, 500)
  }

  return respondWithState(c, ticketId, 'Beads approved')
}

export function handleApproveExecutionSetupPlan(c: Context) {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'WAITING_EXECUTION_SETUP_APPROVAL') {
    return c.json({ error: 'Ticket is not waiting for execution setup plan approval' }, 409)
  }

  const executionConflict = findProjectExecutionBandConflict(ticket.projectId, ticket.id)
  if (executionConflict) {
    return c.json({ error: buildExecutionBandConflictMessage(executionConflict) }, 409)
  }

  let plan: ExecutionSetupPlan | null = null
  try {
    plan = readExecutionSetupPlan(ticketId).plan
    if (!plan) {
      return c.json({ error: 'Execution setup plan is not ready yet' }, 409)
    }

    approveExecutionSetupPlan(ticketId, plan)
    ensureActorForTicket(ticketId)

    const phase = 'WAITING_EXECUTION_SETUP_APPROVAL'
    emitRoutePhaseLog(ticketId, phase, 'info', 'Execution setup plan approved by user.')

    sendTicketEvent(ticketId, { type: 'APPROVE_EXECUTION_SETUP_PLAN' })
  } catch (err) {
    console.error(`[tickets] Failed to approve execution setup plan for ${ticketId}:`, err)
    return c.json({
      error: 'Failed to approve execution setup plan',
      details: err instanceof Error ? err.message : String(err),
    }, 500)
  }

  return respondWithState(c, ticketId, 'Execution setup plan approved')
}

export function handleMergeTicket(c: Context) {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'WAITING_PR_REVIEW') {
    return c.json({ error: 'Ticket is not waiting for pull request review' }, 409)
  }

  const ticketContext = getTicketContext(ticketId)
  if (!ticketContext) return c.json({ error: 'Ticket not found' }, 404)
  const prReport = readPullRequestReport(ticketId)
  if (!prReport) {
    return c.json({ error: 'Pull request report not found' }, 409)
  }

  const phase = 'WAITING_PR_REVIEW'

  try {
    const mergeReport = withCommandLogging(
      ticketId,
      ticket.externalId,
      phase,
      () => completeMergedPullRequest({
        ticketId,
        externalId: ticket.externalId,
        projectPath: ticketContext.projectRoot,
        baseBranch: ticket.runtime.baseBranch,
        headBranch: ticket.branchName?.trim() || ticket.externalId,
        candidateCommitSha: ticket.runtime.candidateCommitSha,
        prReport,
      }),
      (cmdPhase, type, content) => emitRoutePhaseLog(ticketId, cmdPhase, type, content),
    )

    ensureActorForTicket(ticketId)
    emitRoutePhaseLog(ticketId, phase, 'info', mergeReport.message, {
      prNumber: mergeReport.prNumber,
      prUrl: mergeReport.prUrl,
      prState: mergeReport.prState,
      localBaseHead: mergeReport.localBaseHead,
      remoteBaseHead: mergeReport.remoteBaseHead,
    })
    sendTicketEvent(ticketId, { type: 'MERGE_COMPLETE' })
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err)
    try {
      ensureActorForTicket(ticketId)
      emitRoutePhaseLog(ticketId, phase, 'error', `Pull request merge failed: ${details}`)
      sendTicketEvent(ticketId, {
        type: 'ERROR',
        message: `Pull request merge failed: ${details}`,
        codes: ['PULL_REQUEST_MERGE_FAILED'],
      })
      return respondWithState(c, ticketId, 'Merge failed and ticket was blocked')
    } catch (dispatchErr) {
      console.error(`[tickets] Failed to dispatch merge error for ticket ${ticketId}:`, dispatchErr)
      return c.json({ error: 'Failed to merge pull request', details }, 500)
    }
  }

  return respondWithState(c, ticketId, 'Merge complete')
}

export function handleCloseUnmergedTicket(c: Context) {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'WAITING_PR_REVIEW') {
    return c.json({ error: 'Ticket is not waiting for pull request review' }, 409)
  }

  try {
    const report = completeCloseUnmerged({
      ticketId,
      baseBranch: ticket.runtime.baseBranch,
      headBranch: ticket.branchName?.trim() || ticket.externalId,
      candidateCommitSha: ticket.runtime.candidateCommitSha,
      prReport: readPullRequestReport(ticketId),
    })

    ensureActorForTicket(ticketId)
    emitRoutePhaseLog(ticketId, 'WAITING_PR_REVIEW', 'info', report.message, {
      disposition: report.disposition,
      prNumber: report.prNumber,
      prUrl: report.prUrl,
    })
    sendTicketEvent(ticketId, { type: 'CLOSE_UNMERGED_COMPLETE' })
  } catch (err) {
    console.error(`[tickets] Failed to close ticket ${ticketId} without merge:`, err)
    return c.json({ error: 'Failed to finish ticket without merge', details: String(err) }, 500)
  }

  return respondWithState(c, ticketId, 'Finished without merge')
}

export function handleVerifyTicket(c: Context) {
  return handleMergeTicket(c)
}

export function handleRetryTicket(c: Context) {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'BLOCKED_ERROR') {
    return c.json({ error: 'Retry only works from BLOCKED_ERROR state' }, 409)
  }
  if (!ticket.previousStatus) {
    return c.json({ error: 'Retry is not available because the failed status could not be recovered' }, 409)
  }

  if (isExecutionBandStatus(ticket.previousStatus)) {
    const executionConflict = findProjectExecutionBandConflict(ticket.projectId, ticket.id)
    if (executionConflict) {
      return c.json({ error: buildExecutionBandConflictMessage(executionConflict) }, 409)
    }
  }

  if (ticket.previousStatus === 'CODING') {
    const paths = getTicketPaths(ticketId)
    if (!paths) {
      return c.json({ error: 'Retry is not available because the ticket workspace could not be resolved' }, 409)
    }
    try {
      const recoveredBead = recoverCodingBeadWithReset(ticketId, {
        worktreePath: paths.worktreePath,
        requireReset: true,
      })
      if (!recoveredBead) {
        return c.json({ error: 'Retry is not available because no failed bead could be restored' }, 409)
      }
    } catch (err) {
      return c.json({
        error: 'Retry is not available because the failed bead could not be safely reset',
        details: err instanceof Error ? err.message : String(err),
      }, 409)
    }
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

export async function handleListOpenCodeQuestions(c: Context) {
  const ticketId = getTicketParam(c)
  if (!getTicketByRef(ticketId)) return c.json({ error: 'Ticket not found' }, 404)

  try {
    const questions = await getTicketPendingOpenCodeQuestions(ticketId)
    if (!questions) return c.json({ error: 'Ticket not found' }, 404)
    return c.json({ questions })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    emitRoutePhaseLog(ticketId, getTicketByRef(ticketId)?.status ?? 'UNKNOWN', 'error', `Failed to list OpenCode questions: ${message}`)
    return c.json({ error: 'Failed to list OpenCode questions', details: message }, 500)
  }
}

export async function handleReplyOpenCodeQuestion(c: Context) {
  const ticketId = getTicketParam(c)
  const requestId = getRequiredRouteParam(c, 'requestId')
  const ticketContext = getTicketContext(ticketId)
  if (!ticketContext) return c.json({ error: 'Ticket not found' }, 404)

  const body = await c.req.json().catch(() => ({}))
  const parsed = opencodeQuestionReplySchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid question reply payload', details: parsed.error.flatten() }, 400)
  }

  const question = await findPendingOpenCodeQuestionForTicket(ticketId, requestId)
  if (!question) return c.json({ error: 'OpenCode question request not found for ticket' }, 404)

  try {
    await getOpenCodeAdapter().replyQuestion(requestId, parsed.data.answers, ticketContext.projectRoot)
    emitOpenCodeQuestionLog(ticketId, question.phase, '[QUESTION] AI question answered.', {
      requestId,
      sessionId: question.sessionId,
      modelId: question.modelId,
      action: 'replied',
    })
    broadcaster.broadcast(ticketId, 'needs_input', {
      type: 'opencode_question_resolved',
      action: 'replied',
      ticketId,
      requestId,
      sessionId: question.sessionId,
      timestamp: new Date().toISOString(),
    })
    return c.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    emitOpenCodeQuestionLog(ticketId, question.phase, `[ERROR] Failed to answer OpenCode question: ${message}`, {
      requestId,
      sessionId: question.sessionId,
      modelId: question.modelId,
      kind: 'error',
      type: 'error',
      action: 'reply_failed',
    })
    return c.json({ error: 'Failed to answer OpenCode question', details: message }, 500)
  }
}

export async function handleRejectOpenCodeQuestion(c: Context) {
  const ticketId = getTicketParam(c)
  const requestId = getRequiredRouteParam(c, 'requestId')
  const ticketContext = getTicketContext(ticketId)
  if (!ticketContext) return c.json({ error: 'Ticket not found' }, 404)

  const question = await findPendingOpenCodeQuestionForTicket(ticketId, requestId)
  if (!question) return c.json({ error: 'OpenCode question request not found for ticket' }, 404)

  try {
    await getOpenCodeAdapter().rejectQuestion(requestId, ticketContext.projectRoot)
    emitOpenCodeQuestionLog(ticketId, question.phase, '[QUESTION] AI question rejected.', {
      requestId,
      sessionId: question.sessionId,
      modelId: question.modelId,
      action: 'rejected',
    })
    broadcaster.broadcast(ticketId, 'needs_input', {
      type: 'opencode_question_resolved',
      action: 'rejected',
      ticketId,
      requestId,
      sessionId: question.sessionId,
      timestamp: new Date().toISOString(),
    })
    return c.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    emitOpenCodeQuestionLog(ticketId, question.phase, `[ERROR] Failed to reject OpenCode question: ${message}`, {
      requestId,
      sessionId: question.sessionId,
      modelId: question.modelId,
      kind: 'error',
      type: 'error',
      action: 'reject_failed',
    })
    return c.json({ error: 'Failed to reject OpenCode question', details: message }, 500)
  }
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

export function handleListPhaseAttempts(c: Context) {
  const ticketId = getTicketParam(c)
  const phase = c.req.param('phase')
  if (!getTicketByRef(ticketId)) return c.json({ error: 'Ticket not found' }, 404)
  if (!phase) return c.json({ error: 'Phase is required' }, 400)
  return c.json(listPhaseAttempts(ticketId, phase))
}

export function handleGetArtifacts(c: Context) {
  const ticketId = getTicketParam(c)
  if (!getTicketByRef(ticketId)) return c.json({ error: 'Ticket not found' }, 404)
  const phase = c.req.query('phase')
  const rawPhaseAttempt = c.req.query('phaseAttempt')
  const phaseAttempt = rawPhaseAttempt != null ? Number(rawPhaseAttempt) : undefined
  return c.json(listPhaseArtifacts(ticketId, {
    ...(phase ? { phase } : {}),
    ...(typeof phaseAttempt === 'number' && Number.isFinite(phaseAttempt) && phaseAttempt > 0
      ? { phaseAttempt }
      : {}),
  }))
}
