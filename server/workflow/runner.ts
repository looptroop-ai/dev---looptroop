import { createActor } from 'xstate'
import { ticketMachine } from '../machines/ticketMachine'
import type { TicketContext, TicketEvent } from '../machines/types'
import { db as appDb } from '../db/index'
import { profiles } from '../db/schema'
import { PROFILE_DEFAULTS } from '../db/defaults'
import { broadcaster } from '../sse/broadcaster'
import { deliberateInterview } from '../phases/interview/deliberate'
import { draftPRD, buildPrdContextBuilder } from '../phases/prd/draft'
import { draftBeads, buildBeadsContextBuilder } from '../phases/beads/draft'
import { expandBeads } from '../phases/beads/expand'
import type { Bead, BeadSubset } from '../phases/beads/types'
import { executeBead } from '../phases/execution/executor'
import { getNextBead, isAllComplete } from '../phases/execution/scheduler'
import type { CouncilResult, DraftPhaseResult, DraftProgressEvent, DraftResult, MemberOutcome, Vote, VotePresentationOrder } from '../council/types'
import { CancelledError, throwIfAborted, VOTING_RUBRIC_INTERVIEW } from '../council/types'
import { parseCouncilMembers } from '../council/members'
import { conductVoting, selectWinner } from '../council/voter'
import { refineDraft } from '../council/refiner'
import { checkMemberResponseQuorum, checkQuorum } from '../council/quorum'
import { appendLogEvent } from '../log/executionLog'
import type { LogEventType, LogSource } from '../log/types'
import { buildMinimalContext, type TicketState } from '../opencode/contextBuilder'
import type { Message, PromptPart, StreamEvent } from '../opencode/types'
import { buildPromptFromTemplate, PROM2, PROM3, PROM5, PROM12, PROM13, PROM22, PROM24 } from '../prompts/index'
import { startInterviewSession, submitBatchToSession, type BatchResponse } from '../phases/interview/qa'
import { formatInterviewQuestionPreview, parseInterviewQuestions } from '../phases/interview/questions'
import { buildCompiledInterviewArtifact, requireCompiledInterviewArtifact } from '../phases/interview/compiled'
import {
  buildCanonicalInterviewYaml,
  buildCoverageFollowUpBatch,
  buildInterviewQuestionViews,
  buildPersistedBatch,
  clearInterviewSessionBatch,
  completeInterviewBySkippingRemaining,
  countCoverageFollowUpQuestions,
  createInterviewSessionSnapshot,
  INTERVIEW_BATCH_HISTORY_ARTIFACT,
  INTERVIEW_CURRENT_BATCH_ARTIFACT,
  INTERVIEW_PROM4_FINAL_ARTIFACT,
  INTERVIEW_QA_SESSION_ARTIFACT,
  INTERVIEW_SESSION_ARTIFACT,
  markInterviewSessionComplete,
  parseInterviewSessionSnapshot,
  recordBatchAnswers,
  recordPreparedBatch,
  serializeInterviewSessionSnapshot,
} from '../phases/interview/sessionState'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
// @ts-expect-error no type declarations for js-yaml
import jsYaml from 'js-yaml'
import { safeAtomicWrite } from '../io/atomicWrite'
import { readJsonl, writeJsonl } from '../io/jsonl'
import { getOpenCodeAdapter, isMockOpenCodeMode } from '../opencode/factory'
import {
  countPhaseArtifacts,
  getLatestPhaseArtifact,
  getTicketByRef,
  getTicketContext as getStoredTicketContext,
  getTicketPaths,
  insertPhaseArtifact,
  patchTicket,
  upsertLatestPhaseArtifact,
} from '../storage/tickets'
import { runPreFlightChecks } from '../phases/preflight/doctor'
import { cleanupTicketResources } from '../phases/cleanup/cleaner'
import { runOpenCodePrompt, type OpenCodePromptDispatchEvent } from './runOpenCodePrompt'
import { generateFinalTests } from '../phases/finalTest/generator'
import { parseFinalTestCommands } from '../phases/finalTest/parser'
import { executeFinalTestCommands } from '../phases/finalTest/runner'
import { prepareSquashCandidate } from '../phases/integration/squash'
import { raceWithCancel, throwIfCancelled } from '../lib/abort'
import type { InterviewSessionSnapshot, PersistedInterviewBatch } from '@shared/interviewSession'
import {
  buildStructuredRetryPrompt,
  normalizeBeadSubsetYamlOutput,
  normalizeBeadsJsonlOutput,
  normalizeCoverageResultOutput,
  normalizeInterviewRefinementOutput,
  normalizePrdYamlOutput,
  type StructuredOutputMetadata,
} from '../structuredOutput'
import { buildSessionStatusLogEntries } from './sessionStatusLogging'
import {
  resolveInterviewCoverageFollowUpResolution,
} from './interviewCoverageFollowUps'
import { calculateFollowUpLimit } from '../phases/interview/followUpBudget'
import { resolveCoverageGapDisposition, resolveCoverageRunState } from './coverageControl'

const runningPhases = new Set<string>()
const phaseResults = new Map<string, CouncilResult>()
const adapter = getOpenCodeAdapter()
const ticketAbortControllers = new Map<string, AbortController>()
const interviewQASessions = new Map<string, { sessionId: string; winnerId: string }>()
const SKIP_ALL_INTERVIEW_COVERAGE_RESPONSE = 'Coverage skipped by user shortcut after marking remaining questions skipped.'

/** Intermediate data stored between draft→vote→refine state machine phases. */
interface PhaseIntermediateData {
  drafts: DraftResult[]
  memberOutcomes: Record<string, MemberOutcome>
  contextBuilder?: (step: 'vote' | 'refine') => import('../opencode/types').PromptPart[]
  worktreePath: string
  phase: string
  ticketState?: TicketState
  votes?: Vote[]
  presentationOrders?: Record<string, VotePresentationOrder>
  winnerId?: string
}
const phaseIntermediate = new Map<string, PhaseIntermediateData>()

function readInterviewQASessionArtifact(ticketId: string): { sessionId: string; winnerId: string } | null {
  const artifact = getLatestPhaseArtifact(ticketId, INTERVIEW_QA_SESSION_ARTIFACT)
  if (!artifact) return null

  try {
    const parsed = JSON.parse(artifact.content) as { sessionId?: unknown; winnerId?: unknown }
    if (typeof parsed.sessionId !== 'string' || typeof parsed.winnerId !== 'string') {
      return null
    }
    return { sessionId: parsed.sessionId, winnerId: parsed.winnerId }
  } catch {
    return null
  }
}

function readInterviewSessionSnapshotArtifact(ticketId: string): InterviewSessionSnapshot | null {
  const artifact = getLatestPhaseArtifact(ticketId, INTERVIEW_SESSION_ARTIFACT)
  return parseInterviewSessionSnapshot(artifact?.content)
}

function writeInterviewSessionSnapshotArtifact(ticketId: string, snapshot: InterviewSessionSnapshot) {
  upsertLatestPhaseArtifact(
    ticketId,
    INTERVIEW_SESSION_ARTIFACT,
    'WAITING_INTERVIEW_ANSWERS',
    serializeInterviewSessionSnapshot(snapshot),
  )
}

function writeInterviewCurrentBatchArtifact(ticketId: string, batch: PersistedInterviewBatch | null) {
  upsertLatestPhaseArtifact(
    ticketId,
    INTERVIEW_CURRENT_BATCH_ARTIFACT,
    'WAITING_INTERVIEW_ANSWERS',
    JSON.stringify(batch),
  )
}

function writeInterviewBatchHistoryArtifact(ticketId: string, snapshot: InterviewSessionSnapshot) {
  upsertLatestPhaseArtifact(
    ticketId,
    INTERVIEW_BATCH_HISTORY_ARTIFACT,
    'WAITING_INTERVIEW_ANSWERS',
    JSON.stringify(snapshot.batchHistory),
  )
}

function persistInterviewSession(ticketId: string, snapshot: InterviewSessionSnapshot) {
  writeInterviewSessionSnapshotArtifact(ticketId, snapshot)
  writeInterviewCurrentBatchArtifact(ticketId, snapshot.currentBatch)
  writeInterviewBatchHistoryArtifact(ticketId, snapshot)
}

function loadCanonicalInterview(ticketDir: string): string | undefined {
  const interviewPath = resolve(ticketDir, 'interview.yaml')
  if (!existsSync(interviewPath)) return undefined
  try {
    return readFileSync(interviewPath, 'utf-8')
  } catch {
    return undefined
  }
}

function writeCanonicalInterview(ticketId: string, ticketDir: string, snapshot: InterviewSessionSnapshot) {
  const interviewPath = resolve(ticketDir, 'interview.yaml')
  safeAtomicWrite(interviewPath, buildCanonicalInterviewYaml(ticketId, snapshot))
  return interviewPath
}

function buildInterviewAnswerSummary(snapshot: InterviewSessionSnapshot | null): string {
  if (!snapshot) return ''
  const views = buildInterviewQuestionViews(snapshot)
  const answered = views
    .filter((question) => question.status === 'answered' || question.status === 'skipped')
    .map((question) => [
      `${question.id}: ${question.question}`,
      question.status === 'skipped'
        ? 'Answer: [SKIPPED]'
        : `Answer: ${question.answer ?? ''}`,
    ].join('\n'))
  return answered.join('\n\n')
}

export function skipAllInterviewQuestionsToApproval(
  ticketId: string,
  batchAnswers: Record<string, string>,
): { snapshot: InterviewSessionSnapshot; canonicalInterview: string } {
  const snapshot = readInterviewSessionSnapshotArtifact(ticketId)
  if (!snapshot) {
    throw new Error('No normalized interview session snapshot found for this ticket')
  }

  const ticket = getTicketByRef(ticketId)
  const externalId = ticket?.externalId ?? ticketId
  const coverageFollowUpBudgetPercent = ticket?.lockedCoverageFollowUpBudgetPercent
    ?? PROFILE_DEFAULTS.coverageFollowUpBudgetPercent
  const maxCoveragePasses = ticket?.lockedMaxCoveragePasses
    ?? PROFILE_DEFAULTS.maxCoveragePasses
  const paths = getTicketPaths(ticketId)
  if (!paths) {
    throw new Error(`Ticket workspace not initialized: missing ticket paths for ${externalId}`)
  }

  const finalizedSnapshot = completeInterviewBySkippingRemaining(snapshot, batchAnswers)
  const canonicalInterview = buildCanonicalInterviewYaml(externalId, finalizedSnapshot)
  const interviewPath = resolve(paths.ticketDir, 'interview.yaml')

  safeAtomicWrite(interviewPath, canonicalInterview)
  persistInterviewSession(ticketId, finalizedSnapshot)
  interviewQASessions.delete(ticketId)

  const userAnswers = buildInterviewAnswerSummary(finalizedSnapshot)
  const coverageRunNumber = Math.max(1, countPhaseArtifacts(ticketId, 'interview_coverage', 'VERIFYING_INTERVIEW_COVERAGE') || 1)
  const followUpBudgetTotal = calculateFollowUpLimit(finalizedSnapshot.maxInitialQuestions, coverageFollowUpBudgetPercent)
  const followUpBudgetUsed = countCoverageFollowUpQuestions(finalizedSnapshot)
  upsertLatestPhaseArtifact(
    ticketId,
    'interview_coverage_input',
    'VERIFYING_INTERVIEW_COVERAGE',
    JSON.stringify({ interview: canonicalInterview, userAnswers }),
  )
  upsertLatestPhaseArtifact(
    ticketId,
    'interview_coverage',
    'VERIFYING_INTERVIEW_COVERAGE',
    JSON.stringify({
      winnerId: finalizedSnapshot.winnerId,
      response: SKIP_ALL_INTERVIEW_COVERAGE_RESPONSE,
      normalizedContent: [
        'status: clean',
        'gaps: []',
        'follow_up_questions: []',
      ].join('\n'),
      hasGaps: false,
      parsed: {
        status: 'clean',
        gaps: [],
        followUpQuestions: [],
      },
      coverageRunNumber,
      maxCoveragePasses,
      limitReached: false,
      terminationReason: 'clean',
      followUpBudgetPercent: coverageFollowUpBudgetPercent,
      followUpBudgetTotal,
      followUpBudgetUsed,
      followUpBudgetRemaining: Math.max(0, followUpBudgetTotal - followUpBudgetUsed),
      structuredOutput: {
        repairApplied: false,
        repairWarnings: [],
        autoRetryCount: 0,
      },
    }),
  )

  emitPhaseLog(
    ticketId,
    externalId,
    'WAITING_INTERVIEW_ANSWERS',
    'info',
    'User skipped all remaining interview questions. Preserving existing answers and finalizing the normalized interview state.',
  )
  emitPhaseLog(
    ticketId,
    externalId,
    'VERIFYING_INTERVIEW_COVERAGE',
    'info',
    `${SKIP_ALL_INTERVIEW_COVERAGE_RESPONSE} Canonical interview.yaml refreshed at ${interviewPath}.`,
  )

  return {
    snapshot: finalizedSnapshot,
    canonicalInterview,
  }
}

function buildCoverageFollowUpCommentary(response: string): string {
  const firstMeaningfulLine = response
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  return firstMeaningfulLine
    ? `Coverage follow-up needed: ${firstMeaningfulLine}`
    : 'Coverage follow-up questions generated to close remaining gaps.'
}

function buildStructuredMetadata(
  base: Partial<StructuredOutputMetadata> | null | undefined,
  extra?: Partial<StructuredOutputMetadata>,
): StructuredOutputMetadata {
  return {
    repairApplied: Boolean(base?.repairApplied || extra?.repairApplied),
    repairWarnings: [...(base?.repairWarnings ?? []), ...(extra?.repairWarnings ?? [])],
    autoRetryCount: Math.max(base?.autoRetryCount ?? 0, extra?.autoRetryCount ?? 0),
    ...(extra?.validationError
      ? { validationError: extra.validationError }
      : base?.validationError
        ? { validationError: base.validationError }
        : {}),
  }
}

async function restoreInterviewQASession(ticketId: string) {
  const cached = interviewQASessions.get(ticketId)
  if (cached) return cached

  // After server restart the in-memory map is empty. Reload from DB and trust
  // the persisted session ID — adapter.listSessions() silently returns [] on
  // transient errors, causing valid sessions to be abandoned. The actual
  // OpenCode prompt call will surface a real error if the session is gone.
  const persisted = readInterviewQASessionArtifact(ticketId)
  if (!persisted) return null

  interviewQASessions.set(ticketId, persisted)
  return persisted
}

/**
 * Attempt to recover phaseIntermediate data from persisted artifacts after a
 * server restart. Returns true if the data was recovered (or already present).
 */
function tryRecoverPhaseIntermediate(
  ticketId: string,
  context: TicketContext,
  pipeline: 'interview' | 'prd' | 'beads',
  needsVotes: boolean,
): boolean {
  const key = `${ticketId}:${pipeline}`
  if (phaseIntermediate.has(key)) return true

  try {
    const artifact = getLatestPhaseArtifact(ticketId, `${pipeline}_drafts`)
    if (!artifact) return false

    const result = JSON.parse(artifact.content) as DraftPhaseResult
    if (result.isFinal !== true || !result.drafts || result.drafts.length === 0) return false

    const { worktreePath, ticket, ticketDir, codebaseMap } = loadTicketDirContext(context)

    let contextBuilder: PhaseIntermediateData['contextBuilder']
    let baseTicketState: TicketState | undefined
    if (pipeline === 'interview') {
      const ticketState: TicketState = {
        ticketId: context.externalId,
        title: context.title,
        description: ticket?.description ?? '',
        codebaseMap,
      }
      baseTicketState = ticketState
    } else if (pipeline === 'prd') {
      const interviewPath = resolve(ticketDir, 'interview.yaml')
      let interview: string | undefined
      if (existsSync(interviewPath)) {
        try { interview = readFileSync(interviewPath, 'utf-8') } catch { /* ignore */ }
      }
      const ticketState: TicketState = {
        ticketId: context.externalId,
        title: context.title,
        description: ticket?.description ?? '',
        codebaseMap,
        interview,
      }
      contextBuilder = buildPrdContextBuilder(buildMinimalContext('prd_draft', ticketState))
    } else {
      const prdPath = resolve(ticketDir, 'prd.yaml')
      let prd: string | undefined
      if (existsSync(prdPath)) {
        try { prd = readFileSync(prdPath, 'utf-8') } catch { /* ignore */ }
      }
      const ticketState: TicketState = {
        ticketId: context.externalId,
        title: context.title,
        description: ticket?.description ?? '',
        codebaseMap,
        prd,
      }
      contextBuilder = buildBeadsContextBuilder(buildMinimalContext('beads_draft', ticketState))
    }

    const data: PhaseIntermediateData = {
      drafts: result.drafts,
      memberOutcomes: result.memberOutcomes,
      worktreePath,
      phase: result.phase,
      ticketState: baseTicketState,
    }
    if (contextBuilder) {
      data.contextBuilder = contextBuilder
    }

    if (needsVotes) {
      const voteArtifact = getLatestPhaseArtifact(ticketId, `${pipeline}_votes`)
      if (!voteArtifact) return false
      const voteResult = JSON.parse(voteArtifact.content) as {
        votes: Vote[]
        winnerId: string
        presentationOrders?: Record<string, VotePresentationOrder>
        isFinal?: boolean
      }
      if (voteResult.isFinal !== true) return false
      data.votes = voteResult.votes
      data.winnerId = voteResult.winnerId
      data.presentationOrders = voteResult.presentationOrders
    }

    phaseIntermediate.set(key, data)
    console.log(`[runner] Recovered ${pipeline} intermediate data from persisted artifact for ticket ${context.externalId}`)
    return true
  } catch (err) {
    console.error(`[runner] Failed to recover ${pipeline} intermediate data for ticket ${context.externalId}: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

/**
 * Cancel all running phases for a ticket by aborting its AbortController.
 * Cleans up runningPhases entries and phaseResults for the ticket.
 */
export function cancelTicket(ticketId: string) {
  const controller = ticketAbortControllers.get(ticketId)
  if (controller) {
    controller.abort()
    ticketAbortControllers.delete(ticketId)
  }

  // Clean up runningPhases entries for this ticket
  for (const key of runningPhases) {
    if (key.startsWith(`${ticketId}:`)) {
      runningPhases.delete(key)
    }
  }

  // Clean up phaseResults entries for this ticket
  for (const key of phaseResults.keys()) {
    if (key.startsWith(`${ticketId}:`)) {
      phaseResults.delete(key)
    }
  }

  // Clean up phaseIntermediate entries for this ticket
  for (const key of phaseIntermediate.keys()) {
    if (key.startsWith(`${ticketId}:`)) {
      phaseIntermediate.delete(key)
    }
  }

  // Clean up interview QA session
  interviewQASessions.delete(ticketId)
}

function getOrCreateAbortSignal(ticketId: string): AbortSignal {
  let controller = ticketAbortControllers.get(ticketId)
  if (!controller) {
    controller = new AbortController()
    ticketAbortControllers.set(ticketId, controller)
  }
  return controller.signal
}

function emitPhaseLog(
  ticketId: string,
  _ticketExternalId: string,
  phase: string,
  type: LogEventType,
  content: string,
  data?: Record<string, unknown>,
) {
  const source = typeof data?.source === 'string' ? data.source : undefined
  const suppressDebugMirror = data?.suppressDebugMirror === true
  const structuredExtra = {
    ...(typeof data?.entryId === 'string' ? { entryId: data.entryId } : {}),
    ...(typeof data?.op === 'string' ? { op: data.op as StructuredLogOp } : {}),
    ...(typeof data?.audience === 'string' ? { audience: data.audience as StructuredLogAudience } : {}),
    ...(typeof data?.kind === 'string' ? { kind: data.kind as StructuredLogKind } : {}),
    ...(typeof data?.modelId === 'string' ? { modelId: data.modelId } : {}),
    ...(typeof data?.sessionId === 'string' ? { sessionId: data.sessionId } : {}),
    ...(typeof data?.streaming === 'boolean' ? { streaming: data.streaming } : {}),
  }
  const timestamp = new Date().toISOString()
  broadcaster.broadcast(ticketId, 'log', {
    ticketId,
    phase,
    type,
    content,
    ...data,
    timestamp,
  })
  appendLogEvent(
    ticketId,
    type,
    phase,
    content,
    data ? { ...data, timestamp } : { timestamp },
    source as LogSource | undefined,
    phase,
    structuredExtra,
  )
  if (type !== 'debug' && !suppressDebugMirror) {
    emitDebugLog(
      ticketId,
      phase,
      `app.${type}`,
      { content, ...(data ? { data } : {}) },
    )
  }
}

function emitDebugLog(
  ticketId: string,
  phase: string,
  message: string,
  payload?: unknown,
) {
  const payloadText = payload === undefined ? '' : ` ${stringifyForLog(payload)}`
  const content = `[DEBUG] ${message}${payloadText}`
  const debugData = payload && typeof payload === 'object'
    ? (payload as Record<string, unknown>)
    : (payload !== undefined ? { value: payload } : undefined)
  const timestamp = new Date().toISOString()

  broadcaster.broadcast(ticketId, 'log', {
    ticketId,
    phase,
    type: 'debug',
    content,
    source: 'debug',
    audience: 'debug',
    kind: 'session',
    op: 'append',
    streaming: false,
    timestamp,
  })
  appendLogEvent(ticketId, 'debug', phase, content, debugData ? { ...debugData, timestamp } : { timestamp }, 'debug', phase, {
    audience: 'debug',
    kind: 'session',
    op: 'append',
    streaming: false,
  })
}

function emitStateChange(
  ticketId: string,
  _ticketExternalId: string,
  from: string,
  to: string,
) {
  const payload = {
    ticketId,
    from,
    to,
    timestamp: new Date().toISOString(),
  }
  broadcaster.broadcast(ticketId, 'state_change', payload)
  appendLogEvent(
    ticketId,
    'state_change',
    to,
    `Transition: ${from} -> ${to}`,
    payload,
    'system',
    to,
    {
      audience: 'all',
      kind: 'milestone',
      op: 'append',
      streaming: false,
    },
  )
  emitDebugLog(ticketId, to, 'app.state_change', payload)
}

function stringifyForLog(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

type StructuredLogAudience = 'all' | 'ai' | 'debug'
type StructuredLogKind = 'milestone' | 'reasoning' | 'text' | 'tool' | 'step' | 'session' | 'prompt' | 'error' | 'test'
type StructuredLogOp = 'append' | 'upsert' | 'finalize'

interface StructuredLogFields extends Record<string, unknown> {
  entryId: string
  audience: StructuredLogAudience
  kind: StructuredLogKind
  op: StructuredLogOp
  source: string
  modelId?: string
  sessionId?: string
  streaming?: boolean
  suppressDebugMirror?: boolean
}

interface OpenCodeStreamState {
  seenFirstActivity: boolean
  liveKinds: Map<string, StructuredLogKind>
  liveContents: Map<string, string>
}

function createOpenCodeStreamState(): OpenCodeStreamState {
  return { seenFirstActivity: false, liveKinds: new Map(), liveContents: new Map() }
}

function formatToolState(event: Extract<StreamEvent, { type: 'tool' }>): string {
  const tool = event.tool ?? 'tool'
  const status = event.status ?? 'unknown'
  const title = event.title
  const error = event.error
  const output = event.output

  if (status === 'error') {
    return `${tool} failed${error ? `: ${error}` : '.'}`
  }
  if (status === 'completed') {
    return `${tool} completed${title ? `: ${title}` : output ? `: ${output.slice(0, 160)}` : '.'}`
  }
  if (status === 'running') {
    return `${tool} running${title ? `: ${title}` : '.'}`
  }
  return `${tool} pending.`
}

function emitStructuredPhaseLog(
  ticketId: string,
  ticketExternalId: string,
  phase: string,
  type: LogEventType,
  content: string,
  fields: StructuredLogFields,
) {
  emitPhaseLog(ticketId, ticketExternalId, phase, type, content, fields)
}

function emitAiMilestone(
  ticketId: string,
  ticketExternalId: string,
  phase: string,
  message: string,
  suffix: string,
  extra?: Partial<StructuredLogFields>,
) {
  emitStructuredPhaseLog(ticketId, ticketExternalId, phase, 'info', message, {
    entryId: extra?.entryId ?? `milestone:${phase}:${suffix}`,
    audience: 'all',
    kind: 'milestone',
    op: 'append',
    source: extra?.source ?? 'opencode',
    sessionId: extra?.sessionId,
    modelId: extra?.modelId,
    streaming: false,
    suppressDebugMirror: true,
    ...extra,
  })
}

function emitAiDetail(
  ticketId: string,
  ticketExternalId: string,
  phase: string,
  type: LogEventType,
  content: string,
  fields: StructuredLogFields,
) {
  emitStructuredPhaseLog(ticketId, ticketExternalId, phase, type, content, {
    streaming: fields.streaming ?? true,
    suppressDebugMirror: true,
    ...fields,
  })
}

function emitOpenCodePromptLog(
  ticketId: string,
  ticketExternalId: string,
  phase: string,
  memberId: string,
  event: OpenCodePromptDispatchEvent,
) {
  const source = memberId ? `model:${memberId}` : 'opencode'
  const promptBody = event.promptText.trim()
  const promptHeader = memberId
    ? `[PROMPT] ${memberId} prompt #${event.promptNumber}`
    : `[PROMPT] Prompt #${event.promptNumber}`

  emitAiDetail(
    ticketId,
    ticketExternalId,
    phase,
    'info',
    promptBody ? `${promptHeader}\n${promptBody}` : promptHeader,
    {
      entryId: `${event.session.id}:prompt:${event.promptNumber}`,
      audience: 'ai',
      kind: 'prompt',
      op: 'append',
      source,
      modelId: memberId || undefined,
      sessionId: event.session.id,
      streaming: false,
    },
  )
}

function finalizeOpenCodeParts(
  ticketId: string,
  ticketExternalId: string,
  phase: string,
  memberId: string,
  sessionId: string,
  state: OpenCodeStreamState,
) {
  const source = memberId ? `model:${memberId}` : 'opencode'
  for (const [partId, kind] of state.liveKinds.entries()) {
    const content = state.liveContents.get(partId)
      ?? (kind === 'tool' ? 'Tool event finalized.' : kind === 'step' ? 'Step finalized.' : '')
    emitAiDetail(
      ticketId,
      ticketExternalId,
      phase,
      kind === 'error' ? 'error' : kind === 'text' || kind === 'reasoning' ? 'model_output' : 'info',
      content,
      {
        entryId: `${sessionId}:${partId}`,
        audience: 'ai',
        kind,
        op: 'finalize',
        source,
        modelId: memberId || undefined,
        sessionId,
        streaming: false,
      },
    )
  }
  state.liveKinds.clear()
  state.liveContents.clear()
}

function emitOpenCodeStreamEvent(
  ticketId: string,
  ticketExternalId: string,
  phase: string,
  memberId: string,
  sessionId: string,
  event: StreamEvent,
  state: OpenCodeStreamState,
) {
  const source = memberId ? `model:${memberId}` : 'opencode'

  const emitFirstActivity = () => {
    if (state.seenFirstActivity) return
    state.seenFirstActivity = true
    emitAiMilestone(
      ticketId,
      ticketExternalId,
      phase,
      memberId
        ? `First AI activity observed from ${memberId} (session=${sessionId}).`
        : `First AI activity observed (session=${sessionId}).`,
      `${sessionId}:first-activity`,
      { modelId: memberId || undefined, sessionId, source },
    )
  }

  if (event.type === 'reasoning' || event.type === 'text') {
    emitFirstActivity()
    const partId = event.partId ?? event.messageId ?? event.type
    const kind = event.type === 'reasoning' ? 'reasoning' : 'text'
    state.liveKinds.set(partId, kind)
    state.liveContents.set(partId, event.text)
    emitAiDetail(
      ticketId,
      ticketExternalId,
      phase,
      'model_output',
      event.text,
      {
        entryId: `${sessionId}:${partId}`,
        audience: 'ai',
        kind,
        op: event.complete ? 'finalize' : 'upsert',
        source,
        modelId: memberId || undefined,
        sessionId,
        streaming: event.streaming,
      },
    )
    if (event.complete) {
      state.liveKinds.delete(partId)
      state.liveContents.delete(partId)
    }
    return
  }

  if (event.type === 'tool') {
    emitFirstActivity()
    const partId = event.partId ?? event.callId
    state.liveKinds.set(partId, 'tool')
    state.liveContents.set(partId, formatToolState(event))
    emitAiDetail(
      ticketId,
      ticketExternalId,
      phase,
      'info',
      formatToolState(event),
      {
        entryId: `${sessionId}:${partId}`,
        audience: 'ai',
        kind: 'tool',
        op: event.complete ? 'finalize' : 'upsert',
        source,
        modelId: memberId || undefined,
        sessionId,
        streaming: !event.complete,
      },
    )
    if (event.complete) {
      state.liveKinds.delete(partId)
      state.liveContents.delete(partId)
    }
    return
  }

  if (event.type === 'step') {
    emitFirstActivity()
    const partId = event.partId ?? event.messageId ?? `step:${event.step}`
    state.liveKinds.set(partId, 'step')
    state.liveContents.set(partId, event.step === 'start' ? 'Step started.' : `Step finished${event.reason ? `: ${event.reason}` : '.'}`)
    emitAiDetail(
      ticketId,
      ticketExternalId,
      phase,
      'info',
      state.liveContents.get(partId) ?? 'Step event.',
      {
        entryId: `${sessionId}:${partId}`,
        audience: 'ai',
        kind: 'step',
        op: event.step === 'start' ? 'append' : 'finalize',
        source,
        modelId: memberId || undefined,
        sessionId,
        streaming: event.step === 'start',
      },
    )
    if (event.complete) {
      state.liveKinds.delete(partId)
      state.liveContents.delete(partId)
    }
    return
  }

  if (event.type === 'session_status') {
    if (event.status === 'idle') {
      finalizeOpenCodeParts(ticketId, ticketExternalId, phase, memberId, sessionId, state)
    }

    for (const entry of buildSessionStatusLogEntries(sessionId, event)) {
      emitAiDetail(
        ticketId,
        ticketExternalId,
        phase,
        entry.type,
        entry.content,
        {
          entryId: entry.entryId,
          audience: 'ai',
          kind: entry.kind,
          op: entry.op,
          source,
          modelId: memberId || undefined,
          sessionId,
          streaming: entry.op !== 'append' && event.status !== 'idle',
        },
      )
    }
    return
  }

  if (event.type === 'permission') {
    emitAiDetail(
      ticketId,
      ticketExternalId,
      phase,
      'info',
      event.title ? `Permission requested: ${event.title}` : 'Permission requested.',
      {
        entryId: `${sessionId}:${event.permissionId || 'permission'}`,
        audience: 'ai',
        kind: 'session',
        op: 'append',
        source,
        modelId: memberId || undefined,
        sessionId,
        streaming: false,
      },
    )
    return
  }

  if (event.type === 'session_error') {
    finalizeOpenCodeParts(ticketId, ticketExternalId, phase, memberId, sessionId, state)
    emitAiDetail(
      ticketId,
      ticketExternalId,
      phase,
      'error',
      event.error,
      {
        entryId: `${sessionId}:error`,
        audience: 'ai',
        kind: 'error',
        op: 'append',
        source,
        modelId: memberId || undefined,
        sessionId,
        streaming: false,
      },
    )
    emitAiMilestone(
      ticketId,
      ticketExternalId,
      phase,
      memberId
        ? `AI session failed for ${memberId} (session=${sessionId}).`
        : `AI session failed (session=${sessionId}).`,
      `${sessionId}:failed`,
      { modelId: memberId || undefined, sessionId, source },
    )
    return
  }

  if (event.type === 'part_removed') {
    const partId = event.partId
    if (partId) {
      state.liveKinds.delete(partId)
      state.liveContents.delete(partId)
    }
    return
  }

  if (event.type === 'done') {
    finalizeOpenCodeParts(ticketId, ticketExternalId, phase, memberId, sessionId, state)
    emitAiMilestone(
      ticketId,
      ticketExternalId,
      phase,
      memberId
        ? `AI session completed for ${memberId} (session=${sessionId}).`
        : `AI session completed (session=${sessionId}).`,
      `${sessionId}:completed`,
      { modelId: memberId || undefined, sessionId, source },
    )
  }
}

function extractOpenCodeMessageLines(messages: Message[]): string[] {
  const lines: string[] = []

  for (const message of messages) {
    const record = message as unknown as Record<string, unknown>
    const directRole = typeof record.role === 'string' ? record.role : undefined
    const directContent = typeof record.content === 'string' ? record.content : undefined
    const directTimestamp = typeof record.timestamp === 'string' ? record.timestamp : undefined

    if (directContent) {
      lines.push(`[${directRole ?? 'message'}]${directTimestamp ? ` [${directTimestamp}]` : ''} ${directContent}`)
      continue
    }

    const info = (record.info && typeof record.info === 'object')
      ? (record.info as Record<string, unknown>)
      : null
    const role = info && typeof info.sender === 'string'
      ? info.sender
      : info && typeof info.role === 'string'
        ? info.role
        : info && typeof info.author === 'string'
          ? info.author
          : 'message'
    const timestamp = info && typeof info.timestamp === 'string' ? info.timestamp : undefined

    const parts = Array.isArray(record.parts) ? record.parts : []
    if (parts.length === 0) {
      lines.push(`[${role}]${timestamp ? ` [${timestamp}]` : ''} ${stringifyForLog(record)}`)
      continue
    }

    for (const part of parts) {
      const partRecord = (part && typeof part === 'object') ? (part as Record<string, unknown>) : null
      if (!partRecord) continue

      const partType = typeof partRecord.type === 'string' ? partRecord.type : 'part'
      const text = typeof partRecord.text === 'string'
        ? partRecord.text
        : typeof partRecord.content === 'string'
          ? partRecord.content
          : typeof partRecord.output === 'string'
            ? partRecord.output
            : typeof partRecord.value === 'string'
              ? partRecord.value
              : stringifyForLog(partRecord)

      lines.push(`[${role}/${partType}]${timestamp ? ` [${timestamp}]` : ''} ${text}`)
    }
  }

  return lines
}

function emitOpenCodeSessionLogs(
  ticketId: string,
  ticketExternalId: string,
  phase: string,
  memberId: string,
  sessionId: string,
  stage: 'draft' | 'vote' | 'refine' | 'coverage',
  response: string,
  messages: Message[],
) {
  emitPhaseLog(
    ticketId,
    ticketExternalId,
    phase,
    'info',
    `OpenCode ${stage}: ${memberId} session=${sessionId}, messages=${messages.length}, responseChars=${response.length}.`,
  )
  const transcriptLines = extractOpenCodeMessageLines(messages)
  const transcriptPreview = transcriptLines[transcriptLines.length - 1] ?? response
  if (transcriptPreview) {
    emitAiDetail(
      ticketId,
      ticketExternalId,
      phase,
      'model_output',
      transcriptPreview,
      {
        entryId: `${sessionId}:transcript-summary`,
        audience: 'ai',
        kind: 'session',
        op: 'append',
        source: `model:${memberId}`,
        modelId: memberId,
        sessionId,
        streaming: false,
      },
    )
  }

  emitDebugLog(ticketId, phase, `opencode.${stage}.response`, { memberId, response })
  for (const message of messages) {
    emitDebugLog(ticketId, phase, `opencode.${stage}.raw_message`, { memberId, message })
  }
}

function mapCouncilStageToStatus(
  flow: 'interview' | 'prd' | 'beads',
  stage: 'draft' | 'vote' | 'refine',
): string {
  if (flow === 'interview') {
    if (stage === 'draft') return 'COUNCIL_DELIBERATING'
    if (stage === 'vote') return 'COUNCIL_VOTING_INTERVIEW'
    return 'COMPILING_INTERVIEW'
  }
  if (flow === 'prd') {
    if (stage === 'draft') return 'DRAFTING_PRD'
    if (stage === 'vote') return 'COUNCIL_VOTING_PRD'
    return 'REFINING_PRD'
  }
  if (stage === 'draft') return 'DRAFTING_BEADS'
  if (stage === 'vote') return 'COUNCIL_VOTING_BEADS'
  return 'REFINING_BEADS'
}

function formatCouncilMemberRoster(members: Array<{ modelId: string; name: string }>): string {
  return members.map(member => member.modelId).join(', ')
}

function describeCouncilMemberSource(source: 'locked_ticket' | 'profile'): string {
  if (source === 'locked_ticket') return 'locked ticket config'
  return 'profile config'
}

function formatCouncilResolutionLog(
  context: TicketContext,
  council: {
    members: Array<{ modelId: string; name: string }>
    source: 'locked_ticket' | 'profile'
  },
): string {
  const implementer = context.lockedMainImplementer ?? 'not configured'
  return `Council members resolved from ${describeCouncilMemberSource(council.source)}: ${council.members.length} members (${formatCouncilMemberRoster(council.members)}). Main implementer: ${implementer}.`
}

function resolveInterviewDraftSettings(context: TicketContext): {
  maxInitialQuestions: number
  coverageFollowUpBudgetPercent: number
  draftTimeoutMs: number
  minQuorum: number
  userBackground: string | null
  disableAnalogies: boolean
} {
  const councilSettings = resolveCouncilRuntimeSettings(context)
  const storedContext = getStoredTicketContext(context.ticketId)
  const profile = appDb.select().from(profiles).get()
  const maxInitialQuestions = context.lockedInterviewQuestions
    ?? storedContext?.localProject.interviewQuestions
    ?? profile?.interviewQuestions
    ?? 50

  return {
    maxInitialQuestions,
    coverageFollowUpBudgetPercent: resolveCoverageRuntimeSettings(context).coverageFollowUpBudgetPercent,
    draftTimeoutMs: councilSettings.draftTimeoutMs,
    minQuorum: councilSettings.minQuorum,
    userBackground: context.lockedUserBackground ?? profile?.background ?? null,
    disableAnalogies: context.lockedDisableAnalogies ?? Boolean(profile?.disableAnalogies),
  }
}

function resolveCoverageRuntimeSettings(context: TicketContext): {
  coverageFollowUpBudgetPercent: number
  maxCoveragePasses: number
} {
  const profile = appDb.select().from(profiles).get()

  return {
    coverageFollowUpBudgetPercent: context.lockedCoverageFollowUpBudgetPercent
      ?? profile?.coverageFollowUpBudgetPercent
      ?? PROFILE_DEFAULTS.coverageFollowUpBudgetPercent,
    maxCoveragePasses: context.lockedMaxCoveragePasses
      ?? profile?.maxCoveragePasses
      ?? PROFILE_DEFAULTS.maxCoveragePasses,
  }
}

function getCoverageStateLabel(phase: 'interview' | 'prd' | 'beads'): string {
  return phase === 'interview'
    ? 'VERIFYING_INTERVIEW_COVERAGE'
    : phase === 'prd'
      ? 'VERIFYING_PRD_COVERAGE'
      : 'VERIFYING_BEADS_COVERAGE'
}

function getCoverageContextPhase(phase: 'interview' | 'prd' | 'beads'): 'interview_coverage' | 'prd_coverage' | 'beads_coverage' {
  return phase === 'interview'
    ? 'interview_coverage'
    : phase === 'prd'
      ? 'prd_coverage'
      : 'beads_coverage'
}

function getCoveragePromptTemplate(phase: 'interview' | 'prd' | 'beads') {
  return phase === 'interview' ? PROM5 : phase === 'prd' ? PROM13 : PROM24
}

function describeCoverageTerminationReason(reason: string): string {
  if (reason === 'coverage_pass_limit_reached') return 'retry cap reached'
  if (reason === 'follow_up_budget_exhausted') return 'follow-up budget exhausted'
  if (reason === 'follow_up_generation_failed') return 'follow-up generation failed'
  return 'manual review required'
}

function buildCoveragePromptConfiguration(input: {
  phase: 'interview' | 'prd' | 'beads'
  coverageRunNumber: number
  maxCoveragePasses: number
  isFinalAllowedRun: boolean
  coverageFollowUpBudgetPercent?: number
  followUpBudgetTotal?: number
  followUpBudgetUsed?: number
  followUpBudgetRemaining?: number
}): PromptPart {
  const lines = [
    '## Coverage Configuration',
    `coverage_domain: ${input.phase}`,
    `coverage_run_number: ${input.coverageRunNumber}`,
    `max_coverage_passes: ${input.maxCoveragePasses}`,
    `is_final_coverage_run: ${input.isFinalAllowedRun ? 'true' : 'false'}`,
    input.isFinalAllowedRun
      ? 'This is the final allowed coverage run. If gaps remain, report them clearly and do not assume another retry or refinement loop exists.'
      : 'At most one more coverage run may occur after this one if real gaps remain.',
  ]

  if (input.phase === 'interview') {
    lines.push(
      `coverage_follow_up_budget_percent: ${input.coverageFollowUpBudgetPercent ?? PROFILE_DEFAULTS.coverageFollowUpBudgetPercent}`,
      `follow_up_budget_total: ${input.followUpBudgetTotal ?? 0}`,
      `follow_up_budget_used: ${input.followUpBudgetUsed ?? 0}`,
      `follow_up_budget_remaining: ${input.followUpBudgetRemaining ?? 0}`,
      (input.followUpBudgetRemaining ?? 0) === 0
        ? 'If gaps remain and follow_up_budget_remaining is 0, you MUST return `status: gaps`, concrete `gaps`, and `follow_up_questions: []`.'
        : 'If gaps remain, generate only the targeted follow-up questions that fit within follow_up_budget_remaining.',
    )
  }

  return {
    type: 'text',
    source: 'coverage_settings',
    content: lines.join('\n'),
  }
}

function buildInterviewVotePrompt(
  ticketState: TicketState,
  anonymizedDrafts: string[],
  rubric: Array<{ category: string; weight: number; description: string }>,
) {
  const voteContext = [
    ...buildMinimalContext('interview_vote', {
      ...ticketState,
      drafts: anonymizedDrafts,
    }),
    {
      type: 'text' as const,
      source: 'vote_rubric',
      content: [
        'Detailed scoring rubric:',
        ...rubric.map(item => `- ${item.category} (${item.weight}pts): ${item.description}`),
        '',
        'Use the exact PROM2 `draft_scores` YAML schema. Keep the exact draft labels, include only rubric integer fields plus `total_score`, and do not add prose or extra keys.',
      ].join('\n'),
    },
  ]
  return [{ type: 'text' as const, content: buildPromptFromTemplate(PROM2, voteContext) }]
}

function buildInterviewRefinePrompt(
  ticketState: TicketState,
  winnerDraft: DraftResult,
  losingDrafts: DraftResult[],
) {
  const refineContext = buildMinimalContext('interview_refine', {
    ...ticketState,
    drafts: [
      ['## Winning Draft', winnerDraft.content].join('\n'),
      ...losingDrafts.map((draft, index) => [
        `## Alternative Draft ${index + 1}`,
        draft.content,
      ].join('\n')),
    ],
  })
  return [{ type: 'text' as const, content: buildPromptFromTemplate(PROM3, refineContext) }]
}

function resolveCouncilRuntimeSettings(context: TicketContext): {
  draftTimeoutMs: number
  minQuorum: number
} {
  const storedContext = getStoredTicketContext(context.ticketId)
  const profile = appDb.select().from(profiles).get()
  const draftTimeoutMs = storedContext?.localProject.councilResponseTimeout
    ?? profile?.councilResponseTimeout
    ?? PROFILE_DEFAULTS.councilResponseTimeout
  const minQuorum = storedContext?.localProject.minCouncilQuorum
    ?? profile?.minCouncilQuorum
    ?? PROFILE_DEFAULTS.minCouncilQuorum

  return {
    draftTimeoutMs,
    minQuorum,
  }
}

function resolveExecutionRuntimeSettings(context: TicketContext): {
  maxIterations: number
  perIterationTimeoutMs: number
} {
  const storedContext = getStoredTicketContext(context.ticketId)
  const profile = appDb.select().from(profiles).get()
  const maxIterations = storedContext?.localProject.maxIterations
    ?? profile?.maxIterations
    ?? context.maxIterations
    ?? PROFILE_DEFAULTS.maxIterations
  const perIterationTimeoutMs = storedContext?.localProject.perIterationTimeout
    ?? profile?.perIterationTimeout
    ?? PROFILE_DEFAULTS.perIterationTimeout

  return {
    maxIterations,
    perIterationTimeoutMs,
  }
}

function formatDurationMs(durationMs: number): string {
  if (durationMs >= 60000) return `${(durationMs / 60000).toFixed(1)}m`
  if (durationMs >= 1000) return `${(durationMs / 1000).toFixed(1)}s`
  return `${durationMs}ms`
}

function formatDraftRoundSummary(
  label: string,
  elapsedMs: number,
  timeoutMs: number,
  deadlineReached: boolean,
  summary: {
    completed: number
    timedOut: number
    failed: number
    invalidOutput: number
  },
) {
  const timing = deadlineReached
    ? `reached configured deadline (${timeoutMs}ms)`
    : `completed in ${formatDurationMs(elapsedMs)}`

  return `${label} ${timing}: completed=${summary.completed}, timed_out=${summary.timedOut}, failed=${summary.failed}, invalid_output=${summary.invalidOutput}.`
}

function summarizeDraftOutcomes(drafts: DraftResult[]) {
  return drafts.reduce(
    (summary, draft) => {
      if (draft.outcome === 'completed') summary.completed++
      else if (draft.outcome === 'timed_out') summary.timedOut++
      else if (draft.outcome === 'failed') summary.failed++
      else summary.invalidOutput++
      return summary
    },
    { completed: 0, timedOut: 0, invalidOutput: 0, failed: 0 },
  )
}

function emitDraftProgressInfoLog(
  ticketId: string,
  ticketExternalId: string,
  phase: string,
  label: string,
  entry: DraftProgressEvent,
) {
  if (entry.status === 'session_created' && entry.sessionId) {
    emitAiDetail(
      ticketId,
      ticketExternalId,
      phase,
      'info',
      `${label} draft session created for ${entry.memberId}: ${entry.sessionId}.`,
      {
        entryId: `${entry.sessionId}:created`,
        audience: 'ai',
        kind: 'session',
        op: 'append',
        source: `model:${entry.memberId}`,
        modelId: entry.memberId,
        sessionId: entry.sessionId,
        streaming: false,
      },
    )
    return
  }

  if (entry.status === 'finished' && entry.outcome && entry.outcome !== 'completed') {
    const detail = entry.outcome === 'timed_out'
      ? 'timed out'
      : entry.outcome === 'invalid_output'
        ? `invalid output (${entry.error ?? 'malformed response'})`
        : `failed (${entry.error ?? 'runtime error'})`
    const durationText = typeof entry.duration === 'number' ? ` after ${formatDurationMs(entry.duration)}` : ''
    const sessionText = entry.sessionId ? ` session=${entry.sessionId}` : ''
    emitAiDetail(
      ticketId,
      ticketExternalId,
      phase,
      'error',
      `${label} draft ${detail} for ${entry.memberId}${sessionText}${durationText}.`,
      {
        entryId: `${entry.sessionId ?? `${phase}:${entry.memberId}`}:draft-finished`,
        audience: 'ai',
        kind: 'error',
        op: 'append',
        source: `model:${entry.memberId}`,
        modelId: entry.memberId,
        sessionId: entry.sessionId,
        streaming: false,
      },
    )
  }
}

function createPendingDrafts(members: Array<{ modelId: string }>): DraftResult[] {
  return members.map(member => ({
    memberId: member.modelId,
    content: '',
    outcome: 'pending',
    duration: 0,
  }))
}

function tryBuildInterviewQuestionPreview(label: string, content?: string): string | null {
  if (!content?.trim()) return null

  try {
    const questions = parseInterviewQuestions(content, { allowTopLevelArray: true })
    if (questions.length === 0) return null
    return formatInterviewQuestionPreview(label, questions)
  } catch {
    return null
  }
}

function upsertCouncilDraftArtifact(
  ticketId: string,
  phase: string,
  artifactType: string,
  drafts: DraftResult[],
  memberOutcomes?: Record<string, MemberOutcome>,
  isFinal: boolean = false,
) {
  const resolvedOutcomes = memberOutcomes ?? drafts.reduce<Record<string, MemberOutcome>>(
    (acc, draft) => {
      acc[draft.memberId] = draft.outcome
      return acc
    },
    {},
  )

  upsertLatestPhaseArtifact(ticketId, artifactType, phase, JSON.stringify({
    phase: artifactType.replace(/s$/, ''),
    drafts,
    memberOutcomes: resolvedOutcomes,
    isFinal,
  }))
}

function upsertCouncilVoteArtifact(
  ticketId: string,
  phase: string,
  artifactType: string,
  drafts: DraftResult[],
  votes: Vote[],
  memberOutcomes: Record<string, MemberOutcome>,
  presentationOrders?: Record<string, VotePresentationOrder>,
  winnerId?: string,
  totalScore?: number,
  isFinal: boolean = false,
) {
  upsertLatestPhaseArtifact(ticketId, artifactType, phase, JSON.stringify({
    drafts,
    votes,
    voterOutcomes: memberOutcomes,
    ...(presentationOrders ? { presentationOrders } : {}),
    ...(winnerId ? { winnerId } : {}),
    ...(typeof totalScore === 'number' ? { totalScore } : {}),
    isFinal,
  }))
}

function collectMembersByOutcome(
  memberOutcomes: Record<string, MemberOutcome>,
  outcome: MemberOutcome,
) {
  return Object.entries(memberOutcomes)
    .filter(([, memberOutcome]) => memberOutcome === outcome)
    .map(([memberId]) => memberId)
}

function emitCouncilDecisionLogs(
  ticketId: string,
  externalId: string,
  phase: string,
  timeoutMs: number,
  deadlineReached: boolean,
  memberOutcomes: Record<string, MemberOutcome>,
  quorum: { passed: boolean; message: string },
  nextStatus: string,
) {
  const completedMembers = collectMembersByOutcome(memberOutcomes, 'completed')
  const timedOutMembers = collectMembersByOutcome(memberOutcomes, 'timed_out')

  emitPhaseLog(
    ticketId,
    externalId,
    phase,
    'info',
    deadlineReached
      ? `Council response deadline reached after ${timeoutMs}ms. completed_members=${completedMembers.length > 0 ? completedMembers.join(', ') : 'none'}. timed_out_members=${timedOutMembers.length > 0 ? timedOutMembers.join(', ') : 'none'}.`
      : `Council responses settled before the ${timeoutMs}ms deadline. completed_members=${completedMembers.length > 0 ? completedMembers.join(', ') : 'none'}. timed_out_members=${timedOutMembers.length > 0 ? timedOutMembers.join(', ') : 'none'}.`,
  )
  emitPhaseLog(
    ticketId,
    externalId,
    phase,
    quorum.passed ? 'info' : 'error',
    `Council quorum ${quorum.passed ? 'passed' : 'failed'}: ${quorum.message}.`,
  )
  emitPhaseLog(
    ticketId,
    externalId,
    phase,
    'info',
    `Council transition selected: ${nextStatus}.`,
  )
}

async function handleInterviewDeliberate(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  signal: AbortSignal,
) {
  const phase = 'COUNCIL_DELIBERATING' as const
  const { worktreePath, ticket, codebaseMap } = loadTicketDirContext(context)

  emitPhaseLog(
    ticketId,
    context.externalId,
    phase,
    'info',
    `Ticket workspace ready for council drafting at ${worktreePath}.`,
  )

  // Step 1: Health-check OpenCode before doing any work
  throwIfAborted(signal, ticketId)
  try {
    const health = await raceWithCancel(adapter.checkHealth(), signal, ticketId)
    throwIfAborted(signal, ticketId)
    if (!health.available) {
      const msg = `OpenCode server is not running. Start it with \`opencode serve\`. (${health.error ?? 'connection refused'})`
      emitPhaseLog(ticketId, context.externalId, phase, 'error', msg)
      throw new Error(msg)
    }
    emitPhaseLog(
      ticketId,
      context.externalId,
      phase,
      'info',
      `OpenCode health check passed${health.version ? ` (version=${health.version})` : ''}.`,
    )
  } catch (err) {
    throwIfCancelled(err, signal, ticketId)
    // Re-throw if we already formatted the message
    if (err instanceof Error && err.message.startsWith('OpenCode server is not running')) throw err
    const msg = `OpenCode server is not running. Start it with \`opencode serve\`. (${err instanceof Error ? err.message : String(err)})`
    emitPhaseLog(ticketId, context.externalId, phase, 'error', msg)
    throw new Error(msg)
  }

  // Step 2: Resolve council members from locked config (frozen at ticket start)
  const council = resolveCouncilMembers(context)
  const members = council.members
  emitPhaseLog(
    ticketId,
    context.externalId,
    phase,
    'info',
    formatCouncilResolutionLog(context, council),
  )

  const ticketDescription = ticket?.description ?? ''
  emitPhaseLog(ticketId, context.externalId, phase, 'info', `Loaded codebase map artifact (${codebaseMap.length} chars).`)
  const draftSettings = resolveInterviewDraftSettings(context)

  // Build context via buildMinimalContext with full ticket state
  const ticketState: TicketState = {
    ticketId: context.externalId,
    title: context.title,
    description: ticketDescription,
    codebaseMap,
  }
  const ticketContext = buildMinimalContext('interview_draft', ticketState)

  emitPhaseLog(ticketId, context.externalId, phase, 'info', `Interview council drafting started. Context: ${ticketContext.length} parts, description=${ticketDescription.length > 0 ? 'present' : 'missing'}, codebaseMap=${codebaseMap ? 'loaded' : 'missing'}.`)
  emitPhaseLog(
    ticketId,
    context.externalId,
    phase,
    'info',
    `Interview draft settings: max_initial_questions=${draftSettings.maxInitialQuestions}, council_response_timeout=${draftSettings.draftTimeoutMs}ms, min_council_quorum=${draftSettings.minQuorum}.`,
  )
  emitPhaseLog(ticketId, context.externalId, phase, 'info', `Dispatching interview draft requests to ${members.length} council members.`)

  if (signal.aborted) throw new CancelledError(ticketId)
  const startedAt = Date.now()
  const streamStates = new Map<string, OpenCodeStreamState>()
  const liveDrafts = createPendingDrafts(members)
  upsertCouncilDraftArtifact(ticketId, phase, 'interview_drafts', liveDrafts)
  const result = await deliberateInterview(
    adapter,
    members,
    ticketContext,
    worktreePath,
    {
      ...draftSettings,
      ticketId,
    },
    signal,
    (entry) => {
      const targetStatus = mapCouncilStageToStatus('interview', entry.stage)
      emitOpenCodeSessionLogs(
        ticketId,
        context.externalId,
        targetStatus,
        entry.memberId,
        entry.sessionId,
        entry.stage,
        entry.response,
        entry.messages,
      )
    },
    (entry) => {
      const targetStatus = mapCouncilStageToStatus('interview', entry.stage)
      const streamState = streamStates.get(entry.sessionId) ?? createOpenCodeStreamState()
      streamStates.set(entry.sessionId, streamState)
      emitOpenCodeStreamEvent(
        ticketId,
        context.externalId,
        targetStatus,
        entry.memberId,
        entry.sessionId,
        entry.event,
        streamState,
      )
    },
    (entry) => {
      const targetStatus = mapCouncilStageToStatus('interview', entry.stage)
      emitOpenCodePromptLog(
        ticketId,
        context.externalId,
        targetStatus,
        entry.memberId,
        entry.event,
      )
    },
    (entry) => {
      emitDraftProgressInfoLog(ticketId, context.externalId, phase, 'Interview', entry)
      if (entry.status !== 'finished' || !entry.outcome) return
      const draftIndex = liveDrafts.findIndex(draft => draft.memberId === entry.memberId)
      if (draftIndex < 0) return
      liveDrafts[draftIndex] = {
        ...liveDrafts[draftIndex]!,
        content: entry.content ?? liveDrafts[draftIndex]!.content,
        outcome: entry.outcome,
        duration: entry.duration ?? liveDrafts[draftIndex]!.duration,
        error: entry.error,
        questionCount: entry.questionCount,
      }
      upsertCouncilDraftArtifact(ticketId, phase, 'interview_drafts', liveDrafts)

      if (entry.outcome !== 'completed') return

      const questionPreview = tryBuildInterviewQuestionPreview(
        `Questions received from ${entry.memberId}`,
        entry.content,
      )
      if (!questionPreview) return

      emitAiDetail(
        ticketId,
        context.externalId,
        phase,
        'model_output',
        questionPreview,
        {
          entryId: `${entry.sessionId ?? `${phase}:${entry.memberId}`}:questions-preview`,
          audience: 'ai',
          kind: 'text',
          op: 'append',
          source: `model:${entry.memberId}`,
          modelId: entry.memberId,
          sessionId: entry.sessionId,
          streaming: false,
        },
      )
    },
  )

  const draftSummary = summarizeDraftOutcomes(result.drafts)
  emitPhaseLog(
    ticketId,
    context.externalId,
    phase,
    'info',
    formatDraftRoundSummary(
      'Interview draft round',
      Date.now() - startedAt,
      draftSettings.draftTimeoutMs,
      Boolean(result.deadlineReached),
      draftSummary,
    ),
  )
  const quorum = checkQuorum(result.drafts, draftSettings.minQuorum)
  const nextStatus = quorum.passed ? 'COUNCIL_VOTING_INTERVIEW' : 'BLOCKED_ERROR'
  emitCouncilDecisionLogs(
    ticketId,
    context.externalId,
    phase,
    draftSettings.draftTimeoutMs,
    Boolean(result.deadlineReached),
    result.memberOutcomes,
    quorum,
    nextStatus,
  )

  for (const draft of result.drafts) {
    const detail = draft.outcome === 'timed_out'
      ? 'timed out'
      : draft.outcome === 'invalid_output'
        ? `invalid output${draft.error ? ` (${draft.error})` : ''}`
        : draft.outcome === 'failed'
          ? `failed${draft.error ? ` (${draft.error})` : ''}`
          : `proposed ${draft.questionCount ?? 0} questions`
    emitAiDetail(
      ticketId,
      context.externalId,
      'COUNCIL_DELIBERATING',
      'model_output',
      `${draft.memberId} ${detail}.`,
      {
        entryId: `draft-summary:${draft.memberId}`,
        audience: 'ai',
        kind: draft.outcome === 'completed' ? 'text' : 'error',
        op: 'append',
        source: `model:${draft.memberId}`,
        modelId: draft.memberId,
        sessionId: undefined,
        streaming: false,
        outcome: draft.outcome,
        duration: draft.duration,
        ...(draft.questionCount !== undefined ? { questionCount: draft.questionCount } : {}),
        ...(draft.error ? { error: draft.error } : {}),
      },
    )
  }

  upsertCouncilDraftArtifact(ticketId, phase, 'interview_drafts', result.drafts, result.memberOutcomes, true)
  emitPhaseLog(
    ticketId,
    context.externalId,
    phase,
    'info',
    `Saved interview draft artifact with ${Object.keys(result.memberOutcomes).length} member outcomes.`,
  )

  if (!quorum.passed) {
    throw new Error(`Council quorum not met for interview_draft: ${quorum.message}`)
  }

  // Store intermediate data for vote/refine steps
  phaseIntermediate.set(`${ticketId}:interview`, {
    drafts: result.drafts,
    memberOutcomes: result.memberOutcomes,
    worktreePath,
    phase: result.phase,
    ticketState,
  })

  sendEvent({ type: 'QUESTIONS_READY', result: result as unknown as Record<string, unknown> })

  emitStateChange(ticketId, context.externalId, phase, 'COUNCIL_VOTING_INTERVIEW')
}

async function handleInterviewVote(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  signal: AbortSignal,
) {
  const intermediate = phaseIntermediate.get(`${ticketId}:interview`)
  if (!intermediate) {
    throw new Error('No interview drafts found — cannot vote')
  }

  const { members } = resolveCouncilMembers(context)
  const councilSettings = resolveCouncilRuntimeSettings(context)
  const interviewTicketState = intermediate.ticketState ?? (() => {
    const { ticket, codebaseMap } = loadTicketDirContext(context)
    return {
      ticketId: context.externalId,
      title: context.title,
      description: ticket?.description ?? '',
      codebaseMap,
    } satisfies TicketState
  })()
  const streamStates = new Map<string, OpenCodeStreamState>()
  const liveVotes: Vote[] = []
  const liveVoterOutcomes = members.reduce<Record<string, MemberOutcome>>((acc, member) => {
    acc[member.modelId] = 'pending'
    return acc
  }, {})

  emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_INTERVIEW', 'info',
    `Interview voting started with ${members.length} council members on ${intermediate.drafts.filter(d => d.outcome === 'completed').length} drafts.`)
  upsertCouncilVoteArtifact(ticketId, 'COUNCIL_VOTING_INTERVIEW', 'interview_votes', intermediate.drafts, [], liveVoterOutcomes)

  if (signal.aborted) throw new CancelledError(ticketId)
  const voteRun = await conductVoting(
    adapter,
    members,
    intermediate.drafts,
    [],
    intermediate.worktreePath,
    intermediate.phase,
    councilSettings.draftTimeoutMs,
    signal,
    (entry) => {
      emitOpenCodeSessionLogs(
        ticketId,
        context.externalId,
        'COUNCIL_VOTING_INTERVIEW',
        entry.memberId,
        entry.sessionId,
        entry.stage,
        entry.response,
        entry.messages,
      )
    },
    (entry) => {
      const streamState = streamStates.get(entry.sessionId) ?? createOpenCodeStreamState()
      streamStates.set(entry.sessionId, streamState)
      emitOpenCodeStreamEvent(
        ticketId,
        context.externalId,
        'COUNCIL_VOTING_INTERVIEW',
        entry.memberId,
        entry.sessionId,
        entry.event,
        streamState,
      )
    },
    (entry) => {
      emitOpenCodePromptLog(
        ticketId,
        context.externalId,
        'COUNCIL_VOTING_INTERVIEW',
        entry.memberId,
        entry.event,
      )
    },
    (entry) => {
      liveVoterOutcomes[entry.memberId] = entry.outcome
      if (entry.votes.length > 0) liveVotes.push(...entry.votes)
      upsertCouncilVoteArtifact(ticketId, 'COUNCIL_VOTING_INTERVIEW', 'interview_votes', intermediate.drafts, liveVotes, liveVoterOutcomes)
    },
    ({ anonymizedDrafts, rubric }) => buildInterviewVotePrompt(
      interviewTicketState,
      anonymizedDrafts.map(draft => draft.content),
      rubric,
    ),
    {
      ticketId,
      phase: 'COUNCIL_VOTING_INTERVIEW',
    },
  )

  const voteQuorum = checkMemberResponseQuorum(voteRun.memberOutcomes, councilSettings.minQuorum)
  const nextVoteStatus = voteQuorum.passed ? 'COMPILING_INTERVIEW' : 'BLOCKED_ERROR'
  emitCouncilDecisionLogs(
    ticketId,
    context.externalId,
    'COUNCIL_VOTING_INTERVIEW',
    councilSettings.draftTimeoutMs,
    voteRun.deadlineReached,
    voteRun.memberOutcomes,
    voteQuorum,
    nextVoteStatus,
  )

  if (!voteQuorum.passed) {
    upsertCouncilVoteArtifact(
      ticketId,
      'COUNCIL_VOTING_INTERVIEW',
      'interview_votes',
      intermediate.drafts,
      voteRun.votes,
      voteRun.memberOutcomes,
      voteRun.presentationOrders,
      undefined,
      undefined,
      true,
    )
    throw new Error(`Interview voting quorum not met: ${voteQuorum.message}`)
  }

  if (voteRun.votes.length === 0) {
    throw new Error('Interview voting failed: no valid vote responses received')
  }

  const { winnerId, totalScore } = selectWinner(voteRun.votes, members)

  // Store vote results for refine step
  intermediate.votes = voteRun.votes
  intermediate.presentationOrders = voteRun.presentationOrders
  intermediate.winnerId = winnerId

  upsertCouncilVoteArtifact(
    ticketId,
    'COUNCIL_VOTING_INTERVIEW',
    'interview_votes',
    intermediate.drafts,
    voteRun.votes,
    voteRun.memberOutcomes,
    voteRun.presentationOrders,
    winnerId,
    totalScore,
    true,
  )
  emitPhaseLog(
    ticketId,
    context.externalId,
    'COUNCIL_VOTING_INTERVIEW',
    'info',
    `Interview voting selected winner: ${winnerId} (score: ${totalScore}).`,
  )
  sendEvent({ type: 'WINNER_SELECTED', winner: winnerId })
  emitStateChange(ticketId, context.externalId, 'COUNCIL_VOTING_INTERVIEW', 'COMPILING_INTERVIEW')
}

async function handleInterviewCompile(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  signal: AbortSignal,
) {
  const intermediate = phaseIntermediate.get(`${ticketId}:interview`)
  if (!intermediate || !intermediate.winnerId) {
    throw new Error('No interview vote results found — cannot refine')
  }

  const winnerDraft = intermediate.drafts.find(d => d.memberId === intermediate.winnerId)!
  const losingDrafts = intermediate.drafts.filter(d => d.memberId !== intermediate.winnerId && d.outcome === 'completed')
  const councilSettings = resolveCouncilRuntimeSettings(context)
  const interviewTicketState = intermediate.ticketState ?? (() => {
    const { ticket, codebaseMap } = loadTicketDirContext(context)
    return {
      ticketId: context.externalId,
      title: context.title,
      description: ticket?.description ?? '',
      codebaseMap,
    } satisfies TicketState
  })()
  const streamStates = new Map<string, OpenCodeStreamState>()

  emitPhaseLog(ticketId, context.externalId, 'COMPILING_INTERVIEW', 'info',
    `Interview refinement started. Winner: ${intermediate.winnerId}, incorporating ideas from ${losingDrafts.length} alternative drafts.`)

  if (signal.aborted) throw new CancelledError(ticketId)
  let structuredMeta = buildStructuredMetadata({ autoRetryCount: 0, repairApplied: false, repairWarnings: [] })
  const refinedContent = await refineDraft(
    adapter,
    winnerDraft,
    losingDrafts,
    [],
    intermediate.worktreePath,
    councilSettings.draftTimeoutMs,
    signal,
    (entry) => {
      emitOpenCodeSessionLogs(
        ticketId,
        context.externalId,
        'COMPILING_INTERVIEW',
        entry.memberId,
        entry.sessionId,
        entry.stage,
        entry.response,
        entry.messages,
      )
    },
    (entry) => {
      const streamState = streamStates.get(entry.sessionId) ?? createOpenCodeStreamState()
      streamStates.set(entry.sessionId, streamState)
      emitOpenCodeStreamEvent(
        ticketId,
        context.externalId,
        'COMPILING_INTERVIEW',
        entry.memberId,
        entry.sessionId,
        entry.event,
        streamState,
      )
    },
    (entry) => {
      emitOpenCodePromptLog(
        ticketId,
        context.externalId,
        'COMPILING_INTERVIEW',
        entry.memberId,
        entry.event,
      )
    },
    {
      ticketId,
      phase: 'COMPILING_INTERVIEW',
    },
    (activeWinnerDraft, activeLosingDrafts) => buildInterviewRefinePrompt(
      interviewTicketState,
      activeWinnerDraft,
      activeLosingDrafts,
    ),
    (content) => {
      const result = normalizeInterviewRefinementOutput(
        content,
        winnerDraft.content,
        resolveInterviewDraftSettings(context).maxInitialQuestions,
      )
      if (!result.ok) {
        structuredMeta = buildStructuredMetadata(structuredMeta, {
          autoRetryCount: 1,
          validationError: result.error,
        })
        throw new Error(result.error)
      }
      structuredMeta = buildStructuredMetadata(structuredMeta, {
        repairApplied: result.repairApplied,
        repairWarnings: result.repairWarnings,
        autoRetryCount: structuredMeta.autoRetryCount,
      })
      return { normalizedContent: result.normalizedContent }
    },
    PROM3.outputFormat,
  )

  // Clean up intermediate data
  phaseIntermediate.delete(`${ticketId}:interview`)

  try {
    const compiledArtifact = buildCompiledInterviewArtifact(
      intermediate.winnerId,
      refinedContent,
      winnerDraft.content,
      resolveInterviewDraftSettings(context).maxInitialQuestions,
    )

    insertPhaseArtifact(ticketId, {
      phase: 'COMPILING_INTERVIEW',
      artifactType: 'interview_compiled',
      content: JSON.stringify({
        ...compiledArtifact,
        structuredOutput: structuredMeta,
      }),
    })

    // Persist winnerId separately so it survives server restarts and is available
    // for VERIFYING_INTERVIEW_COVERAGE and downstream phases (PROM4/PROM5 wiring)
    insertPhaseArtifact(ticketId, {
      phase: 'COMPILING_INTERVIEW',
      artifactType: 'interview_winner',
      content: JSON.stringify({ winnerId: intermediate.winnerId }),
    })

    emitPhaseLog(
      ticketId,
      context.externalId,
      'COMPILING_INTERVIEW',
      'info',
      `Compiled final interview from winner ${intermediate.winnerId}. Validated ${compiledArtifact.questionCount} normalized questions.`,
    )
    const compiledQuestionPreview = tryBuildInterviewQuestionPreview(
      `Compiled interview questions from ${intermediate.winnerId}`,
      compiledArtifact.refinedContent,
    )
    if (compiledQuestionPreview) {
      emitAiDetail(
        ticketId,
        context.externalId,
        'COMPILING_INTERVIEW',
        'model_output',
        compiledQuestionPreview,
        {
          entryId: `compiled-questions:${intermediate.winnerId}`,
          audience: 'ai',
          kind: 'text',
          op: 'append',
          source: `model:${intermediate.winnerId}`,
          modelId: intermediate.winnerId,
          streaming: false,
        },
      )
    }

    sendEvent({ type: 'READY' })
    broadcaster.broadcast(ticketId, 'needs_input', {
      ticketId,
      type: 'interview_questions',
      context: {
        questions: compiledArtifact.refinedContent,
        parsedQuestions: compiledArtifact.questions,
        winnerId: intermediate.winnerId,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`PROM3 refinement output failed validation: ${message}`)
  }
}

// --- Helper: resolve council members from context (shared by PRD/Beads draft handlers) ---
function resolveCouncilMembers(context: TicketContext): {
  members: Array<{ modelId: string; name: string }>
  source: 'locked_ticket' | 'profile'
} {
  let members: Array<{ modelId: string; name: string }> = []
  let source: 'locked_ticket' | 'profile' = 'profile'

  if (context.lockedCouncilMembers && context.lockedCouncilMembers.length > 0) {
    members = context.lockedCouncilMembers
      .map(id => ({ modelId: id, name: id.split('/').pop() ?? id }))
    source = 'locked_ticket'
  } else {
    const profile = appDb.select().from(profiles).get()
    const configuredMembers = parseCouncilMembers(profile?.councilMembers)
    if (configuredMembers.length > 0) {
      members = configuredMembers
        .map(id => ({ modelId: id, name: id.split('/').pop() ?? id }))
      source = 'profile'
    }
  }

  if (members.length === 0) {
    throw new Error('No valid council members are configured for this ticket')
  }
  return { members, source }
}

// --- Helper: load ticket dir paths and codebase map ---
function loadTicketDirContext(context: TicketContext) {
  const ticket = getStoredTicketContext(context.ticketId)
  const paths = getTicketPaths(context.ticketId)

  if (!ticket || !paths) {
    throw new Error(`Ticket workspace not initialized: missing ticket context for ${context.externalId}`)
  }

  const worktreePath = paths.worktreePath
  const ticketDir = paths.ticketDir

  if (!existsSync(ticketDir)) {
    throw new Error(`Ticket workspace not initialized: missing ticket directory for ${context.externalId}`)
  }

  const codebaseMapPath = resolve(ticketDir, 'codebase-map.yaml')
  if (!existsSync(codebaseMapPath)) {
    throw new Error(`Ticket workspace not initialized: missing codebase-map.yaml for ${context.externalId}`)
  }

  const codebaseMap = readFileSync(codebaseMapPath, 'utf-8')

  return { worktreePath, ticket: ticket.localTicket, ticketDir, codebaseMap }
}

// ─── PRD Phase Handlers ───

async function handlePrdDraft(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  signal: AbortSignal,
) {
  const { worktreePath, ticket, ticketDir, codebaseMap } = loadTicketDirContext(context)
  const phase = 'DRAFTING_PRD' as const
  const council = resolveCouncilMembers(context)
  const members = council.members

  // Load interview results from disk
  const interviewPath = resolve(ticketDir, 'interview.yaml')
  let interview: string | undefined
  if (existsSync(interviewPath)) {
    try { interview = readFileSync(interviewPath, 'utf-8') } catch { /* ignore */ }
  }

  const ticketState: TicketState = {
    ticketId: context.externalId,
    title: context.title,
    description: ticket?.description ?? '',
    codebaseMap,
    interview,
  }
  const ticketContext = buildMinimalContext('prd_draft', ticketState)

  emitPhaseLog(ticketId, context.externalId, phase, 'info',
    formatCouncilResolutionLog(context, council))
  emitPhaseLog(ticketId, context.externalId, phase, 'info',
    interview
      ? `Loaded interview artifact (${interview.length} chars).`
      : 'Interview artifact missing; PRD drafting will rely on available ticket context.')
  emitPhaseLog(ticketId, context.externalId, phase, 'info',
    `PRD council drafting started. Context: ${ticketContext.length} parts, interview=${interview ? 'loaded' : 'missing'}.`)
  const councilSettings = resolveCouncilRuntimeSettings(context)
  emitPhaseLog(ticketId, context.externalId, phase, 'info',
    `PRD draft settings: council_response_timeout=${councilSettings.draftTimeoutMs}ms, min_council_quorum=${councilSettings.minQuorum}.`)
  emitPhaseLog(ticketId, context.externalId, phase, 'info', `Dispatching PRD draft requests to ${members.length} council members.`)

  if (signal.aborted) throw new CancelledError(ticketId)
  const startedAt = Date.now()
  const streamStates = new Map<string, OpenCodeStreamState>()
  const liveDrafts = createPendingDrafts(members)
  upsertCouncilDraftArtifact(ticketId, phase, 'prd_drafts', liveDrafts)
  const result = await draftPRD(
    adapter,
    members,
    ticketContext,
    worktreePath,
    {
      ...councilSettings,
      ticketId,
    },
    signal,
    (entry) => {
      const targetStatus = mapCouncilStageToStatus('prd', entry.stage)
      emitOpenCodeSessionLogs(
        ticketId,
        context.externalId,
        targetStatus,
        entry.memberId,
        entry.sessionId,
        entry.stage,
        entry.response,
        entry.messages,
      )
    },
    (entry) => {
      const targetStatus = mapCouncilStageToStatus('prd', entry.stage)
      const streamState = streamStates.get(entry.sessionId) ?? createOpenCodeStreamState()
      streamStates.set(entry.sessionId, streamState)
      emitOpenCodeStreamEvent(
        ticketId,
        context.externalId,
        targetStatus,
        entry.memberId,
        entry.sessionId,
        entry.event,
        streamState,
      )
    },
    (entry) => {
      const targetStatus = mapCouncilStageToStatus('prd', entry.stage)
      emitOpenCodePromptLog(
        ticketId,
        context.externalId,
        targetStatus,
        entry.memberId,
        entry.event,
      )
    },
    (entry) => {
      emitDraftProgressInfoLog(ticketId, context.externalId, phase, 'PRD', entry)
      if (entry.status !== 'finished' || !entry.outcome) return
      const draftIndex = liveDrafts.findIndex(draft => draft.memberId === entry.memberId)
      if (draftIndex < 0) return
      liveDrafts[draftIndex] = {
        ...liveDrafts[draftIndex]!,
        content: entry.content ?? liveDrafts[draftIndex]!.content,
        outcome: entry.outcome,
        duration: entry.duration ?? liveDrafts[draftIndex]!.duration,
        error: entry.error,
        questionCount: entry.questionCount,
      }
      upsertCouncilDraftArtifact(ticketId, phase, 'prd_drafts', liveDrafts)
    },
  )

  const draftSummary = summarizeDraftOutcomes(result.drafts)
  emitPhaseLog(
    ticketId,
    context.externalId,
    phase,
    'info',
    formatDraftRoundSummary(
      'PRD draft round',
      Date.now() - startedAt,
      councilSettings.draftTimeoutMs,
      Boolean(result.deadlineReached),
      draftSummary,
    ),
  )
  const quorum = checkQuorum(result.drafts, councilSettings.minQuorum)
  const nextStatus = quorum.passed ? 'COUNCIL_VOTING_PRD' : 'BLOCKED_ERROR'
  emitCouncilDecisionLogs(
    ticketId,
    context.externalId,
    phase,
    councilSettings.draftTimeoutMs,
    Boolean(result.deadlineReached),
    result.memberOutcomes,
    quorum,
    nextStatus,
  )

  for (const draft of result.drafts) {
    const detail = draft.outcome === 'timed_out'
      ? 'timed out'
      : draft.outcome === 'invalid_output'
        ? 'invalid output'
        : draft.outcome === 'failed'
          ? 'failed'
          : `drafted PRD (${draft.content.length} chars)`
    emitAiDetail(ticketId, context.externalId, 'DRAFTING_PRD', 'model_output',
      `${draft.memberId} ${detail}.`,
      {
        entryId: `prd-draft-summary:${draft.memberId}`,
        audience: 'ai',
        kind: draft.outcome === 'completed' ? 'text' : 'error',
        op: 'append',
        source: `model:${draft.memberId}`,
        modelId: draft.memberId,
        streaming: false,
        outcome: draft.outcome,
        duration: draft.duration,
      })
  }

  upsertCouncilDraftArtifact(ticketId, phase, 'prd_drafts', result.drafts, result.memberOutcomes, true)
  emitPhaseLog(
    ticketId,
    context.externalId,
    phase,
    'info',
    `Saved PRD draft artifact with ${Object.keys(result.memberOutcomes).length} member outcomes.`,
  )

  if (!quorum.passed) {
    throw new Error(`Council quorum not met for prd_draft: ${quorum.message}`)
  }

  phaseIntermediate.set(`${ticketId}:prd`, {
    drafts: result.drafts,
    memberOutcomes: result.memberOutcomes,
    contextBuilder: buildPrdContextBuilder(ticketContext),
    worktreePath,
    phase: result.phase,
  })

  sendEvent({ type: 'DRAFTS_READY' })

  emitStateChange(ticketId, context.externalId, phase, 'COUNCIL_VOTING_PRD')
}

async function handlePrdVote(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  signal: AbortSignal,
) {
  const intermediate = phaseIntermediate.get(`${ticketId}:prd`)
  if (!intermediate) {
    throw new Error('No PRD drafts found — cannot vote')
  }

  const { members } = resolveCouncilMembers(context)
  const councilSettings = resolveCouncilRuntimeSettings(context)
  if (!intermediate.contextBuilder) {
    throw new Error('No PRD context builder found — cannot vote')
  }
  const voteContext = intermediate.contextBuilder('vote')
  const streamStates = new Map<string, OpenCodeStreamState>()
  const liveVotes: Vote[] = []
  const liveVoterOutcomes = members.reduce<Record<string, MemberOutcome>>((acc, member) => {
    acc[member.modelId] = 'pending'
    return acc
  }, {})

  emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_PRD', 'info',
    `PRD voting started with ${members.length} council members on ${intermediate.drafts.filter(d => d.outcome === 'completed').length} drafts.`)
  upsertCouncilVoteArtifact(ticketId, 'COUNCIL_VOTING_PRD', 'prd_votes', intermediate.drafts, [], liveVoterOutcomes)

  if (signal.aborted) throw new CancelledError(ticketId)
  const voteRun = await conductVoting(
    adapter,
    members,
    intermediate.drafts,
    voteContext,
    intermediate.worktreePath,
    intermediate.phase,
    councilSettings.draftTimeoutMs,
    signal,
    (entry) => {
      emitOpenCodeSessionLogs(
        ticketId,
        context.externalId,
        'COUNCIL_VOTING_PRD',
        entry.memberId,
        entry.sessionId,
        entry.stage,
        entry.response,
        entry.messages,
      )
    },
    (entry) => {
      const streamState = streamStates.get(entry.sessionId) ?? createOpenCodeStreamState()
      streamStates.set(entry.sessionId, streamState)
      emitOpenCodeStreamEvent(
        ticketId,
        context.externalId,
        'COUNCIL_VOTING_PRD',
        entry.memberId,
        entry.sessionId,
        entry.event,
        streamState,
      )
    },
    (entry) => {
      emitOpenCodePromptLog(
        ticketId,
        context.externalId,
        'COUNCIL_VOTING_PRD',
        entry.memberId,
        entry.event,
      )
    },
    (entry) => {
      liveVoterOutcomes[entry.memberId] = entry.outcome
      if (entry.votes.length > 0) liveVotes.push(...entry.votes)
      upsertCouncilVoteArtifact(ticketId, 'COUNCIL_VOTING_PRD', 'prd_votes', intermediate.drafts, liveVotes, liveVoterOutcomes)
    },
    undefined,
    {
      ticketId,
      phase: 'COUNCIL_VOTING_PRD',
    },
  )

  const voteQuorum = checkMemberResponseQuorum(voteRun.memberOutcomes, councilSettings.minQuorum)
  const nextVoteStatus = voteQuorum.passed ? 'REFINING_PRD' : 'BLOCKED_ERROR'
  emitCouncilDecisionLogs(
    ticketId,
    context.externalId,
    'COUNCIL_VOTING_PRD',
    councilSettings.draftTimeoutMs,
    voteRun.deadlineReached,
    voteRun.memberOutcomes,
    voteQuorum,
    nextVoteStatus,
  )

  if (!voteQuorum.passed) {
    upsertCouncilVoteArtifact(
      ticketId,
      'COUNCIL_VOTING_PRD',
      'prd_votes',
      intermediate.drafts,
      voteRun.votes,
      voteRun.memberOutcomes,
      voteRun.presentationOrders,
      undefined,
      undefined,
      true,
    )
    throw new Error(`PRD voting quorum not met: ${voteQuorum.message}`)
  }

  if (voteRun.votes.length === 0) {
    throw new Error('PRD voting failed: no valid vote responses received')
  }

  const { winnerId, totalScore } = selectWinner(voteRun.votes, members)

  intermediate.votes = voteRun.votes
  intermediate.winnerId = winnerId

  upsertCouncilVoteArtifact(
    ticketId,
    'COUNCIL_VOTING_PRD',
    'prd_votes',
    intermediate.drafts,
    voteRun.votes,
    voteRun.memberOutcomes,
    voteRun.presentationOrders,
    winnerId,
    totalScore,
    true,
  )
  emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_PRD', 'info',
    `PRD voting selected winner: ${winnerId} (score: ${totalScore}).`)
  sendEvent({ type: 'WINNER_SELECTED', winner: winnerId })
  emitStateChange(ticketId, context.externalId, 'COUNCIL_VOTING_PRD', 'REFINING_PRD')
}

async function handlePrdRefine(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  signal: AbortSignal,
) {
  const intermediate = phaseIntermediate.get(`${ticketId}:prd`)
  if (!intermediate || !intermediate.winnerId) {
    throw new Error('No PRD vote results found — cannot refine')
  }

  const winnerDraft = intermediate.drafts.find(d => d.memberId === intermediate.winnerId)!
  const losingDrafts = intermediate.drafts.filter(d => d.memberId !== intermediate.winnerId && d.outcome === 'completed')
  const councilSettings = resolveCouncilRuntimeSettings(context)
  if (!intermediate.contextBuilder) {
    throw new Error('No PRD context builder found — cannot refine')
  }
  const refineContext = intermediate.contextBuilder('refine')
  const streamStates = new Map<string, OpenCodeStreamState>()
  const paths = getTicketPaths(ticketId)
  if (!paths) {
    throw new Error(`Ticket workspace not initialized: missing ticket paths for ${context.externalId}`)
  }
  const ticketDir = paths.ticketDir
  const interviewPath = resolve(ticketDir, 'interview.yaml')
  const interviewContent = existsSync(interviewPath)
    ? (() => {
        try {
          return readFileSync(interviewPath, 'utf-8')
        } catch {
          return undefined
        }
      })()
    : undefined

  emitPhaseLog(ticketId, context.externalId, 'REFINING_PRD', 'info',
    `PRD refinement started. Winner: ${intermediate.winnerId}, incorporating ideas from ${losingDrafts.length} alternative drafts.`)

  if (signal.aborted) throw new CancelledError(ticketId)
  let structuredMeta = buildStructuredMetadata({ autoRetryCount: 0, repairApplied: false, repairWarnings: [] })
  const refinedContent = await refineDraft(
    adapter,
    winnerDraft,
    losingDrafts,
    refineContext,
    intermediate.worktreePath,
    councilSettings.draftTimeoutMs,
    signal,
    (entry) => {
      emitOpenCodeSessionLogs(
        ticketId,
        context.externalId,
        'REFINING_PRD',
        entry.memberId,
        entry.sessionId,
        entry.stage,
        entry.response,
        entry.messages,
      )
    },
    (entry) => {
      const streamState = streamStates.get(entry.sessionId) ?? createOpenCodeStreamState()
      streamStates.set(entry.sessionId, streamState)
      emitOpenCodeStreamEvent(
        ticketId,
        context.externalId,
        'REFINING_PRD',
        entry.memberId,
        entry.sessionId,
        entry.event,
        streamState,
      )
    },
    (entry) => {
      emitOpenCodePromptLog(
        ticketId,
        context.externalId,
        'REFINING_PRD',
        entry.memberId,
        entry.event,
      )
    },
    {
      ticketId,
      phase: 'REFINING_PRD',
    },
    undefined,
    (content) => {
      const result = normalizePrdYamlOutput(content, {
        ticketId: context.externalId,
        interviewContent,
      })
      if (!result.ok) {
        structuredMeta = buildStructuredMetadata(structuredMeta, {
          autoRetryCount: 1,
          validationError: result.error,
        })
        throw new Error(result.error)
      }
      structuredMeta = buildStructuredMetadata(structuredMeta, {
        repairApplied: result.repairApplied,
        repairWarnings: result.repairWarnings,
      })
      return { normalizedContent: result.normalizedContent }
    },
    PROM12.outputFormat,
  )

  // Clean up intermediate data
  phaseIntermediate.delete(`${ticketId}:prd`)
  const prdPath = resolve(ticketDir, 'prd.yaml')

  insertPhaseArtifact(ticketId, {
    phase: 'REFINING_PRD',
    artifactType: 'prd_refined',
    content: JSON.stringify({
      winnerId: intermediate.winnerId,
      refinedContent,
      structuredOutput: structuredMeta,
    }),
  })

  // Save refined PRD to disk
  safeAtomicWrite(prdPath, refinedContent)

  emitPhaseLog(ticketId, context.externalId, 'REFINING_PRD', 'info',
    `Refined PRD from winner ${intermediate.winnerId}. Saved to ${prdPath}.`)

  sendEvent({ type: 'REFINED' })

  emitStateChange(ticketId, context.externalId, 'REFINING_PRD', 'VERIFYING_PRD_COVERAGE')
}

// ─── Beads Phase Handlers ───

async function handleBeadsDraft(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  signal: AbortSignal,
) {
  const { worktreePath, ticket, ticketDir, codebaseMap } = loadTicketDirContext(context)
  const phase = 'DRAFTING_BEADS' as const
  const council = resolveCouncilMembers(context)
  const members = council.members

  // Load PRD from disk
  const prdPath = resolve(ticketDir, 'prd.yaml')
  let prd: string | undefined
  if (existsSync(prdPath)) {
    try { prd = readFileSync(prdPath, 'utf-8') } catch { /* ignore */ }
  }

  const ticketState: TicketState = {
    ticketId: context.externalId,
    title: context.title,
    description: ticket?.description ?? '',
    codebaseMap,
    prd,
  }
  const ticketContext = buildMinimalContext('beads_draft', ticketState)

  emitPhaseLog(ticketId, context.externalId, phase, 'info',
    formatCouncilResolutionLog(context, council))
  emitPhaseLog(ticketId, context.externalId, phase, 'info',
    prd
      ? `Loaded PRD artifact (${prd.length} chars).`
      : 'PRD artifact missing; beads drafting will rely on available ticket context.')
  emitPhaseLog(ticketId, context.externalId, phase, 'info',
    `Beads council drafting started. Context: ${ticketContext.length} parts, prd=${prd ? 'loaded' : 'missing'}.`)
  const councilSettings = resolveCouncilRuntimeSettings(context)
  emitPhaseLog(ticketId, context.externalId, phase, 'info',
    `Beads draft settings: council_response_timeout=${councilSettings.draftTimeoutMs}ms, min_council_quorum=${councilSettings.minQuorum}.`)
  emitPhaseLog(ticketId, context.externalId, phase, 'info', `Dispatching beads draft requests to ${members.length} council members.`)

  if (signal.aborted) throw new CancelledError(ticketId)
  const startedAt = Date.now()
  const streamStates = new Map<string, OpenCodeStreamState>()
  const liveDrafts = createPendingDrafts(members)
  upsertCouncilDraftArtifact(ticketId, phase, 'beads_drafts', liveDrafts)
  const result = await draftBeads(
    adapter,
    members,
    ticketContext,
    worktreePath,
    {
      ...councilSettings,
      ticketId,
    },
    signal,
    (entry) => {
      const targetStatus = mapCouncilStageToStatus('beads', entry.stage)
      emitOpenCodeSessionLogs(
        ticketId,
        context.externalId,
        targetStatus,
        entry.memberId,
        entry.sessionId,
        entry.stage,
        entry.response,
        entry.messages,
      )
    },
    (entry) => {
      const targetStatus = mapCouncilStageToStatus('beads', entry.stage)
      const streamState = streamStates.get(entry.sessionId) ?? createOpenCodeStreamState()
      streamStates.set(entry.sessionId, streamState)
      emitOpenCodeStreamEvent(
        ticketId,
        context.externalId,
        targetStatus,
        entry.memberId,
        entry.sessionId,
        entry.event,
        streamState,
      )
    },
    (entry) => {
      const targetStatus = mapCouncilStageToStatus('beads', entry.stage)
      emitOpenCodePromptLog(
        ticketId,
        context.externalId,
        targetStatus,
        entry.memberId,
        entry.event,
      )
    },
    (entry) => {
      emitDraftProgressInfoLog(ticketId, context.externalId, phase, 'Beads', entry)
      if (entry.status !== 'finished' || !entry.outcome) return
      const draftIndex = liveDrafts.findIndex(draft => draft.memberId === entry.memberId)
      if (draftIndex < 0) return
      liveDrafts[draftIndex] = {
        ...liveDrafts[draftIndex]!,
        content: entry.content ?? liveDrafts[draftIndex]!.content,
        outcome: entry.outcome,
        duration: entry.duration ?? liveDrafts[draftIndex]!.duration,
        error: entry.error,
        questionCount: entry.questionCount,
      }
      upsertCouncilDraftArtifact(ticketId, phase, 'beads_drafts', liveDrafts)
    },
  )

  const draftSummary = summarizeDraftOutcomes(result.drafts)
  emitPhaseLog(
    ticketId,
    context.externalId,
    phase,
    'info',
    formatDraftRoundSummary(
      'Beads draft round',
      Date.now() - startedAt,
      councilSettings.draftTimeoutMs,
      Boolean(result.deadlineReached),
      draftSummary,
    ),
  )
  const quorum = checkQuorum(result.drafts, councilSettings.minQuorum)
  const nextStatus = quorum.passed ? 'COUNCIL_VOTING_BEADS' : 'BLOCKED_ERROR'
  emitCouncilDecisionLogs(
    ticketId,
    context.externalId,
    phase,
    councilSettings.draftTimeoutMs,
    Boolean(result.deadlineReached),
    result.memberOutcomes,
    quorum,
    nextStatus,
  )

  for (const draft of result.drafts) {
    const detail = draft.outcome === 'timed_out'
      ? 'timed out'
      : draft.outcome === 'invalid_output'
        ? 'invalid output'
        : draft.outcome === 'failed'
          ? 'failed'
          : `drafted beads (${draft.content.length} chars)`
    emitAiDetail(ticketId, context.externalId, 'DRAFTING_BEADS', 'model_output',
      `${draft.memberId} ${detail}.`,
      {
        entryId: `beads-draft-summary:${draft.memberId}`,
        audience: 'ai',
        kind: draft.outcome === 'completed' ? 'text' : 'error',
        op: 'append',
        source: `model:${draft.memberId}`,
        modelId: draft.memberId,
        streaming: false,
        outcome: draft.outcome,
        duration: draft.duration,
      })
  }

  upsertCouncilDraftArtifact(ticketId, phase, 'beads_drafts', result.drafts, result.memberOutcomes, true)
  emitPhaseLog(
    ticketId,
    context.externalId,
    phase,
    'info',
    `Saved beads draft artifact with ${Object.keys(result.memberOutcomes).length} member outcomes.`,
  )

  if (!quorum.passed) {
    throw new Error(`Council quorum not met for beads_draft: ${quorum.message}`)
  }

  phaseIntermediate.set(`${ticketId}:beads`, {
    drafts: result.drafts,
    memberOutcomes: result.memberOutcomes,
    contextBuilder: buildBeadsContextBuilder(ticketContext),
    worktreePath,
    phase: result.phase,
  })

  sendEvent({ type: 'DRAFTS_READY' })

  emitStateChange(ticketId, context.externalId, phase, 'COUNCIL_VOTING_BEADS')
}

async function handleBeadsVote(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  signal: AbortSignal,
) {
  const intermediate = phaseIntermediate.get(`${ticketId}:beads`)
  if (!intermediate) {
    throw new Error('No Beads drafts found — cannot vote')
  }

  const { members } = resolveCouncilMembers(context)
  const councilSettings = resolveCouncilRuntimeSettings(context)
  if (!intermediate.contextBuilder) {
    throw new Error('No beads context builder found — cannot vote')
  }
  const voteContext = intermediate.contextBuilder('vote')
  const streamStates = new Map<string, OpenCodeStreamState>()
  const liveVotes: Vote[] = []
  const liveVoterOutcomes = members.reduce<Record<string, MemberOutcome>>((acc, member) => {
    acc[member.modelId] = 'pending'
    return acc
  }, {})

  emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_BEADS', 'info',
    `Beads voting started with ${members.length} council members on ${intermediate.drafts.filter(d => d.outcome === 'completed').length} drafts.`)
  upsertCouncilVoteArtifact(ticketId, 'COUNCIL_VOTING_BEADS', 'beads_votes', intermediate.drafts, [], liveVoterOutcomes)

  if (signal.aborted) throw new CancelledError(ticketId)
  const voteRun = await conductVoting(
    adapter,
    members,
    intermediate.drafts,
    voteContext,
    intermediate.worktreePath,
    intermediate.phase,
    councilSettings.draftTimeoutMs,
    signal,
    (entry) => {
      emitOpenCodeSessionLogs(
        ticketId,
        context.externalId,
        'COUNCIL_VOTING_BEADS',
        entry.memberId,
        entry.sessionId,
        entry.stage,
        entry.response,
        entry.messages,
      )
    },
    (entry) => {
      const streamState = streamStates.get(entry.sessionId) ?? createOpenCodeStreamState()
      streamStates.set(entry.sessionId, streamState)
      emitOpenCodeStreamEvent(
        ticketId,
        context.externalId,
        'COUNCIL_VOTING_BEADS',
        entry.memberId,
        entry.sessionId,
        entry.event,
        streamState,
      )
    },
    (entry) => {
      emitOpenCodePromptLog(
        ticketId,
        context.externalId,
        'COUNCIL_VOTING_BEADS',
        entry.memberId,
        entry.event,
      )
    },
    (entry) => {
      liveVoterOutcomes[entry.memberId] = entry.outcome
      if (entry.votes.length > 0) liveVotes.push(...entry.votes)
      upsertCouncilVoteArtifact(ticketId, 'COUNCIL_VOTING_BEADS', 'beads_votes', intermediate.drafts, liveVotes, liveVoterOutcomes)
    },
    undefined,
    {
      ticketId,
      phase: 'COUNCIL_VOTING_BEADS',
    },
  )

  const voteQuorum = checkMemberResponseQuorum(voteRun.memberOutcomes, councilSettings.minQuorum)
  const nextVoteStatus = voteQuorum.passed ? 'REFINING_BEADS' : 'BLOCKED_ERROR'
  emitCouncilDecisionLogs(
    ticketId,
    context.externalId,
    'COUNCIL_VOTING_BEADS',
    councilSettings.draftTimeoutMs,
    voteRun.deadlineReached,
    voteRun.memberOutcomes,
    voteQuorum,
    nextVoteStatus,
  )

  if (!voteQuorum.passed) {
    upsertCouncilVoteArtifact(
      ticketId,
      'COUNCIL_VOTING_BEADS',
      'beads_votes',
      intermediate.drafts,
      voteRun.votes,
      voteRun.memberOutcomes,
      voteRun.presentationOrders,
      undefined,
      undefined,
      true,
    )
    throw new Error(`Beads voting quorum not met: ${voteQuorum.message}`)
  }

  if (voteRun.votes.length === 0) {
    throw new Error('Beads voting failed: no valid vote responses received')
  }

  const { winnerId, totalScore } = selectWinner(voteRun.votes, members)

  intermediate.votes = voteRun.votes
  intermediate.winnerId = winnerId

  upsertCouncilVoteArtifact(
    ticketId,
    'COUNCIL_VOTING_BEADS',
    'beads_votes',
    intermediate.drafts,
    voteRun.votes,
    voteRun.memberOutcomes,
    voteRun.presentationOrders,
    winnerId,
    totalScore,
    true,
  )
  emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_BEADS', 'info',
    `Beads voting selected winner: ${winnerId} (score: ${totalScore}).`)
  sendEvent({ type: 'WINNER_SELECTED', winner: winnerId })
  emitStateChange(ticketId, context.externalId, 'COUNCIL_VOTING_BEADS', 'REFINING_BEADS')
}

async function handleBeadsRefine(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  signal: AbortSignal,
) {
  const intermediate = phaseIntermediate.get(`${ticketId}:beads`)
  if (!intermediate || !intermediate.winnerId) {
    throw new Error('No Beads vote results found — cannot refine')
  }

  const winnerDraft = intermediate.drafts.find(d => d.memberId === intermediate.winnerId)!
  const losingDrafts = intermediate.drafts.filter(d => d.memberId !== intermediate.winnerId && d.outcome === 'completed')
  const councilSettings = resolveCouncilRuntimeSettings(context)
  if (!intermediate.contextBuilder) {
    throw new Error('No beads context builder found — cannot refine')
  }
  const refineContext = intermediate.contextBuilder('refine')
  const streamStates = new Map<string, OpenCodeStreamState>()
  const paths = getTicketPaths(ticketId)
  if (!paths) {
    throw new Error(`Ticket workspace not initialized: missing ticket paths for ${context.externalId}`)
  }
  const beadsPath = paths.beadsPath

  emitPhaseLog(ticketId, context.externalId, 'REFINING_BEADS', 'info',
    `Beads refinement started. Winner: ${intermediate.winnerId}, incorporating ideas from ${losingDrafts.length} alternative drafts.`)

  if (signal.aborted) throw new CancelledError(ticketId)
  let structuredMeta = buildStructuredMetadata({ autoRetryCount: 0, repairApplied: false, repairWarnings: [] })
  const refinedContent = await refineDraft(
    adapter,
    winnerDraft,
    losingDrafts,
    refineContext,
    intermediate.worktreePath,
    councilSettings.draftTimeoutMs,
    signal,
    (entry) => {
      emitOpenCodeSessionLogs(
        ticketId,
        context.externalId,
        'REFINING_BEADS',
        entry.memberId,
        entry.sessionId,
        entry.stage,
        entry.response,
        entry.messages,
      )
    },
    (entry) => {
      const streamState = streamStates.get(entry.sessionId) ?? createOpenCodeStreamState()
      streamStates.set(entry.sessionId, streamState)
      emitOpenCodeStreamEvent(
        ticketId,
        context.externalId,
        'REFINING_BEADS',
        entry.memberId,
        entry.sessionId,
        entry.event,
        streamState,
      )
    },
    (entry) => {
      emitOpenCodePromptLog(
        ticketId,
        context.externalId,
        'REFINING_BEADS',
        entry.memberId,
        entry.event,
      )
    },
    {
      ticketId,
      phase: 'REFINING_BEADS',
    },
    undefined,
    (content) => {
      const result = normalizeBeadSubsetYamlOutput(content)
      if (!result.ok) {
        structuredMeta = buildStructuredMetadata(structuredMeta, {
          autoRetryCount: 1,
          validationError: result.error,
        })
        throw new Error(result.error)
      }
      structuredMeta = buildStructuredMetadata(structuredMeta, {
        repairApplied: result.repairApplied,
        repairWarnings: result.repairWarnings,
      })
      return { normalizedContent: result.normalizedContent }
    },
    PROM22.outputFormat,
  )

  // Clean up intermediate data
  phaseIntermediate.delete(`${ticketId}:beads`)

  // Parse refined content as bead subsets and expand to full beads
  const beadSubsetResult = normalizeBeadSubsetYamlOutput(refinedContent)
  if (!beadSubsetResult.ok) {
    throw new Error(`PROM22 refinement output failed validation: ${beadSubsetResult.error}`)
  }
  const beadSubsets: BeadSubset[] = beadSubsetResult.value

  const expandedBeads = expandBeads(beadSubsets)
  const expandedBeadsJsonl = expandedBeads.map((bead) => JSON.stringify(bead)).join('\n')
  const beadsJsonlResult = normalizeBeadsJsonlOutput(expandedBeadsJsonl)
  if (!beadsJsonlResult.ok) {
    throw new Error(`Expanded bead graph failed validation: ${beadsJsonlResult.error}`)
  }

  insertPhaseArtifact(ticketId, {
    phase: 'REFINING_BEADS',
    artifactType: 'beads_refined',
    content: JSON.stringify({
      winnerId: intermediate.winnerId,
      refinedContent,
      expandedBeads,
      structuredOutput: structuredMeta,
    }),
  })

  // Save expanded beads to disk as JSONL
  writeJsonl(beadsPath, beadsJsonlResult.value)

  emitPhaseLog(ticketId, context.externalId, 'REFINING_BEADS', 'info',
    `Refined and expanded ${expandedBeads.length} beads from winner ${intermediate.winnerId}. Saved to ${beadsPath}.`)

  sendEvent({ type: 'REFINED' })

  emitStateChange(ticketId, context.externalId, 'REFINING_BEADS', 'VERIFYING_BEADS_COVERAGE')
}

/**
 * Run coverage verification using ONLY the winning model from the council vote.
 * Per arch.md §B.I/II/III: "Coverage Verification Pass (winning AIC)"
 */
async function handleCoverageVerification(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  phase: 'interview' | 'prd' | 'beads',
  signal: AbortSignal,
) {
  const { worktreePath, ticket, ticketDir, codebaseMap } = loadTicketDirContext(context)
  const paths = getTicketPaths(ticketId)
  const stateLabel = getCoverageStateLabel(phase)
  const contextPhase = getCoverageContextPhase(phase)
  const promptTemplate = getCoveragePromptTemplate(phase)
  const councilSettings = resolveCouncilRuntimeSettings(context)
  const coverageSettings = resolveCoverageRuntimeSettings(context)
  const completedCoveragePasses = countPhaseArtifacts(ticketId, `${phase}_coverage`, stateLabel)
  const coverageRunState = resolveCoverageRunState(completedCoveragePasses, coverageSettings.maxCoveragePasses)

  if (coverageRunState.limitAlreadyReached) {
    emitPhaseLog(
      ticketId,
      context.externalId,
      stateLabel,
      'info',
      `Coverage retry cap already reached for ${phase} (${completedCoveragePasses}/${coverageSettings.maxCoveragePasses}). Routing to approval without another coverage execution.`,
    )
    sendEvent({ type: 'COVERAGE_LIMIT_REACHED' })
    return
  }

  const { coverageRunNumber, isFinalAllowedRun } = coverageRunState

  // Resolve the council result to find the winning model
  const councilResult = phaseResults.get(`${ticketId}:${phase}`)
  let winnerId: string

  if (councilResult) {
    winnerId = councilResult.winnerId
  } else {
    // Fallback: read winnerId from persisted phaseArtifacts (survives server restarts)
    const winnerArtifactType = phase === 'interview'
      ? 'interview_winner'
      : phase === 'prd'
        ? 'prd_votes'
        : 'beads_votes'
    const winnerArtifact = getLatestPhaseArtifact(ticketId, winnerArtifactType)

    if (!winnerArtifact) {
      const msg = `No council result found for ${phase} phase — cannot determine winning model`
      emitPhaseLog(ticketId, context.externalId, stateLabel, 'error', msg)
      sendEvent({ type: 'ERROR', message: msg, codes: ['COVERAGE_FAILED'] })
      return
    }

    try {
      const parsed = JSON.parse(winnerArtifact.content) as { winnerId?: string }
      winnerId = parsed.winnerId ?? ''
    } catch {
      const msg = `Failed to parse winning model from persisted artifact for ${phase} phase`
      emitPhaseLog(ticketId, context.externalId, stateLabel, 'error', msg)
      sendEvent({ type: 'ERROR', message: msg, codes: ['COVERAGE_FAILED'] })
      return
    }

    if (!winnerId) {
      const msg = `No winnerId found in persisted artifact for ${phase} phase`
      emitPhaseLog(ticketId, context.externalId, stateLabel, 'error', msg)
      sendEvent({ type: 'ERROR', message: msg, codes: ['COVERAGE_FAILED'] })
      return
    }
  }
  emitPhaseLog(
    ticketId,
    context.externalId,
    stateLabel,
    'info',
    `Coverage verification started using winning model: ${winnerId} (run ${coverageRunNumber}/${coverageSettings.maxCoveragePasses}).`,
  )

  // Resolve refinedContent: prefer in-memory, fall back to persisted artifact
  let refinedContent: string | undefined = councilResult?.refinedContent
  if (!refinedContent) {
    const compiledArtifactType = phase === 'interview'
      ? 'interview_compiled'
      : phase === 'prd'
        ? 'prd_refined'
        : 'beads_refined'
    const compiledArtifact = getLatestPhaseArtifact(ticketId, compiledArtifactType)
    if (compiledArtifact) {
      try {
        const parsed = JSON.parse(compiledArtifact.content) as { refinedContent?: string }
        refinedContent = parsed.refinedContent
      } catch { /* ignore */ }
    }
  }

  const interviewSnapshot = phase === 'interview'
    ? readInterviewSessionSnapshotArtifact(ticketId)
    : null
  let canonicalInterview = phase === 'interview'
    ? loadCanonicalInterview(ticketDir)
    : undefined

  if (phase === 'interview' && !canonicalInterview) {
    if (!interviewSnapshot) {
      const msg = 'Interview coverage requires canonical interview state, but no normalized interview session snapshot was found.'
      emitPhaseLog(ticketId, context.externalId, stateLabel, 'error', msg)
      sendEvent({ type: 'ERROR', message: msg, codes: ['COVERAGE_FAILED'] })
      return
    }

    try {
      writeCanonicalInterview(context.externalId, ticketDir, interviewSnapshot)
      canonicalInterview = loadCanonicalInterview(ticketDir)
    } catch (err) {
      const msg = `Failed to rebuild canonical interview.yaml before coverage: ${err instanceof Error ? err.message : String(err)}`
      emitPhaseLog(ticketId, context.externalId, stateLabel, 'error', msg)
      sendEvent({ type: 'ERROR', message: msg, codes: ['COVERAGE_FAILED'] })
      return
    }
  }

  const ticketState: TicketState = {
    ticketId: context.externalId,
    title: context.title,
    description: ticket?.description ?? '',
    codebaseMap,
    interview: phase === 'interview' ? canonicalInterview : refinedContent,
    ...(phase === 'interview'
      ? { userAnswers: buildInterviewAnswerSummary(interviewSnapshot) }
      : {}),
  }

  const interviewCoverageBudget = phase === 'interview'
    ? (() => {
        const maxInitialQuestions = context.lockedInterviewQuestions
          ?? interviewSnapshot?.maxInitialQuestions
          ?? resolveInterviewDraftSettings(context).maxInitialQuestions
        const total = calculateFollowUpLimit(maxInitialQuestions, coverageSettings.coverageFollowUpBudgetPercent)
        const used = interviewSnapshot ? countCoverageFollowUpQuestions(interviewSnapshot) : 0
        return {
          total,
          used,
          remaining: Math.max(0, total - used),
        }
      })()
    : null

  // Load additional artifacts from disk for PRD/beads coverage phases
  if (phase === 'prd' || phase === 'beads') {
    const prdPath = resolve(ticketDir, 'prd.yaml')
    if (existsSync(prdPath)) {
      try { ticketState.prd = readFileSync(prdPath, 'utf-8') } catch { /* ignore */ }
    }
  }
  if (phase === 'beads' && paths) {
    const beadsPath = paths.beadsPath
    if (beadsPath && existsSync(beadsPath)) {
      try { ticketState.beads = readFileSync(beadsPath, 'utf-8') } catch { /* ignore */ }
    }
  }

  const coverageContext = buildMinimalContext(contextPhase, ticketState)
  const coveragePromptConfiguration = buildCoveragePromptConfiguration({
    phase,
    coverageRunNumber,
    maxCoveragePasses: coverageSettings.maxCoveragePasses,
    isFinalAllowedRun,
    ...(phase === 'interview' && interviewCoverageBudget
      ? {
          coverageFollowUpBudgetPercent: coverageSettings.coverageFollowUpBudgetPercent,
          followUpBudgetTotal: interviewCoverageBudget.total,
          followUpBudgetUsed: interviewCoverageBudget.used,
          followUpBudgetRemaining: interviewCoverageBudget.remaining,
        }
      : {}),
  })
  const promptContent = buildPromptFromTemplate(
    promptTemplate,
    [...coverageContext, coveragePromptConfiguration],
  )

  // Use a single session for the winning model only (not all council members)
  throwIfAborted(signal, ticketId)
  const streamState = createOpenCodeStreamState()
  let sessionId = ''
  let runResult: Awaited<ReturnType<typeof runOpenCodePrompt>> | undefined
  let response = ''
  let coverageEnvelope: ReturnType<typeof normalizeCoverageResultOutput> | null = null
  let promptParts: PromptPart[] = [{ type: 'text', content: promptContent }]
  let structuredMeta = buildStructuredMetadata({ autoRetryCount: 0, repairApplied: false, repairWarnings: [] })
  let interviewCoverageResolution: ReturnType<typeof resolveInterviewCoverageFollowUpResolution> | null = null

  for (let attempt = 0; attempt <= 1; attempt += 1) {
    try {
      runResult = await runOpenCodePrompt({
        adapter,
        projectPath: worktreePath,
        parts: promptParts,
        signal,
        timeoutMs: councilSettings.draftTimeoutMs,
        model: winnerId,
        sessionOwnership: {
          ticketId,
          phase: stateLabel,
          memberId: winnerId,
        },
        onSessionCreated: (session) => {
          sessionId = session.id
          emitAiMilestone(
            ticketId,
            context.externalId,
            stateLabel,
            `OpenCode coverage: sending ${phase} verification prompt to ${winnerId} (session=${session.id}).`,
            `${stateLabel}:${session.id}:coverage-created`,
            {
              modelId: winnerId,
              sessionId: session.id,
              source: `model:${winnerId}`,
            },
          )
        },
        onStreamEvent: (event) => {
          if (!sessionId) return
          emitOpenCodeStreamEvent(
            ticketId,
            context.externalId,
            stateLabel,
            winnerId,
            sessionId,
            event,
            streamState,
          )
        },
        onPromptDispatched: (event) => {
          emitOpenCodePromptLog(
            ticketId,
            context.externalId,
            stateLabel,
            winnerId,
            event,
          )
        },
      })
    } catch (error) {
      throwIfCancelled(error, signal, ticketId)
      throw error
    }

    throwIfAborted(signal, ticketId)
    response = runResult.response

    emitOpenCodeSessionLogs(
      ticketId,
      context.externalId,
      stateLabel,
      winnerId,
      runResult.session.id,
      'coverage',
      response,
      runResult.messages,
    )

    coverageEnvelope = normalizeCoverageResultOutput(response)
    if (coverageEnvelope.ok) {
      structuredMeta = buildStructuredMetadata(structuredMeta, {
        repairApplied: coverageEnvelope.repairApplied,
        repairWarnings: coverageEnvelope.repairWarnings,
      })
      interviewCoverageResolution = phase === 'interview' && interviewSnapshot
        ? resolveInterviewCoverageFollowUpResolution({
            status: coverageEnvelope.value.status,
            structuredFollowUps: coverageEnvelope.value.followUpQuestions,
            rawResponse: response,
            snapshot: interviewSnapshot,
            attempt,
            maxFollowUps: interviewCoverageBudget?.total,
          })
        : null

      if (interviewCoverageResolution?.repairWarnings.length) {
        structuredMeta = buildStructuredMetadata(structuredMeta, {
          repairWarnings: interviewCoverageResolution.repairWarnings,
        })
      }

      if (interviewCoverageResolution?.shouldRetry && interviewCoverageResolution.validationError) {
        structuredMeta = buildStructuredMetadata(structuredMeta, {
          autoRetryCount: 1,
          validationError: interviewCoverageResolution.validationError,
        })
        promptParts = buildStructuredRetryPrompt([{ type: 'text', content: promptContent }], {
          validationError: interviewCoverageResolution.validationError,
          rawResponse: response,
          schemaReminder: promptTemplate.outputFormat,
        })
        continue
      }

      if (interviewCoverageResolution?.validationError) {
        structuredMeta = buildStructuredMetadata(structuredMeta, {
          validationError: interviewCoverageResolution.validationError,
        })
      }
      break
    }

    if (attempt === 1) {
      structuredMeta = buildStructuredMetadata(structuredMeta, {
        autoRetryCount: 1,
        validationError: coverageEnvelope.error,
      })
      const msg = `Coverage output failed validation after retry: ${coverageEnvelope.error}`
      emitPhaseLog(ticketId, context.externalId, stateLabel, 'error', msg)
      sendEvent({ type: 'ERROR', message: msg, codes: ['COVERAGE_FAILED'] })
      return
    }

    structuredMeta = buildStructuredMetadata(structuredMeta, {
      autoRetryCount: 1,
      validationError: coverageEnvelope.error,
    })
    promptParts = buildStructuredRetryPrompt([{ type: 'text', content: promptContent }], {
      validationError: coverageEnvelope.error,
      rawResponse: response,
      schemaReminder: promptTemplate.outputFormat,
    })
  }

  if (!coverageEnvelope?.ok || !runResult) {
    const msg = 'Coverage verification finished without a parseable structured result.'
    emitPhaseLog(ticketId, context.externalId, stateLabel, 'error', msg)
    sendEvent({ type: 'ERROR', message: msg, codes: ['COVERAGE_FAILED'] })
    return
  }

  // Store the coverage input artifact so the UI can display Q&A / doc being verified
  const coverageInputContent = phase === 'interview'
    ? JSON.stringify({ interview: ticketState.interview, userAnswers: ticketState.userAnswers })
    : phase === 'prd'
      ? JSON.stringify({ prd: ticketState.prd, refinedContent })
      : JSON.stringify({ beads: ticketState.beads, refinedContent })
  insertPhaseArtifact(ticketId, {
    phase: stateLabel,
    artifactType: `${phase}_coverage_input`,
    content: coverageInputContent,
  })
  const detectedGaps = coverageEnvelope.value.status === 'gaps'
  const followUpQuestions = interviewCoverageResolution?.followUpQuestions ?? []
  const gapDisposition = resolveCoverageGapDisposition({
    phase,
    hasGaps: detectedGaps,
    isFinalAllowedRun,
    hasFollowUpQuestions: followUpQuestions.length > 0,
    remainingInterviewBudget: interviewCoverageResolution?.budget.remaining ?? interviewCoverageBudget?.remaining,
  })
  const shouldQueueInterviewFollowUps = gapDisposition.shouldLoopBack && phase === 'interview'

  // Store the coverage result artifact
  insertPhaseArtifact(ticketId, {
    phase: stateLabel,
    artifactType: `${phase}_coverage`,
    content: JSON.stringify({
      winnerId,
      response,
      normalizedContent: coverageEnvelope.normalizedContent,
      hasGaps: detectedGaps,
      parsed: coverageEnvelope.value,
      structuredOutput: structuredMeta,
      coverageRunNumber,
      maxCoveragePasses: coverageSettings.maxCoveragePasses,
      limitReached: gapDisposition.limitReached,
      terminationReason: gapDisposition.terminationReason,
      ...(phase === 'interview' && interviewCoverageResolution
        ? {
            followUpBudgetPercent: coverageSettings.coverageFollowUpBudgetPercent,
            followUpBudgetTotal: interviewCoverageResolution.budget.total,
            followUpBudgetUsed: interviewCoverageResolution.budget.used,
            followUpBudgetRemaining: interviewCoverageResolution.budget.remaining,
          }
        : phase === 'interview' && interviewCoverageBudget
          ? {
              followUpBudgetPercent: coverageSettings.coverageFollowUpBudgetPercent,
              followUpBudgetTotal: interviewCoverageBudget.total,
              followUpBudgetUsed: interviewCoverageBudget.used,
              followUpBudgetRemaining: interviewCoverageBudget.remaining,
            }
          : {}),
    }),
  })

  if (detectedGaps) {
    if (phase === 'interview') {
      if (!interviewSnapshot) {
        const msg = 'Coverage found interview gaps but no normalized interview session snapshot was available.'
        emitPhaseLog(ticketId, context.externalId, stateLabel, 'error', msg)
        sendEvent({ type: 'ERROR', message: msg, codes: ['COVERAGE_FAILED'] })
        return
      }

      if (shouldQueueInterviewFollowUps) {
        const followUpBatch = buildCoverageFollowUpBatch(
          interviewSnapshot,
          followUpQuestions,
          buildCoverageFollowUpCommentary(response),
        )
        const updatedSnapshot = recordPreparedBatch(
          clearInterviewSessionBatch(interviewSnapshot),
          followUpBatch,
        )
        persistInterviewSession(ticketId, updatedSnapshot)
        insertPhaseArtifact(ticketId, {
          phase: stateLabel,
          artifactType: 'interview_coverage_followups',
          content: JSON.stringify(followUpBatch),
        })

        // Clean up stale PROM4 session so handleInterviewQAStart can run on re-entry
        interviewQASessions.delete(ticketId)

        // Broadcast the follow-up batch so the frontend picks it up immediately
        broadcaster.broadcast(ticketId, 'needs_input', {
          ticketId,
          type: 'interview_batch',
          batch: followUpBatch,
        })
      }
    }

    if (phase === 'interview' && shouldQueueInterviewFollowUps) {
      emitPhaseLog(ticketId, context.externalId, stateLabel, 'info',
        `Coverage gaps detected by winning model ${winnerId}. Looping back for refinement.`)
      sendEvent({ type: 'GAPS_FOUND' })
      return
    }

    if (phase !== 'interview' && gapDisposition.shouldLoopBack) {
      emitPhaseLog(ticketId, context.externalId, stateLabel, 'info',
        `Coverage gaps detected by winning model ${winnerId}. Looping back for refinement.`)
      sendEvent({ type: 'GAPS_FOUND' })
      return
    }

    const reviewReason = phase === 'interview' && gapDisposition.terminationReason === 'follow_up_generation_failed'
      ? interviewCoverageResolution?.validationError
        ?? 'Coverage found interview gaps but produced no parseable follow-up questions.'
      : `Coverage gaps detected by winning model ${winnerId}, but ${describeCoverageTerminationReason(gapDisposition.terminationReason)}. Routing to approval with unresolved gaps for manual review.`
    emitPhaseLog(ticketId, context.externalId, stateLabel, 'info', reviewReason)
    sendEvent({ type: 'COVERAGE_LIMIT_REACHED' })
  } else {
    if (phase === 'interview') {
      try {
        const interviewPath = interviewSnapshot
          ? writeCanonicalInterview(context.externalId, ticketDir, interviewSnapshot)
          : resolve(ticketDir, 'interview.yaml')
        emitPhaseLog(ticketId, context.externalId, stateLabel, 'info',
          `Canonical interview.yaml ready at ${interviewPath}`)
      } catch (err) {
        console.error(`[runner] Failed to generate interview.yaml for ticket ${context.externalId}:`, err)
        emitPhaseLog(ticketId, context.externalId, stateLabel, 'info',
          `Failed to generate interview.yaml: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    emitPhaseLog(ticketId, context.externalId, stateLabel, 'info',
      `Coverage verification passed (winning model: ${winnerId}).`)
    sendEvent({ type: 'COVERAGE_CLEAN' })
  }
}

// ─── Interview QA Batch Handlers ───

async function handleInterviewQAStart(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  signal: AbortSignal,
) {
  const persistedSnapshot = readInterviewSessionSnapshotArtifact(ticketId)
  if (persistedSnapshot?.currentBatch) {
    emitPhaseLog(
      ticketId,
      context.externalId,
      'WAITING_INTERVIEW_ANSWERS',
      'info',
      `Resuming persisted interview batch ${persistedSnapshot.currentBatch.batchNumber}.`,
    )
    broadcaster.broadcast(ticketId, 'needs_input', {
      ticketId,
      type: 'interview_batch',
      batch: persistedSnapshot.currentBatch,
    })
    return
  }

  const restoredSession = await restoreInterviewQASession(ticketId)
  if (restoredSession) {
    const currentBatchArtifact = getLatestPhaseArtifact(ticketId, INTERVIEW_CURRENT_BATCH_ARTIFACT, 'WAITING_INTERVIEW_ANSWERS')
    const persistedBatch = currentBatchArtifact
      ? (() => {
          try {
            return JSON.parse(currentBatchArtifact.content) as PersistedInterviewBatch
          } catch {
            return null
          }
        })()
      : null

    emitPhaseLog(
      ticketId,
      context.externalId,
      'WAITING_INTERVIEW_ANSWERS',
      'info',
      `Reattached PROM4 session ${restoredSession.sessionId} for ${restoredSession.winnerId}.`,
    )

    if (persistedBatch) {
      broadcaster.broadcast(ticketId, 'needs_input', {
        ticketId,
        type: 'interview_batch',
        batch: persistedBatch,
      })
    }
    return
  }

  const { worktreePath, ticket, codebaseMap } = loadTicketDirContext(context)
  const interviewSettings = resolveInterviewDraftSettings(context)

  // Resolve winnerId from persisted artifact
  const winnerArtifact = getLatestPhaseArtifact(ticketId, 'interview_winner')

  let winnerId = ''
  if (winnerArtifact) {
    try {
      const parsed = JSON.parse(winnerArtifact.content) as { winnerId?: string }
      winnerId = parsed.winnerId ?? ''
    } catch { /* ignore */ }
  }
  if (!winnerId) {
    const msg = 'No interview winner found — cannot start PROM4 session'
    emitPhaseLog(ticketId, context.externalId, 'WAITING_INTERVIEW_ANSWERS', 'error', msg)
    sendEvent({ type: 'ERROR', message: msg, codes: ['PROM4_NO_WINNER'] })
    return
  }

  const compiledArtifact = getLatestPhaseArtifact(ticketId, 'interview_compiled')

  let compiledInterview: ReturnType<typeof requireCompiledInterviewArtifact>
  try {
    compiledInterview = requireCompiledInterviewArtifact(compiledArtifact?.content)
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error)
    const code = compiledArtifact ? 'PROM4_INVALID_COMPILED_INTERVIEW' : 'PROM4_NO_COMPILED_INTERVIEW'
    const msg = compiledArtifact
      ? `Compiled interview artifact invalid — cannot start PROM4 session: ${details}`
      : 'No validated compiled interview found — cannot start PROM4 session'
    emitPhaseLog(ticketId, context.externalId, 'WAITING_INTERVIEW_ANSWERS', 'error', msg)
    sendEvent({ type: 'ERROR', message: msg, codes: [code] })
    return
  }

  const ticketState: TicketState = {
    ticketId: context.externalId,
    title: context.title,
    description: ticket?.description ?? '',
    userBackground: interviewSettings.userBackground,
    disableAnalogies: interviewSettings.disableAnalogies,
    codebaseMap,
    interview: compiledInterview.refinedContent,
  }

  const baseSnapshot = persistedSnapshot ?? createInterviewSessionSnapshot({
    winnerId,
    compiledQuestions: compiledInterview.questions,
    maxInitialQuestions: interviewSettings.maxInitialQuestions,
    followUpBudgetPercent: interviewSettings.coverageFollowUpBudgetPercent,
    userBackground: interviewSettings.userBackground,
    disableAnalogies: interviewSettings.disableAnalogies,
  })

  emitPhaseLog(ticketId, context.externalId, 'WAITING_INTERVIEW_ANSWERS', 'info',
    `Starting PROM4 interview session with winning model: ${winnerId}`)

  if (signal.aborted) throw new CancelledError(ticketId)
  const streamState = createOpenCodeStreamState()

  const { sessionId, firstBatch } = await startInterviewSession(
    adapter,
    worktreePath,
    winnerId,
    compiledInterview.refinedContent,
    ticketState,
    interviewSettings.maxInitialQuestions,
    interviewSettings.coverageFollowUpBudgetPercent,
    signal,
    (entry) => {
      emitOpenCodeStreamEvent(
        ticketId,
        context.externalId,
        'WAITING_INTERVIEW_ANSWERS',
        winnerId,
        entry.sessionId,
        entry.event,
        streamState,
      )
    },
    (entry) => {
      emitOpenCodePromptLog(
        ticketId,
        context.externalId,
        'WAITING_INTERVIEW_ANSWERS',
        winnerId,
        entry.event,
      )
    },
    ticketId,
  )
  throwIfAborted(signal, ticketId)

  // Store session info
  interviewQASessions.set(ticketId, { sessionId, winnerId })
  insertPhaseArtifact(ticketId, {
    phase: 'WAITING_INTERVIEW_ANSWERS',
    artifactType: INTERVIEW_QA_SESSION_ARTIFACT,
    content: JSON.stringify({ sessionId, winnerId }),
  })

  const persistedBatch = buildPersistedBatch(firstBatch, 'prom4', baseSnapshot)
  const updatedSnapshot = recordPreparedBatch(baseSnapshot, persistedBatch)
  persistInterviewSession(ticketId, updatedSnapshot)

  emitPhaseLog(ticketId, context.externalId, 'WAITING_INTERVIEW_ANSWERS', 'info',
    `PROM4 session started (session=${sessionId}). First batch: ${persistedBatch.questions.length} questions.`)
  emitAiMilestone(
    ticketId,
    context.externalId,
    'WAITING_INTERVIEW_ANSWERS',
    `PROM4 session created for ${winnerId} (session=${sessionId}).`,
    `${sessionId}:prom4-created`,
    {
      modelId: winnerId,
      sessionId,
      source: `model:${winnerId}`,
    },
  )

  // Broadcast first batch to frontend via SSE
  broadcaster.broadcast(ticketId, 'needs_input', {
    ticketId,
    type: 'interview_batch',
    batch: persistedBatch,
  })
}

/**
 * Handle a batch of user answers submitted during the PROM4 interview loop.
 * Called by the API route, not the state machine subscriber.
 */
export async function handleInterviewQABatch(
  ticketId: string,
  batchAnswers: Record<string, string>,
): Promise<BatchResponse> {
  const snapshot = readInterviewSessionSnapshotArtifact(ticketId)
  if (!snapshot?.currentBatch) {
    throw new Error('No active interview batch for this ticket')
  }

  const ticket = getTicketByRef(ticketId)
  const externalId = ticket?.externalId ?? ticketId
  const currentBatch = snapshot.currentBatch
  const answeredSnapshot = recordBatchAnswers(snapshot, batchAnswers)

  if (isMockOpenCodeMode()) {
    if (currentBatch.source === 'prom4' && currentBatch.batchNumber === 1) {
      const followUpBatch = buildPersistedBatch(
        {
          questions: buildMockInterviewFollowUpQuestions().map(({ id, question, phase, priority, rationale }) => ({
            id,
            question,
            phase,
            priority,
            rationale,
          })),
          progress: { current: 2, total: 2 },
          isComplete: false,
          isFinalFreeForm: false,
          aiCommentary: 'Mock follow-up batch ready.',
          batchNumber: 2,
        },
        'prom4',
        answeredSnapshot,
      )
      const updatedSnapshot = recordPreparedBatch(answeredSnapshot, followUpBatch)
      persistInterviewSession(ticketId, updatedSnapshot)
      return followUpBatch
    }

    const completedSnapshot = markInterviewSessionComplete(answeredSnapshot)
    const paths = getTicketPaths(ticketId)
    if (paths) {
      writeCanonicalInterview(ticket?.externalId ?? ticketId, paths.ticketDir, completedSnapshot)
    }
    persistInterviewSession(ticketId, completedSnapshot)
    return {
      questions: [],
      progress: currentBatch.progress,
      isComplete: true,
      isFinalFreeForm: currentBatch.isFinalFreeForm,
      aiCommentary: 'Mock interview complete.',
      batchNumber: currentBatch.batchNumber,
    }
  }

  if (currentBatch.source === 'coverage') {
    const paths = getTicketPaths(ticketId)
    if (!paths) {
      throw new Error(`Ticket workspace not initialized: missing ticket paths for ${externalId}`)
    }
    const completedSnapshot = markInterviewSessionComplete(answeredSnapshot)
    writeCanonicalInterview(externalId, paths.ticketDir, completedSnapshot)
    persistInterviewSession(ticketId, completedSnapshot)
    // Clean up stale PROM4 session for the coverage loop re-entry
    interviewQASessions.delete(ticketId)
    emitPhaseLog(
      ticketId,
      externalId,
      'WAITING_INTERVIEW_ANSWERS',
      'info',
      `Coverage follow-up batch ${currentBatch.batchNumber} captured. Returning to interview coverage verification.`,
    )
    return {
      questions: [],
      progress: currentBatch.progress,
      isComplete: true,
      isFinalFreeForm: false,
      aiCommentary: 'Coverage follow-up answers captured. Re-running coverage.',
      batchNumber: currentBatch.batchNumber,
    }
  }

  // Persist intermediate state immediately: answers saved, currentBatch cleared.
  // This ensures GET /interview returns the correct state while the AI processes
  // the next batch, and answers are not lost if the OpenCode call fails.
  persistInterviewSession(ticketId, answeredSnapshot)

  // Get session info from memory or reload from DB
  const sessionInfo = await restoreInterviewQASession(ticketId)
  if (!sessionInfo) {
    const persistedSessionInfo = readInterviewQASessionArtifact(ticketId)
    if (persistedSessionInfo?.sessionId === 'mock-session') {
      const paths = getTicketPaths(ticketId)
      if (!paths) {
        throw new Error(`Ticket workspace not initialized: missing ticket paths for ${externalId}`)
      }

      const nextMockBatch = buildPersistedMockInterviewBatch(answeredSnapshot)
      if (!nextMockBatch) {
        const rawFinalYaml = buildCanonicalInterviewYaml(externalId, answeredSnapshot)
        const completedSnapshot = markInterviewSessionComplete(answeredSnapshot, rawFinalYaml)
        insertPhaseArtifact(ticketId, {
          phase: 'WAITING_INTERVIEW_ANSWERS',
          artifactType: INTERVIEW_PROM4_FINAL_ARTIFACT,
          content: rawFinalYaml,
        })
        writeCanonicalInterview(externalId, paths.ticketDir, completedSnapshot)
        persistInterviewSession(ticketId, completedSnapshot)

        emitPhaseLog(
          ticketId,
          externalId,
          'WAITING_INTERVIEW_ANSWERS',
          'info',
          'Persisted mock interview completed after restart-safe batch replay.',
        )

        return {
          questions: [],
          progress: currentBatch.progress,
          isComplete: true,
          isFinalFreeForm: currentBatch.isFinalFreeForm,
          aiCommentary: 'Mock interview complete.',
          batchNumber: currentBatch.batchNumber,
        }
      }

      const persistedNextBatch = buildPersistedBatch(nextMockBatch, 'prom4', answeredSnapshot)
      const updatedSnapshot = recordPreparedBatch(answeredSnapshot, persistedNextBatch)
      persistInterviewSession(ticketId, updatedSnapshot)

      emitPhaseLog(
        ticketId,
        externalId,
        'WAITING_INTERVIEW_ANSWERS',
        'info',
        `Persisted mock interview advanced to batch ${persistedNextBatch.batchNumber}.`,
      )

      return persistedNextBatch
    }

    throw new Error('No active PROM4 session for this ticket')
  }

  const signal = getOrCreateAbortSignal(ticketId)
  const streamState = createOpenCodeStreamState()
  const result = await submitBatchToSession(
    adapter,
    sessionInfo.sessionId,
    batchAnswers,
    signal,
    sessionInfo.winnerId,
    (entry) => {
      emitOpenCodeStreamEvent(
        ticketId,
        externalId,
        'WAITING_INTERVIEW_ANSWERS',
        sessionInfo.winnerId,
        entry.sessionId,
        entry.event,
        streamState,
      )
    },
    (entry) => {
      emitOpenCodePromptLog(
        ticketId,
        externalId,
        'WAITING_INTERVIEW_ANSWERS',
        sessionInfo.winnerId,
        entry.event,
      )
    },
    ticketId,
  )
  throwIfAborted(signal, ticketId)

  if (result.isComplete) {
    const paths = getTicketPaths(ticketId)
    if (!paths) {
      throw new Error(`Ticket workspace not initialized: missing ticket paths for ${externalId}`)
    }

    const completedSnapshot = markInterviewSessionComplete(answeredSnapshot, result.finalYaml)
    if (result.finalYaml?.trim()) {
      insertPhaseArtifact(ticketId, {
        phase: 'WAITING_INTERVIEW_ANSWERS',
        artifactType: INTERVIEW_PROM4_FINAL_ARTIFACT,
        content: result.finalYaml.trim(),
      })
    }
    writeCanonicalInterview(externalId, paths.ticketDir, completedSnapshot)
    persistInterviewSession(ticketId, completedSnapshot)

    emitPhaseLog(
      ticketId,
      externalId,
      'WAITING_INTERVIEW_ANSWERS',
      'info',
      `PROM4 interview complete. Canonical interview.yaml regenerated from normalized session state.`,
    )

    return {
      ...result,
      batchNumber: currentBatch.batchNumber,
    }
  }

  const persistedNextBatch = buildPersistedBatch(result, 'prom4', answeredSnapshot)
  const updatedSnapshot = recordPreparedBatch(answeredSnapshot, persistedNextBatch)
  persistInterviewSession(ticketId, updatedSnapshot)

  emitPhaseLog(ticketId, externalId, 'WAITING_INTERVIEW_ANSWERS', 'info',
    `PROM4 batch ${persistedNextBatch.batchNumber}: ${persistedNextBatch.questions.length} questions. Progress: ${persistedNextBatch.progress.current}/${persistedNextBatch.progress.total}.`)

  return persistedNextBatch
}

/**
 * Fire-and-forget wrapper for handleInterviewQABatch.
 * Records answers synchronously (via handleInterviewQABatch's intermediate persist),
 * then processes the AI call in the background. On error, reverts to the original
 * snapshot so the user can retry.
 *
 * Returns a Promise that resolves with the BatchResponse (for .then()/.catch() chaining
 * in the route handler). Callers should NOT await this — call it fire-and-forget.
 */
export function processInterviewBatchAsync(
  ticketId: string,
  batchAnswers: Record<string, string>,
  originalSnapshot: InterviewSessionSnapshot,
): Promise<BatchResponse> {
  return handleInterviewQABatch(ticketId, batchAnswers)
    .catch((err) => {
      // Revert to original snapshot so the user can retry the submission
      try {
        persistInterviewSession(ticketId, originalSnapshot)
      } catch (revertErr) {
        console.error(`[runner] Failed to revert interview snapshot for ${ticketId}:`, revertErr)
      }
      throw err
    })
}

function buildMockInterviewQuestions() {
  return [
    {
      id: 'goal',
      phase: 'foundation',
      question: 'What is the primary outcome this ticket should deliver?',
      priority: 'critical',
      rationale: 'Clarifies the core success criteria.',
    },
    {
      id: 'constraints',
      phase: 'structure',
      question: 'What implementation constraints or boundaries should the agent respect?',
      priority: 'high',
      rationale: 'Prevents invalid implementation choices.',
    },
    {
      id: 'verification',
      phase: 'assembly',
      question: 'How should success be verified once implementation is complete?',
      priority: 'high',
      rationale: 'Defines acceptance and testing expectations.',
    },
  ]
}

function buildMockInterviewFollowUpQuestions() {
  return [
    {
      id: 'tradeoffs',
      phase: 'assembly',
      question: 'If scope or complexity has to move, which tradeoffs are acceptable and which are not?',
      priority: 'medium',
      rationale: 'Captures prioritization boundaries before implementation starts.',
    },
  ]
}

function buildMockInterviewFinalQuestion() {
  return {
    id: 'final_notes',
    phase: 'assembly',
    question: 'What is the most important implementation note or edge case the agent should not miss?',
    priority: 'high',
    rationale: 'Captures the last high-signal guidance before implementation begins.',
  }
}

function buildPersistedMockInterviewBatch(
  snapshot: InterviewSessionSnapshot,
): BatchResponse | null {
  const answeredBatchCount = snapshot.batchHistory.length

  if (answeredBatchCount === 1) {
    return {
      questions: buildMockInterviewFollowUpQuestions().map(({ id, question, phase, priority, rationale }) => ({
        id,
        question,
        phase,
        priority,
        rationale,
      })),
      progress: { current: 2, total: 3 },
      isComplete: false,
      isFinalFreeForm: false,
      aiCommentary: 'One follow-up question to pin down acceptable tradeoffs.',
      batchNumber: 2,
    }
  }

  if (answeredBatchCount === 2) {
    const finalQuestion = buildMockInterviewFinalQuestion()
    return {
      questions: [{
        id: finalQuestion.id,
        question: finalQuestion.question,
        phase: finalQuestion.phase,
        priority: finalQuestion.priority,
        rationale: finalQuestion.rationale,
      }],
      progress: { current: 3, total: 3 },
      isComplete: false,
      isFinalFreeForm: true,
      aiCommentary: 'One final question before the interview artifact is finalized.',
      batchNumber: 3,
    }
  }

  return null
}

function buildMockInterviewCompiledContent() {
  return jsYaml.dump({
    questions: buildMockInterviewQuestions().map(({ id, phase, question, priority, rationale }) => ({
      id,
      phase,
      question,
      priority,
      rationale,
    })),
    changes: [],
  }, { lineWidth: 120, noRefs: true }) as string
}

function buildMockInterviewDraftContent(variantIndex: number) {
  const questions = buildMockInterviewQuestions().map((question) => ({ ...question }))
  if (variantIndex > 0) {
    questions.push({
      id: `tradeoffs-${variantIndex + 1}`,
      phase: 'assembly',
      question: 'Which tradeoffs are acceptable if scope, timing, or implementation complexity conflict?',
      priority: 'medium',
      rationale: 'Surfaces prioritization decisions before implementation starts.',
    })
  }

  return jsYaml.dump({
    questions: questions.map(({ id, phase, question, priority, rationale }) => ({
      id,
      phase,
      question,
      priority,
      rationale,
    })),
  }, { lineWidth: 120, noRefs: true }) as string
}

function buildMockInterviewDrafts(members: Array<{ modelId: string; name: string }>): DraftResult[] {
  return members.map((member, index) => ({
    memberId: member.modelId,
    content: index === 0 ? buildMockInterviewCompiledContent() : buildMockInterviewDraftContent(index),
    outcome: 'completed',
    duration: 1,
    questionCount: index === 0 ? buildMockInterviewQuestions().length : buildMockInterviewQuestions().length + 1,
  }))
}

function buildMockInterviewVoteResult(
  members: Array<{ modelId: string; name: string }>,
  drafts: DraftResult[],
): {
  votes: Vote[]
  voterOutcomes: Record<string, MemberOutcome>
  presentationOrders: Record<string, VotePresentationOrder>
  winnerId: string
  totalScore: number
} {
  const winnerId = drafts[0]?.memberId ?? members[0]?.modelId ?? 'mock-model-1'
  const winnerScorecards = [
    [19, 19, 18, 18, 19],
    [18, 19, 19, 18, 18],
  ]
  const challengerScorecards = [
    [16, 15, 15, 16, 15],
    [15, 16, 15, 15, 16],
  ]

  const votes: Vote[] = []
  const voterOutcomes = members.reduce<Record<string, MemberOutcome>>((acc, member) => {
    acc[member.modelId] = 'completed'
    return acc
  }, {})
  const presentationOrders: Record<string, VotePresentationOrder> = {}

  members.forEach((member, memberIndex) => {
    const orderedDrafts = memberIndex % 2 === 0 ? drafts : [...drafts].reverse()
    presentationOrders[member.modelId] = {
      seed: `mock-seed-interview-${memberIndex + 1}`,
      order: orderedDrafts.map((draft) => draft.memberId),
    }

    orderedDrafts.forEach((draft) => {
      const scoreTemplate = draft.memberId === winnerId
        ? winnerScorecards[memberIndex % winnerScorecards.length]!
        : challengerScorecards[memberIndex % challengerScorecards.length]!
      const scores = VOTING_RUBRIC_INTERVIEW.map((criterion, scoreIndex) => ({
        category: criterion.category,
        score: scoreTemplate[scoreIndex] ?? 15,
        justification: draft.memberId === winnerId
          ? `Mock voter ${memberIndex + 1} preferred this draft on ${criterion.category.toLowerCase()}.`
          : `Mock voter ${memberIndex + 1} found this draft weaker on ${criterion.category.toLowerCase()}.`,
      }))
      const totalScore = scores.reduce((sum, score) => sum + score.score, 0)
      votes.push({
        voterId: member.modelId,
        draftId: draft.memberId,
        scores,
        totalScore,
      })
    })
  })

  const totalScore = votes
    .filter((vote) => vote.draftId === winnerId)
    .reduce((sum, vote) => sum + vote.totalScore, 0)

  return { votes, voterOutcomes, presentationOrders, winnerId, totalScore }
}

function readMockInterviewWinnerId(ticketId: string, fallbackWinnerId: string): string {
  const voteArtifact = getLatestPhaseArtifact(ticketId, 'interview_votes')
  if (!voteArtifact) return fallbackWinnerId

  try {
    const parsed = JSON.parse(voteArtifact.content) as { winnerId?: unknown }
    return typeof parsed.winnerId === 'string' ? parsed.winnerId : fallbackWinnerId
  } catch {
    return fallbackWinnerId
  }
}

function buildMockPrdContent(context: TicketContext) {
  return jsYaml.dump({
    schema_version: 1,
    artifact: 'prd',
    title: context.title,
    summary: `Mock PRD for ${context.title}`,
    goals: [
      'Keep all LoopTroop runtime state inside the project-local .looptroop directory.',
      'Preserve ticket lifecycle metadata and artifacts for restart and inspection.',
    ],
    constraints: [
      'Do not write ticket data into the app checkout.',
      'Keep the workflow deterministic in mock mode for testing.',
    ],
    acceptance_criteria: [
      'Project-local db.sqlite exists inside the attached repo.',
      'Ticket artifacts and execution log are written under the project-local worktree.',
      'The ticket can progress through the full lifecycle in mock mode.',
    ],
  }, { lineWidth: 120, noRefs: true }) as string
}

function buildMockBeadSubsets(context: TicketContext): BeadSubset[] {
  return [
    {
      id: 'bead-1',
      title: 'Project-local storage plumbing',
      prdRefs: ['AC-1'],
      description: `Store ${context.title} runtime state under the project-local .looptroop directory.`,
      contextGuidance: 'Update path resolution and local-db ownership first.',
      acceptanceCriteria: ['All ticket files resolve under <project>/.looptroop/worktrees/<ticket-id>/.ticket/.'],
      tests: ['Create a ticket and verify its meta and execution log paths.'],
      testCommands: ['npm run test -- server/routes'],
    },
    {
      id: 'bead-2',
      title: 'String ticket refs through the app',
      prdRefs: ['AC-2'],
      description: 'Propagate <projectId>:<externalId> ticket refs through API, SSE, and UI state.',
      contextGuidance: 'Keep project ids numeric while converting public ticket ids to strings.',
      acceptanceCriteria: ['Routes, SSE, and UI all accept string ticket refs.'],
      tests: ['Fetch and open a ticket using its string ref.'],
      testCommands: ['npm run test -- src/hooks'],
    },
    {
      id: 'bead-3',
      title: 'Deterministic mock lifecycle verification',
      prdRefs: ['AC-3'],
      description: 'Support a deterministic mock runtime for complete browser-driven lifecycle tests.',
      contextGuidance: 'Mock mode should create stable artifacts and pass through the full flow.',
      acceptanceCriteria: ['A ticket reaches COMPLETED in mock mode without external AI dependencies.'],
      tests: ['Run the browser lifecycle script end-to-end.'],
      testCommands: ['npm run test'],
    },
  ]
}

function getBeadsPath(ticketId: string): string {
  const paths = getTicketPaths(ticketId)
  if (!paths) throw new Error(`Ticket workspace not initialized: missing ticket paths for ${ticketId}`)
  return paths.beadsPath
}

function readTicketBeads(ticketId: string): Bead[] {
  return readJsonl<Bead>(getBeadsPath(ticketId))
}

function writeTicketBeads(ticketId: string, beads: Bead[]) {
  writeJsonl(getBeadsPath(ticketId), beads)
}

function updateTicketProgressFromBeads(ticketId: string, beads: Bead[]) {
  const total = beads.length
  const completed = beads.filter(bead => bead.status === 'completed' || bead.status === 'skipped').length
  const currentIndex = total === 0
    ? 0
    : completed >= total
      ? total
      : completed + 1
  const percentComplete = total === 0 ? 0 : Math.round((completed / total) * 100)

  patchTicket(ticketId, {
    currentBead: currentIndex,
    totalBeads: total,
    percentComplete,
  })
}

async function handleMockCouncilDeliberate(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
) {
  const { members } = resolveCouncilMembers(context)
  const drafts = buildMockInterviewDrafts(members)
  const memberOutcomes = drafts.reduce<Record<string, MemberOutcome>>((acc, draft) => {
    acc[draft.memberId] = draft.outcome
    return acc
  }, {})
  upsertCouncilDraftArtifact(ticketId, 'COUNCIL_DELIBERATING', 'interview_drafts', drafts, memberOutcomes, true)
  emitPhaseLog(ticketId, context.externalId, 'COUNCIL_DELIBERATING', 'info', 'Mock interview drafting complete.')
  sendEvent({ type: 'QUESTIONS_READY', result: { winnerId: members[0]?.modelId } })
}

async function handleMockInterviewVote(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
) {
  const { members } = resolveCouncilMembers(context)
  const drafts = buildMockInterviewDrafts(members)
  const voteResult = buildMockInterviewVoteResult(members, drafts)
  upsertCouncilVoteArtifact(
    ticketId,
    'COUNCIL_VOTING_INTERVIEW',
    'interview_votes',
    drafts,
    voteResult.votes,
    voteResult.voterOutcomes,
    voteResult.presentationOrders,
    voteResult.winnerId,
    voteResult.totalScore,
    true,
  )
  emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_INTERVIEW', 'info', 'Mock interview winner selected.')
  sendEvent({ type: 'WINNER_SELECTED', winner: voteResult.winnerId })
}

async function handleMockInterviewCompile(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
) {
  const { members } = resolveCouncilMembers(context)
  const winnerId = readMockInterviewWinnerId(ticketId, members[0]?.modelId ?? 'mock-model-1')
  const refinedContent = buildMockInterviewCompiledContent()
  const compiledArtifact = buildCompiledInterviewArtifact(
    winnerId,
    refinedContent,
    buildMockInterviewDraftContent(0),
    buildMockInterviewQuestions().length,
  )
  insertPhaseArtifact(ticketId, {
    phase: 'COMPILING_INTERVIEW',
    artifactType: 'interview_compiled',
    content: JSON.stringify(compiledArtifact),
  })
  insertPhaseArtifact(ticketId, {
    phase: 'COMPILING_INTERVIEW',
    artifactType: 'interview_winner',
    content: JSON.stringify({ winnerId }),
  })
  emitPhaseLog(ticketId, context.externalId, 'COMPILING_INTERVIEW', 'info', 'Mock interview compiled.')
  sendEvent({ type: 'READY' })
}

async function handleMockInterviewQAStart(
  ticketId: string,
  context: TicketContext,
) {
  const { members } = resolveCouncilMembers(context)
  const winnerId = readMockInterviewWinnerId(ticketId, members[0]?.modelId ?? 'mock-model-1')
  const interviewSettings = resolveInterviewDraftSettings(context)
  const batch: BatchResponse = {
    questions: buildMockInterviewQuestions().map(({ id, question, phase, priority, rationale }) => ({
      id,
      question,
      phase,
      priority,
      rationale,
    })),
    progress: { current: 1, total: 2 },
    isComplete: false,
    isFinalFreeForm: false,
    aiCommentary: 'Mock interview batch ready.',
    batchNumber: 1,
  }

  const snapshot = createInterviewSessionSnapshot({
    winnerId,
    compiledQuestions: buildMockInterviewQuestions().map(({ id, phase, question }) => ({ id, phase, question })),
    maxInitialQuestions: interviewSettings.maxInitialQuestions,
    followUpBudgetPercent: interviewSettings.coverageFollowUpBudgetPercent,
    userBackground: interviewSettings.userBackground,
    disableAnalogies: interviewSettings.disableAnalogies,
  })
  const persistedBatch = buildPersistedBatch(batch, 'prom4', snapshot)
  const updatedSnapshot = recordPreparedBatch(snapshot, persistedBatch)

  interviewQASessions.set(ticketId, { sessionId: 'mock-session', winnerId })
  insertPhaseArtifact(ticketId, {
    phase: 'WAITING_INTERVIEW_ANSWERS',
    artifactType: INTERVIEW_QA_SESSION_ARTIFACT,
    content: JSON.stringify({ sessionId: 'mock-session', winnerId }),
  })
  persistInterviewSession(ticketId, updatedSnapshot)
  emitPhaseLog(ticketId, context.externalId, 'WAITING_INTERVIEW_ANSWERS', 'info', 'Mock interview questions ready for input.')
  broadcaster.broadcast(ticketId, 'needs_input', {
    ticketId,
    type: 'interview_batch',
    batch: persistedBatch,
  })
}

async function handleMockCoverage(
  ticketId: string,
  context: TicketContext,
  phase: 'interview' | 'prd' | 'beads',
  sendEvent: (event: TicketEvent) => void,
) {
  const { members } = resolveCouncilMembers(context)
  const winnerId = readMockInterviewWinnerId(ticketId, members[0]?.modelId ?? 'mock-model-1')
  const stateLabel = getCoverageStateLabel(phase)
  const coverageSettings = resolveCoverageRuntimeSettings(context)
  const coverageRunNumber = countPhaseArtifacts(ticketId, `${phase}_coverage`, stateLabel) + 1
  const interviewSnapshot = phase === 'interview'
    ? readInterviewSessionSnapshotArtifact(ticketId)
    : null

  insertPhaseArtifact(ticketId, {
    phase: stateLabel,
    artifactType: `${phase}_coverage`,
    content: JSON.stringify({
      winnerId,
      response: 'mock coverage clean',
      hasGaps: false,
      coverageRunNumber,
      maxCoveragePasses: coverageSettings.maxCoveragePasses,
      limitReached: false,
      terminationReason: 'clean',
      ...(phase === 'interview' && interviewSnapshot
        ? {
            followUpBudgetPercent: coverageSettings.coverageFollowUpBudgetPercent,
            followUpBudgetTotal: calculateFollowUpLimit(interviewSnapshot.maxInitialQuestions, coverageSettings.coverageFollowUpBudgetPercent),
            followUpBudgetUsed: countCoverageFollowUpQuestions(interviewSnapshot),
            followUpBudgetRemaining: Math.max(
              0,
              calculateFollowUpLimit(interviewSnapshot.maxInitialQuestions, coverageSettings.coverageFollowUpBudgetPercent)
                - countCoverageFollowUpQuestions(interviewSnapshot),
            ),
          }
        : {}),
    }),
  })

  if (phase === 'interview') {
    const paths = getTicketPaths(ticketId)
    if (paths && interviewSnapshot) {
      writeCanonicalInterview(context.externalId, paths.ticketDir, interviewSnapshot)
    }
  }

  emitPhaseLog(ticketId, context.externalId, stateLabel, 'info', `Mock ${phase} coverage passed.`)
  sendEvent({ type: 'COVERAGE_CLEAN' })
}

async function handleMockPrdDraft(ticketId: string, context: TicketContext, sendEvent: (event: TicketEvent) => void) {
  insertPhaseArtifact(ticketId, {
    phase: 'DRAFTING_PRD',
    artifactType: 'prd_drafts',
    content: JSON.stringify({ drafts: [{ memberId: 'mock-model-1', outcome: 'completed' }] }),
  })
  emitPhaseLog(ticketId, context.externalId, 'DRAFTING_PRD', 'info', 'Mock PRD drafts ready.')
  sendEvent({ type: 'DRAFTS_READY' })
}

async function handleMockPrdVote(ticketId: string, context: TicketContext, sendEvent: (event: TicketEvent) => void) {
  insertPhaseArtifact(ticketId, {
    phase: 'COUNCIL_VOTING_PRD',
    artifactType: 'prd_votes',
    content: JSON.stringify({
      winnerId: 'mock-model-1',
      totalScore: 1,
      presentationOrders: {
        'mock-model-1': {
          seed: 'mock-seed-prd',
          order: ['mock-model-1'],
        },
      },
    }),
  })
  emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_PRD', 'info', 'Mock PRD winner selected.')
  sendEvent({ type: 'WINNER_SELECTED', winner: 'mock-model-1' })
}

async function handleMockPrdRefine(ticketId: string, context: TicketContext, sendEvent: (event: TicketEvent) => void) {
  const paths = getTicketPaths(ticketId)
  if (!paths) throw new Error(`Ticket workspace not initialized: missing ticket paths for ${context.externalId}`)
  const refinedContent = buildMockPrdContent(context)
  insertPhaseArtifact(ticketId, {
    phase: 'REFINING_PRD',
    artifactType: 'prd_refined',
    content: JSON.stringify({ winnerId: 'mock-model-1', refinedContent }),
  })
  safeAtomicWrite(resolve(paths.ticketDir, 'prd.yaml'), refinedContent)
  emitPhaseLog(ticketId, context.externalId, 'REFINING_PRD', 'info', 'Mock PRD written to disk.')
  sendEvent({ type: 'REFINED' })
}

async function handleMockBeadsDraft(ticketId: string, context: TicketContext, sendEvent: (event: TicketEvent) => void) {
  insertPhaseArtifact(ticketId, {
    phase: 'DRAFTING_BEADS',
    artifactType: 'beads_drafts',
    content: JSON.stringify({ drafts: [{ memberId: 'mock-model-1', outcome: 'completed' }] }),
  })
  emitPhaseLog(ticketId, context.externalId, 'DRAFTING_BEADS', 'info', 'Mock beads drafts ready.')
  sendEvent({ type: 'DRAFTS_READY' })
}

async function handleMockBeadsVote(ticketId: string, context: TicketContext, sendEvent: (event: TicketEvent) => void) {
  insertPhaseArtifact(ticketId, {
    phase: 'COUNCIL_VOTING_BEADS',
    artifactType: 'beads_votes',
    content: JSON.stringify({
      winnerId: 'mock-model-1',
      totalScore: 1,
      presentationOrders: {
        'mock-model-1': {
          seed: 'mock-seed-beads',
          order: ['mock-model-1'],
        },
      },
    }),
  })
  emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_BEADS', 'info', 'Mock beads winner selected.')
  sendEvent({ type: 'WINNER_SELECTED', winner: 'mock-model-1' })
}

async function handleMockBeadsRefine(ticketId: string, context: TicketContext, sendEvent: (event: TicketEvent) => void) {
  const paths = getTicketPaths(ticketId)
  if (!paths) throw new Error(`Ticket workspace not initialized: missing ticket paths for ${context.externalId}`)
  const beadSubsets = buildMockBeadSubsets(context)
  const expandedBeads = expandBeads(beadSubsets)
  insertPhaseArtifact(ticketId, {
    phase: 'REFINING_BEADS',
    artifactType: 'beads_refined',
    content: JSON.stringify({ winnerId: 'mock-model-1', refinedContent: JSON.stringify(beadSubsets), expandedBeads }),
  })
  writeJsonl(paths.beadsPath, expandedBeads)
  patchTicket(ticketId, {
    totalBeads: expandedBeads.length,
    currentBead: 0,
    percentComplete: 0,
  })
  emitPhaseLog(ticketId, context.externalId, 'REFINING_BEADS', 'info', `Mock beads expanded to ${expandedBeads.length} tasks.`)
  sendEvent({ type: 'REFINED' })
}

async function handleMockExecutionUnsupported(
  ticketId: string,
  context: TicketContext,
  phase: string,
  sendEvent: (event: TicketEvent) => void,
) {
  const message = 'Mock OpenCode mode stops before execution. Start a real OpenCode server to continue past planning phases.'
  emitPhaseLog(ticketId, context.externalId, phase, 'error', message)
  sendEvent({ type: 'ERROR', message, codes: ['MOCK_EXECUTION_UNSUPPORTED'] })
}

async function handlePreFlight(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  signal: AbortSignal,
) {
  const beads = readTicketBeads(ticketId)
  const report = await runPreFlightChecks(adapter, ticketId, beads, signal)
  throwIfAborted(signal, ticketId)
  insertPhaseArtifact(ticketId, {
    phase: 'PRE_FLIGHT_CHECK',
    artifactType: 'preflight_report',
    content: JSON.stringify(report),
  })

  if (!report.passed) {
    emitPhaseLog(ticketId, context.externalId, 'PRE_FLIGHT_CHECK', 'error', 'Pre-flight checks failed.', {
      failures: report.criticalFailures.map(check => check.message),
    })
    sendEvent({ type: 'CHECKS_FAILED', errors: report.criticalFailures.map(check => check.message) })
    return
  }

  updateTicketProgressFromBeads(ticketId, beads)
  emitPhaseLog(ticketId, context.externalId, 'PRE_FLIGHT_CHECK', 'info', `Pre-flight checks passed with ${beads.length} beads ready.`)
  sendEvent({ type: 'CHECKS_PASSED' })
}

async function handleCoding(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  signal: AbortSignal,
) {
  const paths = getTicketPaths(ticketId)
  if (!paths) throw new Error(`Ticket workspace not initialized: missing ticket paths for ${context.externalId}`)

  const beads = readTicketBeads(ticketId)
  if (beads.length === 0) {
    throw new Error('No beads available for execution')
  }

  if (isAllComplete(beads)) {
    updateTicketProgressFromBeads(ticketId, beads)
    sendEvent({ type: 'ALL_BEADS_DONE' })
    return
  }

  if (isMockOpenCodeMode()) {
    await handleMockExecutionUnsupported(ticketId, context, 'CODING', sendEvent)
    return
  }

  const nextBead = getNextBead(beads)
  if (!nextBead) {
    throw new Error('No runnable bead found; unresolved dependencies remain')
  }

  const now = new Date().toISOString()
  const inProgressBeads = beads.map(bead => bead.id === nextBead.id
    ? { ...bead, status: 'in_progress' as const, updatedAt: now }
    : bead)
  writeTicketBeads(ticketId, inProgressBeads)
  updateTicketProgressFromBeads(ticketId, inProgressBeads)

  emitPhaseLog(ticketId, context.externalId, 'CODING', 'info', `Executing bead ${nextBead.id}: ${nextBead.title}`)

  const contextParts = await adapter.assembleBeadContext(ticketId, nextBead.id)
  throwIfAborted(signal, ticketId)
  const codingModelId = context.lockedMainImplementer
  if (!codingModelId) {
    throw new Error('No locked main implementer is configured for coding')
  }
  const executionSettings = resolveExecutionRuntimeSettings(context)
  const streamStates = new Map<string, OpenCodeStreamState>()
  const result = await executeBead(
    adapter,
    nextBead,
    contextParts,
    paths.worktreePath,
    executionSettings.maxIterations,
    executionSettings.perIterationTimeoutMs,
    signal,
    {
      ticketId,
      model: codingModelId,
      onSessionCreated: (sessionId, iteration) => {
        emitAiMilestone(
          ticketId,
          context.externalId,
          'CODING',
          `Coding session created for bead ${nextBead.id} attempt ${iteration} (session=${sessionId}).`,
          `${nextBead.id}:${iteration}:created`,
          {
            modelId: codingModelId,
            sessionId,
            source: `model:${codingModelId}`,
          },
        )
      },
      onOpenCodeStreamEvent: ({ sessionId, event }) => {
        const streamState = streamStates.get(sessionId) ?? createOpenCodeStreamState()
        streamStates.set(sessionId, streamState)
        emitOpenCodeStreamEvent(
          ticketId,
          context.externalId,
          'CODING',
          codingModelId,
          sessionId,
          event,
          streamState,
        )
      },
      onPromptDispatched: ({ event }) => {
        emitOpenCodePromptLog(
          ticketId,
          context.externalId,
          'CODING',
          codingModelId,
          event,
        )
      },
    },
  )
  throwIfAborted(signal, ticketId)

  insertPhaseArtifact(ticketId, {
    phase: 'CODING',
    artifactType: `bead_execution:${nextBead.id}`,
    content: JSON.stringify(result),
  })

  if (!result.success) {
    const failedBeads = inProgressBeads.map(bead => bead.id === nextBead.id
      ? {
          ...bead,
          status: 'failed' as const,
          iteration: result.iteration,
          updatedAt: new Date().toISOString(),
        }
      : bead)
    writeTicketBeads(ticketId, failedBeads)
    updateTicketProgressFromBeads(ticketId, failedBeads)
    emitPhaseLog(ticketId, context.externalId, 'CODING', 'error', `Bead ${nextBead.id} failed.`, {
      errors: result.errors,
    })
    sendEvent({ type: 'BEAD_ERROR' })
    return
  }

  const completedBeads = inProgressBeads.map(bead => bead.id === nextBead.id
    ? {
        ...bead,
        status: 'completed' as const,
        iteration: result.iteration,
        updatedAt: new Date().toISOString(),
      }
    : bead)
  writeTicketBeads(ticketId, completedBeads)
  updateTicketProgressFromBeads(ticketId, completedBeads)

  broadcaster.broadcast(ticketId, 'bead_complete', {
    ticketId,
    beadId: nextBead.id,
    title: nextBead.title,
    completed: completedBeads.filter(bead => bead.status === 'completed' || bead.status === 'skipped').length,
    total: completedBeads.length,
  })

  emitPhaseLog(ticketId, context.externalId, 'CODING', 'bead_complete', `Completed bead ${nextBead.id}: ${nextBead.title}`)
  if (isAllComplete(completedBeads)) {
    sendEvent({ type: 'ALL_BEADS_DONE' })
  } else {
    sendEvent({ type: 'BEAD_COMPLETE' })
  }
}

async function handleFinalTest(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  signal: AbortSignal,
) {
  if (isMockOpenCodeMode()) {
    await handleMockExecutionUnsupported(ticketId, context, 'RUNNING_FINAL_TEST', sendEvent)
    return
  }

  const { worktreePath, ticket, codebaseMap } = loadTicketDirContext(context)
  const paths = getTicketPaths(ticketId)
  const ticketDir = paths?.ticketDir
  const ticketState: TicketState = {
    ticketId: context.externalId,
    title: context.title,
    description: ticket?.description ?? '',
    codebaseMap,
  }

  if (ticketDir) {
    const interviewPath = resolve(ticketDir, 'interview.yaml')
    const prdPath = resolve(ticketDir, 'prd.yaml')
    const beadsPath = paths?.beadsPath

    if (existsSync(interviewPath)) {
      try { ticketState.interview = readFileSync(interviewPath, 'utf-8') } catch { /* ignore */ }
    }
    if (existsSync(prdPath)) {
      try { ticketState.prd = readFileSync(prdPath, 'utf-8') } catch { /* ignore */ }
    }
    if (existsSync(beadsPath)) {
      try { ticketState.beads = readFileSync(beadsPath, 'utf-8') } catch { /* ignore */ }
    }
  }

  const finalTestContext = buildMinimalContext('final_test', ticketState)
  const finalTestModelId = context.lockedMainImplementer
  if (!finalTestModelId) {
    throw new Error('No locked main implementer is configured for final tests')
  }
  const streamStates = new Map<string, OpenCodeStreamState>()
  const output = await generateFinalTests(
    adapter,
    finalTestContext,
    worktreePath,
    signal,
    {
      ticketId,
      model: finalTestModelId,
      onSessionCreated: (sessionId) => {
        emitAiMilestone(
          ticketId,
          context.externalId,
          'RUNNING_FINAL_TEST',
          `Final test session created for ${finalTestModelId} (session=${sessionId}).`,
          `${sessionId}:final-test-created`,
          {
            modelId: finalTestModelId,
            sessionId,
            source: `model:${finalTestModelId}`,
          },
        )
      },
      onOpenCodeStreamEvent: ({ sessionId, event }) => {
        const streamState = streamStates.get(sessionId) ?? createOpenCodeStreamState()
        streamStates.set(sessionId, streamState)
        emitOpenCodeStreamEvent(
          ticketId,
          context.externalId,
          'RUNNING_FINAL_TEST',
          finalTestModelId,
          sessionId,
          event,
          streamState,
        )
      },
      onPromptDispatched: ({ event }) => {
        emitOpenCodePromptLog(
          ticketId,
          context.externalId,
          'RUNNING_FINAL_TEST',
          finalTestModelId,
          event,
        )
      },
    },
  )
  throwIfAborted(signal, ticketId)

  const commandPlan = parseFinalTestCommands(output)
  const executionSettings = resolveExecutionRuntimeSettings(context)
  const report = commandPlan.commands.length > 0
    ? await executeFinalTestCommands({
        commands: commandPlan.commands,
        cwd: worktreePath,
        timeoutMs: executionSettings.perIterationTimeoutMs,
        plannedBy: finalTestModelId!,
        ...(commandPlan.summary ? { summary: commandPlan.summary } : {}),
        modelOutput: output,
      })
    : {
        status: 'failed' as const,
        passed: false,
        checkedAt: new Date().toISOString(),
        plannedBy: finalTestModelId,
        modelOutput: output,
        commands: [],
        errors: commandPlan.errors,
      }

  insertPhaseArtifact(ticketId, {
    phase: 'RUNNING_FINAL_TEST',
    artifactType: 'final_test_report',
    content: JSON.stringify(report),
  })
  emitPhaseLog(
    ticketId,
    context.externalId,
    'RUNNING_FINAL_TEST',
    'test_result',
    report.passed
      ? `Final test commands passed (${report.commands.length} command${report.commands.length === 1 ? '' : 's'}).`
      : `Final test commands failed: ${report.errors.join('; ') || 'no commands were executed'}`,
    {
    audience: 'all',
    kind: 'test',
    op: 'append',
    source: `model:${finalTestModelId}`,
    modelId: finalTestModelId,
    streaming: false,
    },
  )
  if (report.passed) {
    emitPhaseLog(ticketId, context.externalId, 'RUNNING_FINAL_TEST', 'info', `Final tests passed (${report.commands.length} command${report.commands.length === 1 ? '' : 's'}).`)
    sendEvent({ type: 'TESTS_PASSED' })
    return
  }

  emitPhaseLog(ticketId, context.externalId, 'RUNNING_FINAL_TEST', 'error', 'Final tests failed.', {
    errors: report.errors,
  })
  sendEvent({ type: 'TESTS_FAILED' })
}

async function handleIntegration(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
) {
  if (isMockOpenCodeMode()) {
    await handleMockExecutionUnsupported(ticketId, context, 'INTEGRATING_CHANGES', sendEvent)
    return
  }

  const paths = getTicketPaths(ticketId)
  if (!paths) {
    throw new Error(`Ticket workspace not initialized: missing ticket paths for ${context.externalId}`)
  }

  const squash = prepareSquashCandidate(
    paths.worktreePath,
    paths.baseBranch,
    context.title,
    context.externalId,
  )

  const report = {
    status: squash.success ? 'passed' : 'failed',
    completedAt: new Date().toISOString(),
    baseBranch: paths.baseBranch,
    preSquashHead: squash.preSquashHead ?? null,
    candidateCommitSha: squash.commitHash ?? null,
    mergeBase: squash.mergeBase ?? null,
    commitCount: squash.commitCount ?? null,
    message: squash.success
      ? 'Integration phase completed. Manual verification is required before cleanup.'
      : squash.message,
  }
  insertPhaseArtifact(ticketId, {
    phase: 'INTEGRATING_CHANGES',
    artifactType: 'integration_report',
    content: JSON.stringify(report),
  })

  if (!squash.success) {
    emitPhaseLog(ticketId, context.externalId, 'INTEGRATING_CHANGES', 'error', `Integration failed: ${squash.message}`)
    throw new Error(squash.message)
  }

  emitPhaseLog(
    ticketId,
    context.externalId,
    'INTEGRATING_CHANGES',
    'info',
    `Integration phase completed. Candidate commit ${report.candidateCommitSha} is ready on ${context.externalId}.`,
  )
  sendEvent({ type: 'INTEGRATION_DONE' })
}

async function handleCleanup(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
) {
  if (isMockOpenCodeMode()) {
    await handleMockExecutionUnsupported(ticketId, context, 'CLEANING_ENV', sendEvent)
    return
  }

  const report = cleanupTicketResources(ticketId)
  insertPhaseArtifact(ticketId, {
    phase: 'CLEANING_ENV',
    artifactType: 'cleanup_report',
    content: JSON.stringify(report),
  })
  emitPhaseLog(ticketId, context.externalId, 'CLEANING_ENV', 'info', 'Cleanup phase completed.')
  sendEvent({ type: 'CLEANUP_DONE' })
}

async function handleMockLifecycleState(
  ticketId: string,
  context: TicketContext,
  state: string,
  sendEvent: (event: TicketEvent) => void,
) {
  switch (state) {
    case 'COUNCIL_DELIBERATING':
      await handleMockCouncilDeliberate(ticketId, context, sendEvent)
      return
    case 'COUNCIL_VOTING_INTERVIEW':
      await handleMockInterviewVote(ticketId, context, sendEvent)
      return
    case 'COMPILING_INTERVIEW':
      await handleMockInterviewCompile(ticketId, context, sendEvent)
      return
    case 'WAITING_INTERVIEW_ANSWERS':
      if (!interviewQASessions.has(ticketId)) {
        await handleMockInterviewQAStart(ticketId, context)
      }
      return
    case 'VERIFYING_INTERVIEW_COVERAGE':
      await handleMockCoverage(ticketId, context, 'interview', sendEvent)
      return
    case 'DRAFTING_PRD':
      await handleMockPrdDraft(ticketId, context, sendEvent)
      return
    case 'COUNCIL_VOTING_PRD':
      await handleMockPrdVote(ticketId, context, sendEvent)
      return
    case 'REFINING_PRD':
      await handleMockPrdRefine(ticketId, context, sendEvent)
      return
    case 'VERIFYING_PRD_COVERAGE':
      await handleMockCoverage(ticketId, context, 'prd', sendEvent)
      return
    case 'DRAFTING_BEADS':
      await handleMockBeadsDraft(ticketId, context, sendEvent)
      return
    case 'COUNCIL_VOTING_BEADS':
      await handleMockBeadsVote(ticketId, context, sendEvent)
      return
    case 'REFINING_BEADS':
      await handleMockBeadsRefine(ticketId, context, sendEvent)
      return
    case 'VERIFYING_BEADS_COVERAGE':
      await handleMockCoverage(ticketId, context, 'beads', sendEvent)
      return
    case 'PRE_FLIGHT_CHECK':
      await handleMockExecutionUnsupported(ticketId, context, 'PRE_FLIGHT_CHECK', sendEvent)
      return
    case 'CODING':
      await handleMockExecutionUnsupported(ticketId, context, 'CODING', sendEvent)
      return
    case 'RUNNING_FINAL_TEST':
      await handleMockExecutionUnsupported(ticketId, context, 'RUNNING_FINAL_TEST', sendEvent)
      return
    case 'INTEGRATING_CHANGES':
      await handleMockExecutionUnsupported(ticketId, context, 'INTEGRATING_CHANGES', sendEvent)
      return
    case 'CLEANING_ENV':
      await handleMockExecutionUnsupported(ticketId, context, 'CLEANING_ENV', sendEvent)
      return
  }
}

export function attachWorkflowRunner(
  ticketId: string,
  actor: ReturnType<typeof createActor<typeof ticketMachine>>,
  sendEvent: (event: TicketEvent) => void,
) {
  actor.subscribe((snapshot) => {
    const state =
      typeof snapshot.value === 'string' ? snapshot.value : JSON.stringify(snapshot.value)
    const context = snapshot.context
    const key = `${ticketId}:${state}`

    // When the ticket reaches CANCELED, abort all running work
    if (state === 'CANCELED') {
      cancelTicket(ticketId)
      return
    }

    if (runningPhases.has(key)) return

    const signal = getOrCreateAbortSignal(ticketId)

    if (isMockOpenCodeMode()) {
      const mockHandledStates = new Set([
        'COUNCIL_DELIBERATING',
        'COUNCIL_VOTING_INTERVIEW',
        'COMPILING_INTERVIEW',
        'WAITING_INTERVIEW_ANSWERS',
        'VERIFYING_INTERVIEW_COVERAGE',
        'DRAFTING_PRD',
        'COUNCIL_VOTING_PRD',
        'REFINING_PRD',
        'VERIFYING_PRD_COVERAGE',
        'DRAFTING_BEADS',
        'COUNCIL_VOTING_BEADS',
        'REFINING_BEADS',
        'VERIFYING_BEADS_COVERAGE',
        'PRE_FLIGHT_CHECK',
        'CODING',
        'RUNNING_FINAL_TEST',
        'INTEGRATING_CHANGES',
        'CLEANING_ENV',
      ])

      if (mockHandledStates.has(state)) {
        runningPhases.add(key)
        handleMockLifecycleState(ticketId, context, state, sendEvent)
          .catch((err: unknown) => {
            if (err instanceof CancelledError) return
            const errMsg = err instanceof Error ? err.message : String(err)
            console.error(`[runner] ${state} failed for ticket ${context.externalId}: ${errMsg}`)
            emitPhaseLog(ticketId, context.externalId, state, 'error', errMsg)
            sendEvent({ type: 'ERROR', message: errMsg, codes: ['MOCK_LIFECYCLE_FAILED'] })
          })
          .finally(() => {
            runningPhases.delete(key)
          })
        return
      }
    }

    if (state === 'COUNCIL_DELIBERATING') {
      runningPhases.add(key)
      handleInterviewDeliberate(ticketId, context, sendEvent, signal)
        .catch(err => {
          if (err instanceof CancelledError) return
          const errMsg = err instanceof Error ? err.message : String(err)
          const isOpenCode = errMsg.includes('OpenCode server is not running')
          const isWorkspace = errMsg.includes('Ticket workspace not initialized')
          const codes = isOpenCode
            ? ['OPENCODE_UNREACHABLE']
            : isWorkspace
              ? ['WORKSPACE_NOT_INITIALIZED']
              : ['QUORUM_NOT_MET']
          console.error(`[runner] COUNCIL_DELIBERATING failed for ticket ${context.externalId}: ${errMsg}`)
          emitPhaseLog(ticketId, context.externalId, 'COUNCIL_DELIBERATING', 'error', errMsg)
          sendEvent({ type: 'ERROR', message: errMsg, codes })
        })
        .finally(() => {
          runningPhases.delete(key)
        })
    } else if (state === 'COUNCIL_VOTING_INTERVIEW') {
      if (phaseIntermediate.has(`${ticketId}:interview`) || tryRecoverPhaseIntermediate(ticketId, context, 'interview', false)) {
        runningPhases.add(key)
        handleInterviewVote(ticketId, context, sendEvent, signal)
          .catch(err => {
            if (err instanceof CancelledError) return
            const errMsg = err instanceof Error ? err.message : String(err)
            console.error(`[runner] COUNCIL_VOTING_INTERVIEW failed for ticket ${context.externalId}: ${errMsg}`)
            emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_INTERVIEW', 'error', errMsg)
            sendEvent({ type: 'ERROR', message: errMsg, codes: ['QUORUM_NOT_MET'] })
          })
          .finally(() => {
            runningPhases.delete(key)
          })
      } else {
        sendEvent({ type: 'ERROR', message: 'Council data lost after restart. Retry to re-run deliberation.', codes: ['INTERMEDIATE_DATA_LOST'] })
      }
    } else if (state === 'COMPILING_INTERVIEW') {
      if (phaseIntermediate.has(`${ticketId}:interview`) || tryRecoverPhaseIntermediate(ticketId, context, 'interview', true)) {
        runningPhases.add(key)
        handleInterviewCompile(ticketId, context, sendEvent, signal)
          .catch(err => {
            if (err instanceof CancelledError) return
            const errMsg = err instanceof Error ? err.message : String(err)
            console.error(`[runner] COMPILING_INTERVIEW failed for ticket ${context.externalId}: ${errMsg}`)
            emitPhaseLog(ticketId, context.externalId, 'COMPILING_INTERVIEW', 'error', errMsg)
            sendEvent({ type: 'ERROR', message: errMsg })
          })
          .finally(() => {
            runningPhases.delete(key)
          })
      } else {
        sendEvent({ type: 'ERROR', message: 'Council data lost after restart. Retry to re-run deliberation.', codes: ['INTERMEDIATE_DATA_LOST'] })
      }
    } else if (state === 'WAITING_INTERVIEW_ANSWERS') {
      // Start PROM4 session if not already running
      const qaInitKey = `${ticketId}:interview_qa_init`
      if (!interviewQASessions.has(ticketId) && !runningPhases.has(qaInitKey)) {
        runningPhases.add(qaInitKey)
        handleInterviewQAStart(ticketId, context, sendEvent, signal)
          .catch(err => {
            if (err instanceof CancelledError) return
            const errMsg = err instanceof Error ? err.message : String(err)
            console.error(`[runner] Interview QA start failed for ticket ${context.externalId}: ${errMsg}`)
            emitPhaseLog(ticketId, context.externalId, 'WAITING_INTERVIEW_ANSWERS', 'error', errMsg)
            sendEvent({ type: 'ERROR', message: errMsg, codes: ['PROM4_INIT_FAILED'] })
          })
          .finally(() => {
            runningPhases.delete(qaInitKey)
          })
      }
    } else if (state === 'VERIFYING_INTERVIEW_COVERAGE') {
      runningPhases.add(key)
      handleCoverageVerification(ticketId, context, sendEvent, 'interview', signal)
        .catch(err => {
          if (err instanceof CancelledError) return
          const errMsg = err instanceof Error ? err.message : String(err)
          console.error(`[runner] VERIFYING_INTERVIEW_COVERAGE failed for ticket ${context.externalId}: ${errMsg}`)
          emitPhaseLog(ticketId, context.externalId, 'VERIFYING_INTERVIEW_COVERAGE', 'error', errMsg)
          sendEvent({ type: 'ERROR', message: errMsg, codes: ['COVERAGE_FAILED'] })
        })
        .finally(() => {
          runningPhases.delete(key)
        })
    } else if (state === 'DRAFTING_PRD') {
      runningPhases.add(key)
      handlePrdDraft(ticketId, context, sendEvent, signal)
        .catch(err => {
          if (err instanceof CancelledError) return
          const errMsg = err instanceof Error ? err.message : String(err)
          console.error(`[runner] DRAFTING_PRD failed for ticket ${context.externalId}: ${errMsg}`)
          emitPhaseLog(ticketId, context.externalId, 'DRAFTING_PRD', 'error', errMsg)
          sendEvent({ type: 'ERROR', message: errMsg, codes: ['QUORUM_NOT_MET'] })
        })
        .finally(() => {
          runningPhases.delete(key)
        })
    } else if (state === 'COUNCIL_VOTING_PRD') {
      if (phaseIntermediate.has(`${ticketId}:prd`) || tryRecoverPhaseIntermediate(ticketId, context, 'prd', false)) {
        runningPhases.add(key)
        handlePrdVote(ticketId, context, sendEvent, signal)
          .catch(err => {
            if (err instanceof CancelledError) return
            const errMsg = err instanceof Error ? err.message : String(err)
            console.error(`[runner] COUNCIL_VOTING_PRD failed for ticket ${context.externalId}: ${errMsg}`)
            emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_PRD', 'error', errMsg)
            sendEvent({ type: 'ERROR', message: errMsg, codes: ['QUORUM_NOT_MET'] })
          })
          .finally(() => {
            runningPhases.delete(key)
          })
      } else {
        sendEvent({ type: 'ERROR', message: 'Council data lost after restart. Retry to re-run PRD drafting.', codes: ['INTERMEDIATE_DATA_LOST'] })
      }
    } else if (state === 'REFINING_PRD') {
      if (phaseIntermediate.has(`${ticketId}:prd`) || tryRecoverPhaseIntermediate(ticketId, context, 'prd', true)) {
        runningPhases.add(key)
        handlePrdRefine(ticketId, context, sendEvent, signal)
          .catch(err => {
            if (err instanceof CancelledError) return
            const errMsg = err instanceof Error ? err.message : String(err)
            console.error(`[runner] REFINING_PRD failed for ticket ${context.externalId}: ${errMsg}`)
            emitPhaseLog(ticketId, context.externalId, 'REFINING_PRD', 'error', errMsg)
            sendEvent({ type: 'ERROR', message: errMsg })
          })
          .finally(() => {
            runningPhases.delete(key)
          })
      } else {
        sendEvent({ type: 'ERROR', message: 'Council data lost after restart. Retry to re-run PRD drafting.', codes: ['INTERMEDIATE_DATA_LOST'] })
      }
    } else if (state === 'VERIFYING_PRD_COVERAGE') {
      runningPhases.add(key)
      handleCoverageVerification(ticketId, context, sendEvent, 'prd', signal)
        .catch(err => {
          if (err instanceof CancelledError) return
          const errMsg = err instanceof Error ? err.message : String(err)
          console.error(`[runner] VERIFYING_PRD_COVERAGE failed for ticket ${context.externalId}: ${errMsg}`)
          emitPhaseLog(ticketId, context.externalId, 'VERIFYING_PRD_COVERAGE', 'error', errMsg)
          sendEvent({ type: 'ERROR', message: errMsg, codes: ['COVERAGE_FAILED'] })
        })
        .finally(() => {
          runningPhases.delete(key)
        })
    } else if (state === 'DRAFTING_BEADS') {
      runningPhases.add(key)
      handleBeadsDraft(ticketId, context, sendEvent, signal)
        .catch(err => {
          if (err instanceof CancelledError) return
          const errMsg = err instanceof Error ? err.message : String(err)
          console.error(`[runner] DRAFTING_BEADS failed for ticket ${context.externalId}: ${errMsg}`)
          emitPhaseLog(ticketId, context.externalId, 'DRAFTING_BEADS', 'error', errMsg)
          sendEvent({ type: 'ERROR', message: errMsg, codes: ['QUORUM_NOT_MET'] })
        })
        .finally(() => {
          runningPhases.delete(key)
        })
    } else if (state === 'COUNCIL_VOTING_BEADS') {
      if (phaseIntermediate.has(`${ticketId}:beads`) || tryRecoverPhaseIntermediate(ticketId, context, 'beads', false)) {
        runningPhases.add(key)
        handleBeadsVote(ticketId, context, sendEvent, signal)
          .catch(err => {
            if (err instanceof CancelledError) return
            const errMsg = err instanceof Error ? err.message : String(err)
            console.error(`[runner] COUNCIL_VOTING_BEADS failed for ticket ${context.externalId}: ${errMsg}`)
            emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_BEADS', 'error', errMsg)
            sendEvent({ type: 'ERROR', message: errMsg, codes: ['QUORUM_NOT_MET'] })
          })
          .finally(() => {
            runningPhases.delete(key)
          })
      } else {
        sendEvent({ type: 'ERROR', message: 'Council data lost after restart. Retry to re-run beads drafting.', codes: ['INTERMEDIATE_DATA_LOST'] })
      }
    } else if (state === 'REFINING_BEADS') {
      if (phaseIntermediate.has(`${ticketId}:beads`) || tryRecoverPhaseIntermediate(ticketId, context, 'beads', true)) {
        runningPhases.add(key)
        handleBeadsRefine(ticketId, context, sendEvent, signal)
          .catch(err => {
            if (err instanceof CancelledError) return
            const errMsg = err instanceof Error ? err.message : String(err)
            console.error(`[runner] REFINING_BEADS failed for ticket ${context.externalId}: ${errMsg}`)
            emitPhaseLog(ticketId, context.externalId, 'REFINING_BEADS', 'error', errMsg)
            sendEvent({ type: 'ERROR', message: errMsg })
          })
          .finally(() => {
            runningPhases.delete(key)
          })
      } else {
        sendEvent({ type: 'ERROR', message: 'Council data lost after restart. Retry to re-run beads drafting.', codes: ['INTERMEDIATE_DATA_LOST'] })
      }
    } else if (state === 'VERIFYING_BEADS_COVERAGE') {
      runningPhases.add(key)
      handleCoverageVerification(ticketId, context, sendEvent, 'beads', signal)
        .catch(err => {
          if (err instanceof CancelledError) return
          const errMsg = err instanceof Error ? err.message : String(err)
          console.error(`[runner] VERIFYING_BEADS_COVERAGE failed for ticket ${context.externalId}: ${errMsg}`)
          emitPhaseLog(ticketId, context.externalId, 'VERIFYING_BEADS_COVERAGE', 'error', errMsg)
          sendEvent({ type: 'ERROR', message: errMsg, codes: ['COVERAGE_FAILED'] })
        })
        .finally(() => {
          runningPhases.delete(key)
        })
    } else if (state === 'PRE_FLIGHT_CHECK') {
      runningPhases.add(key)
      handlePreFlight(ticketId, context, sendEvent, signal)
        .catch(err => {
          if (err instanceof CancelledError) return
          const errMsg = err instanceof Error ? err.message : String(err)
          console.error(`[runner] PRE_FLIGHT_CHECK failed for ticket ${context.externalId}: ${errMsg}`)
          emitPhaseLog(ticketId, context.externalId, 'PRE_FLIGHT_CHECK', 'error', errMsg)
          sendEvent({ type: 'ERROR', message: errMsg, codes: ['PREFLIGHT_FAILED'] })
        })
        .finally(() => {
          runningPhases.delete(key)
        })
    } else if (state === 'CODING') {
      runningPhases.add(key)
      handleCoding(ticketId, context, sendEvent, signal)
        .catch(err => {
          if (err instanceof CancelledError) return
          const errMsg = err instanceof Error ? err.message : String(err)
          console.error(`[runner] CODING failed for ticket ${context.externalId}: ${errMsg}`)
          emitPhaseLog(ticketId, context.externalId, 'CODING', 'error', errMsg)
          sendEvent({ type: 'ERROR', message: errMsg, codes: ['CODING_FAILED'] })
        })
        .finally(() => {
          runningPhases.delete(key)
        })
    } else if (state === 'RUNNING_FINAL_TEST') {
      runningPhases.add(key)
      handleFinalTest(ticketId, context, sendEvent, signal)
        .catch(err => {
          if (err instanceof CancelledError) return
          const errMsg = err instanceof Error ? err.message : String(err)
          console.error(`[runner] RUNNING_FINAL_TEST failed for ticket ${context.externalId}: ${errMsg}`)
          emitPhaseLog(ticketId, context.externalId, 'RUNNING_FINAL_TEST', 'error', errMsg)
          sendEvent({ type: 'ERROR', message: errMsg, codes: ['TESTS_FAILED'] })
        })
        .finally(() => {
          runningPhases.delete(key)
        })
    } else if (state === 'INTEGRATING_CHANGES') {
      runningPhases.add(key)
      handleIntegration(ticketId, context, sendEvent)
        .catch(err => {
          if (err instanceof CancelledError) return
          const errMsg = err instanceof Error ? err.message : String(err)
          console.error(`[runner] INTEGRATING_CHANGES failed for ticket ${context.externalId}: ${errMsg}`)
          emitPhaseLog(ticketId, context.externalId, 'INTEGRATING_CHANGES', 'error', errMsg)
          sendEvent({ type: 'ERROR', message: errMsg, codes: ['INTEGRATION_FAILED'] })
        })
        .finally(() => {
          runningPhases.delete(key)
        })
    } else if (state === 'CLEANING_ENV') {
      runningPhases.add(key)
      handleCleanup(ticketId, context, sendEvent)
        .catch(err => {
          if (err instanceof CancelledError) return
          const errMsg = err instanceof Error ? err.message : String(err)
          console.error(`[runner] CLEANING_ENV failed for ticket ${context.externalId}: ${errMsg}`)
          emitPhaseLog(ticketId, context.externalId, 'CLEANING_ENV', 'error', errMsg)
          sendEvent({ type: 'ERROR', message: errMsg, codes: ['CLEANUP_FAILED'] })
        })
        .finally(() => {
          runningPhases.delete(key)
        })
    }
  })
}
