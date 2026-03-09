import { createActor } from 'xstate'
import { ticketMachine } from '../machines/ticketMachine'
import type { TicketContext, TicketEvent } from '../machines/types'
import { db as appDb } from '../db/index'
import { profiles } from '../db/schema'
import { broadcaster } from '../sse/broadcaster'
import { deliberateInterview, buildInterviewContextBuilder } from '../phases/interview/deliberate'
import { draftPRD, buildPrdContextBuilder } from '../phases/prd/draft'
import { draftBeads, buildBeadsContextBuilder } from '../phases/beads/draft'
import { expandBeads } from '../phases/beads/expand'
import type { Bead, BeadSubset } from '../phases/beads/types'
import { executeBead } from '../phases/execution/executor'
import { getNextBead, isAllComplete } from '../phases/execution/scheduler'
import type { CouncilResult, DraftProgressEvent, DraftResult, Vote } from '../council/types'
import { CancelledError } from '../council/types'
import { ensureMinimumCouncilMembers, parseCouncilMembers } from '../council/members'
import { conductVoting, selectWinner } from '../council/voter'
import { refineDraft } from '../council/refiner'
import { appendLogEvent } from '../log/executionLog'
import type { LogEventType, LogSource } from '../log/types'
import { buildMinimalContext, type TicketState } from '../opencode/contextBuilder'
import type { Message, StreamEvent } from '../opencode/types'
import { buildPromptFromTemplate, PROM5, PROM13, PROM24 } from '../prompts/index'
import { startInterviewSession, submitBatchToSession, type BatchResponse } from '../phases/interview/qa'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
// @ts-expect-error no type declarations for js-yaml
import jsYaml from 'js-yaml'
import { safeAtomicWrite } from '../io/atomicWrite'
import { readJsonl, writeJsonl } from '../io/jsonl'
import { getOpenCodeAdapter, isMockOpenCodeMode } from '../opencode/factory'
import {
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
import { runOpenCodePrompt } from './runOpenCodePrompt'
import { generateFinalTests } from '../phases/finalTest/generator'

const runningPhases = new Set<string>()
const phaseResults = new Map<string, CouncilResult>()
const adapter = getOpenCodeAdapter()
const ticketAbortControllers = new Map<string, AbortController>()
const interviewQASessions = new Map<string, { sessionId: string; winnerId: string }>()

/** Intermediate data stored between draft→vote→refine state machine phases. */
interface PhaseIntermediateData {
  drafts: DraftResult[]
  memberOutcomes: Record<string, import('../council/types').MemberOutcome>
  contextBuilder: (step: 'vote' | 'refine') => import('../opencode/types').PromptPart[]
  worktreePath: string
  phase: string
  votes?: Vote[]
  winnerId?: string
}
const phaseIntermediate = new Map<string, PhaseIntermediateData>()

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
  broadcaster.broadcast(ticketId, 'log', {
    ticketId,
    phase,
    type,
    content,
    ...data,
  })
  appendLogEvent(ticketId, type, phase, content, data, source as LogSource | undefined, phase, structuredExtra)
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
  })
  appendLogEvent(ticketId, 'debug', phase, content, debugData, 'debug', phase, {
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
type StructuredLogKind = 'milestone' | 'reasoning' | 'text' | 'tool' | 'step' | 'session' | 'error' | 'test'
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
    emitAiDetail(
      ticketId,
      ticketExternalId,
      phase,
      'info',
      `Session status: ${event.status}.`,
      {
        entryId: `${sessionId}:status`,
        audience: 'ai',
        kind: 'session',
        op: event.status === 'idle' ? 'finalize' : 'upsert',
        source,
        modelId: memberId || undefined,
        sessionId,
        streaming: event.status !== 'idle',
      },
    )
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

function describeCouncilMemberSource(source: 'locked_ticket' | 'profile' | 'default'): string {
  if (source === 'locked_ticket') return 'locked ticket config'
  if (source === 'profile') return 'profile config'
  return 'default fallback'
}

function formatCouncilResolutionLog(
  context: TicketContext,
  council: {
    members: Array<{ modelId: string; name: string }>
    source: 'locked_ticket' | 'profile' | 'default'
  },
): string {
  const implementer = context.lockedMainImplementer ?? 'not configured'
  return `Council members resolved from ${describeCouncilMemberSource(council.source)}: ${council.members.length} members (${formatCouncilMemberRoster(council.members)}). Main implementer: ${implementer}.`
}

function resolveInterviewDraftSettings(context: TicketContext): {
  maxInitialQuestions: number
  draftTimeoutMs: number
  minQuorum: number
} {
  const storedContext = getStoredTicketContext(context.ticketId)
  const profile = appDb.select().from(profiles).get()

  const maxInitialQuestions = storedContext?.localProject.interviewQuestions
    ?? profile?.interviewQuestions
    ?? 50
  const draftTimeoutMs = storedContext?.localProject.councilResponseTimeout
    ?? profile?.councilResponseTimeout
    ?? 900000
  const minQuorum = storedContext?.localProject.minCouncilQuorum
    ?? profile?.minCouncilQuorum
    ?? 2

  return {
    maxInitialQuestions,
    draftTimeoutMs,
    minQuorum,
  }
}

function formatDurationMs(durationMs: number): string {
  if (durationMs >= 60000) return `${(durationMs / 60000).toFixed(1)}m`
  if (durationMs >= 1000) return `${(durationMs / 1000).toFixed(1)}s`
  return `${durationMs}ms`
}

function summarizeDraftOutcomes(drafts: DraftResult[]) {
  return drafts.reduce(
    (summary, draft) => {
      if (draft.outcome === 'completed') summary.completed++
      else if (draft.outcome === 'timed_out') summary.timedOut++
      else summary.invalidOutput++
      return summary
    },
    { completed: 0, timedOut: 0, invalidOutput: 0 },
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
      : `failed (${entry.error ?? 'invalid output'})`
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
  if (signal.aborted) throw new CancelledError(ticketId)
  try {
    const health = await adapter.checkHealth()
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
  const result = await deliberateInterview(
    adapter,
    members,
    ticketContext,
    worktreePath,
    draftSettings,
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
      emitDraftProgressInfoLog(ticketId, context.externalId, phase, 'Interview', entry)
    },
  )

  const draftSummary = summarizeDraftOutcomes(result.drafts)
  emitPhaseLog(
    ticketId,
    context.externalId,
    phase,
    'info',
    `Interview draft round completed in ${formatDurationMs(Date.now() - startedAt)}: completed=${draftSummary.completed}, timed_out=${draftSummary.timedOut}, invalid_output=${draftSummary.invalidOutput}.`,
  )

  // Store intermediate data for vote/refine steps
  const contextBuilder = buildInterviewContextBuilder(ticketContext)
  phaseIntermediate.set(`${ticketId}:interview`, {
    drafts: result.drafts,
    memberOutcomes: result.memberOutcomes,
    contextBuilder,
    worktreePath,
    phase: result.phase,
  })

  for (const draft of result.drafts) {
    const detail = draft.outcome === 'timed_out'
      ? 'timed out'
      : draft.outcome === 'invalid_output'
        ? `invalid output${draft.error ? ` (${draft.error})` : ''}`
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

  insertPhaseArtifact(ticketId, {
    phase,
    artifactType: 'interview_drafts',
    content: JSON.stringify(result),
  })
  emitPhaseLog(
    ticketId,
    context.externalId,
    phase,
    'info',
    `Saved interview draft artifact and cached ${Object.keys(result.memberOutcomes).length} member outcomes for voting.`,
  )

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
  const voteContext = intermediate.contextBuilder('vote')
  const streamStates = new Map<string, OpenCodeStreamState>()

  emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_INTERVIEW', 'info',
    `Interview voting started with ${members.length} council members on ${intermediate.drafts.filter(d => d.outcome === 'completed').length} drafts.`)

  if (signal.aborted) throw new CancelledError(ticketId)
  const votes = await conductVoting(
    adapter,
    members,
    intermediate.drafts,
    voteContext,
    intermediate.worktreePath,
    intermediate.phase,
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
  )

  const { winnerId, totalScore } = selectWinner(votes, members)

  // Store vote results for refine step
  intermediate.votes = votes
  intermediate.winnerId = winnerId

  insertPhaseArtifact(ticketId, {
    phase: 'COUNCIL_VOTING_INTERVIEW',
    artifactType: 'interview_votes',
    content: JSON.stringify({ votes, winnerId, totalScore }),
  })
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
  const refineContext = intermediate.contextBuilder('refine')
  const streamStates = new Map<string, OpenCodeStreamState>()

  emitPhaseLog(ticketId, context.externalId, 'COMPILING_INTERVIEW', 'info',
    `Interview refinement started. Winner: ${intermediate.winnerId}, incorporating ideas from ${losingDrafts.length} alternative drafts.`)

  if (signal.aborted) throw new CancelledError(ticketId)
  const refinedContent = await refineDraft(
    adapter,
    winnerDraft,
    losingDrafts,
    refineContext,
    intermediate.worktreePath,
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
  )

  // Clean up intermediate data
  phaseIntermediate.delete(`${ticketId}:interview`)

  // Parse YAML questions from refined content into structured list
  let parsedQuestions: unknown[] = []
  try {
    const yamlParsed = jsYaml.load(refinedContent) as Record<string, unknown> | unknown[] | null
    if (Array.isArray(yamlParsed)) {
      parsedQuestions = yamlParsed
    } else if (yamlParsed && typeof yamlParsed === 'object' && 'questions' in yamlParsed && Array.isArray((yamlParsed as Record<string, unknown>).questions)) {
      parsedQuestions = (yamlParsed as Record<string, unknown>).questions as unknown[]
    }
  } catch {
    // If YAML parsing fails, fall back to raw content (questions will be empty array)
    console.warn(`[runner] Failed to parse YAML questions from refined content for ticket ${context.externalId}`)
  }

  insertPhaseArtifact(ticketId, {
    phase: 'COMPILING_INTERVIEW',
    artifactType: 'interview_compiled',
    content: JSON.stringify({
      winnerId: intermediate.winnerId,
      refinedContent,
      questions: parsedQuestions,
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
    `Compiled final interview from winner ${intermediate.winnerId}. Parsed ${parsedQuestions.length} structured questions.`,
  )
  sendEvent({ type: 'READY' })
  broadcaster.broadcast(ticketId, 'needs_input', {
    ticketId,
    type: 'interview_questions',
    context: { questions: refinedContent, parsedQuestions, winnerId: intermediate.winnerId },
  })
}

// --- Helper: resolve council members from context (shared by PRD/Beads draft handlers) ---
function resolveCouncilMembers(context: TicketContext): {
  members: Array<{ modelId: string; name: string }>
  source: 'locked_ticket' | 'profile' | 'default'
} {
  let members: Array<{ modelId: string; name: string }> = []
  let source: 'locked_ticket' | 'profile' | 'default' = 'default'

  if (context.lockedCouncilMembers && context.lockedCouncilMembers.length > 0) {
    members = ensureMinimumCouncilMembers(context.lockedCouncilMembers)
      .map(id => ({ modelId: id, name: id.split('/').pop() ?? id }))
    source = 'locked_ticket'
  } else {
    const profile = appDb.select().from(profiles).get()
    const configuredMembers = parseCouncilMembers(profile?.councilMembers)
    if (configuredMembers.length > 0) {
      members = ensureMinimumCouncilMembers(configuredMembers)
        .map(id => ({ modelId: id, name: id.split('/').pop() ?? id }))
      source = 'profile'
    }
  }

  if (members.length === 0) {
    members = ensureMinimumCouncilMembers([])
      .map(id => ({ modelId: id, name: id.split('/').pop() ?? id }))
    source = 'default'
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
  emitPhaseLog(ticketId, context.externalId, phase, 'info', `Dispatching PRD draft requests to ${members.length} council members.`)

  if (signal.aborted) throw new CancelledError(ticketId)
  const startedAt = Date.now()
  const streamStates = new Map<string, OpenCodeStreamState>()
  const result = await draftPRD(
    adapter,
    members,
    ticketContext,
    worktreePath,
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
      emitDraftProgressInfoLog(ticketId, context.externalId, phase, 'PRD', entry)
    },
  )

  const draftSummary = summarizeDraftOutcomes(result.drafts)
  emitPhaseLog(
    ticketId,
    context.externalId,
    phase,
    'info',
    `PRD draft round completed in ${formatDurationMs(Date.now() - startedAt)}: completed=${draftSummary.completed}, timed_out=${draftSummary.timedOut}, invalid_output=${draftSummary.invalidOutput}.`,
  )

  phaseIntermediate.set(`${ticketId}:prd`, {
    drafts: result.drafts,
    memberOutcomes: result.memberOutcomes,
    contextBuilder: buildPrdContextBuilder(ticketContext),
    worktreePath,
    phase: result.phase,
  })

  for (const draft of result.drafts) {
    const detail = draft.outcome === 'timed_out'
      ? 'timed out'
      : draft.outcome === 'invalid_output'
        ? 'invalid output'
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

  insertPhaseArtifact(ticketId, {
    phase,
    artifactType: 'prd_drafts',
    content: JSON.stringify(result),
  })
  emitPhaseLog(
    ticketId,
    context.externalId,
    phase,
    'info',
    `Saved PRD draft artifact and cached ${Object.keys(result.memberOutcomes).length} member outcomes for voting.`,
  )

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
  const voteContext = intermediate.contextBuilder('vote')
  const streamStates = new Map<string, OpenCodeStreamState>()

  emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_PRD', 'info',
    `PRD voting started with ${members.length} council members on ${intermediate.drafts.filter(d => d.outcome === 'completed').length} drafts.`)

  if (signal.aborted) throw new CancelledError(ticketId)
  const votes = await conductVoting(
    adapter,
    members,
    intermediate.drafts,
    voteContext,
    intermediate.worktreePath,
    intermediate.phase,
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
  )

  const { winnerId, totalScore } = selectWinner(votes, members)

  intermediate.votes = votes
  intermediate.winnerId = winnerId

  insertPhaseArtifact(ticketId, {
    phase: 'COUNCIL_VOTING_PRD',
    artifactType: 'prd_votes',
    content: JSON.stringify({ votes, winnerId, totalScore }),
  })
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
  const refineContext = intermediate.contextBuilder('refine')
  const streamStates = new Map<string, OpenCodeStreamState>()

  emitPhaseLog(ticketId, context.externalId, 'REFINING_PRD', 'info',
    `PRD refinement started. Winner: ${intermediate.winnerId}, incorporating ideas from ${losingDrafts.length} alternative drafts.`)

  if (signal.aborted) throw new CancelledError(ticketId)
  const refinedContent = await refineDraft(
    adapter,
    winnerDraft,
    losingDrafts,
    refineContext,
    intermediate.worktreePath,
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
  )

  // Clean up intermediate data
  phaseIntermediate.delete(`${ticketId}:prd`)

  const paths = getTicketPaths(ticketId)
  if (!paths) {
    throw new Error(`Ticket workspace not initialized: missing ticket paths for ${context.externalId}`)
  }
  const ticketDir = paths.ticketDir
  const prdPath = resolve(ticketDir, 'prd.yaml')

  insertPhaseArtifact(ticketId, {
    phase: 'REFINING_PRD',
    artifactType: 'prd_refined',
    content: JSON.stringify({
      winnerId: intermediate.winnerId,
      refinedContent,
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
  emitPhaseLog(ticketId, context.externalId, phase, 'info', `Dispatching beads draft requests to ${members.length} council members.`)

  if (signal.aborted) throw new CancelledError(ticketId)
  const startedAt = Date.now()
  const streamStates = new Map<string, OpenCodeStreamState>()
  const result = await draftBeads(
    adapter,
    members,
    ticketContext,
    worktreePath,
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
      emitDraftProgressInfoLog(ticketId, context.externalId, phase, 'Beads', entry)
    },
  )

  const draftSummary = summarizeDraftOutcomes(result.drafts)
  emitPhaseLog(
    ticketId,
    context.externalId,
    phase,
    'info',
    `Beads draft round completed in ${formatDurationMs(Date.now() - startedAt)}: completed=${draftSummary.completed}, timed_out=${draftSummary.timedOut}, invalid_output=${draftSummary.invalidOutput}.`,
  )

  phaseIntermediate.set(`${ticketId}:beads`, {
    drafts: result.drafts,
    memberOutcomes: result.memberOutcomes,
    contextBuilder: buildBeadsContextBuilder(ticketContext),
    worktreePath,
    phase: result.phase,
  })

  for (const draft of result.drafts) {
    const detail = draft.outcome === 'timed_out'
      ? 'timed out'
      : draft.outcome === 'invalid_output'
        ? 'invalid output'
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

  insertPhaseArtifact(ticketId, {
    phase,
    artifactType: 'beads_drafts',
    content: JSON.stringify(result),
  })
  emitPhaseLog(
    ticketId,
    context.externalId,
    phase,
    'info',
    `Saved beads draft artifact and cached ${Object.keys(result.memberOutcomes).length} member outcomes for voting.`,
  )

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
  const voteContext = intermediate.contextBuilder('vote')
  const streamStates = new Map<string, OpenCodeStreamState>()

  emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_BEADS', 'info',
    `Beads voting started with ${members.length} council members on ${intermediate.drafts.filter(d => d.outcome === 'completed').length} drafts.`)

  if (signal.aborted) throw new CancelledError(ticketId)
  const votes = await conductVoting(
    adapter,
    members,
    intermediate.drafts,
    voteContext,
    intermediate.worktreePath,
    intermediate.phase,
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
  )

  const { winnerId, totalScore } = selectWinner(votes, members)

  intermediate.votes = votes
  intermediate.winnerId = winnerId

  insertPhaseArtifact(ticketId, {
    phase: 'COUNCIL_VOTING_BEADS',
    artifactType: 'beads_votes',
    content: JSON.stringify({ votes, winnerId, totalScore }),
  })
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
  const refineContext = intermediate.contextBuilder('refine')
  const streamStates = new Map<string, OpenCodeStreamState>()

  emitPhaseLog(ticketId, context.externalId, 'REFINING_BEADS', 'info',
    `Beads refinement started. Winner: ${intermediate.winnerId}, incorporating ideas from ${losingDrafts.length} alternative drafts.`)

  if (signal.aborted) throw new CancelledError(ticketId)
  const refinedContent = await refineDraft(
    adapter,
    winnerDraft,
    losingDrafts,
    refineContext,
    intermediate.worktreePath,
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
  )

  // Clean up intermediate data
  phaseIntermediate.delete(`${ticketId}:beads`)

  const paths = getTicketPaths(ticketId)
  if (!paths) {
    throw new Error(`Ticket workspace not initialized: missing ticket paths for ${context.externalId}`)
  }
  const ticketDir = paths.ticketDir
  const beadsPath = resolve(ticketDir, 'beads', 'main', '.beads', 'issues.jsonl')

  // Parse refined content as bead subsets and expand to full beads
  let beadSubsets: BeadSubset[] = []
  try {
    beadSubsets = JSON.parse(refinedContent) as BeadSubset[]
  } catch {
    // If refinedContent is not valid JSON array, wrap as single-item
    beadSubsets = [{ id: 'bead-1', title: 'Main task', prdRefs: [], description: refinedContent, contextGuidance: '', acceptanceCriteria: [], tests: [], testCommands: [] }]
  }

  const expandedBeads = expandBeads(beadSubsets)

  insertPhaseArtifact(ticketId, {
    phase: 'REFINING_BEADS',
    artifactType: 'beads_refined',
    content: JSON.stringify({
      winnerId: intermediate.winnerId,
      refinedContent,
      expandedBeads,
    }),
  })

  // Save expanded beads to disk as JSONL
  writeJsonl(beadsPath, expandedBeads)

  emitPhaseLog(ticketId, context.externalId, 'REFINING_BEADS', 'info',
    `Refined and expanded ${expandedBeads.length} beads from winner ${intermediate.winnerId}. Saved to ${beadsPath}.`)

  sendEvent({ type: 'REFINED' })

  emitStateChange(ticketId, context.externalId, 'REFINING_BEADS', 'VERIFYING_BEADS_COVERAGE')
}

/**
 * Build interview.yaml content per PROM5 output_file schema.
 * Merges parsed questions from refinedContent with user answers.
 */
function buildInterviewYaml(
  ticketId: string,
  winnerId: string,
  refinedContent: string,
  userAnswersJson?: string,
): string {
  const now = new Date().toISOString()

  // Parse questions from the refined YAML content
  interface ParsedQuestion {
    id?: string
    prompt?: string
    question?: string
    answer_type?: string
    options?: unknown[]
  }
  let parsedQuestions: ParsedQuestion[] = []
  try {
    const yamlParsed = jsYaml.load(refinedContent) as Record<string, unknown> | unknown[] | null
    if (Array.isArray(yamlParsed)) {
      parsedQuestions = yamlParsed as ParsedQuestion[]
    } else if (yamlParsed && typeof yamlParsed === 'object' && 'questions' in yamlParsed && Array.isArray((yamlParsed as Record<string, unknown>).questions)) {
      parsedQuestions = (yamlParsed as Record<string, unknown>).questions as ParsedQuestion[]
    }
  } catch { /* use empty array */ }

  // Fallback to text parsing if YAML parsing found no questions
  if (parsedQuestions.length === 0 && refinedContent) {
    let qIndex = 1
    for (const line of refinedContent.split('\n')) {
      const trimmed = line.trim()
      if (/^\d+[.)]\s/.test(trimmed) || /^[-*]\s/.test(trimmed) || /^\*\*Q\d/i.test(trimmed) || trimmed.endsWith('?')) {
        const q = trimmed.replace(/^[-*\d.)]+\s*/, '').replace(/^\*\*/, '').replace(/\*\*$/, '')
        if (q.length > 5) {
          parsedQuestions.push({
            id: `Q${qIndex++}`,
            prompt: q,
            answer_type: 'free_text',
            options: []
          })
        }
      }
    }
  }

  // Parse user answers
  let userAnswers: Record<string, string> = {}
  if (userAnswersJson) {
    try { userAnswers = JSON.parse(userAnswersJson) as Record<string, string> } catch { /* ignore */ }
  }

  // Build structured questions with answers merged in
  const questions = parsedQuestions.map((q, idx) => {
    const qId = q.id ?? `Q${idx + 1}`
    const promptText = q.prompt ?? q.question ?? ''
    const answerText = userAnswers[qId] ?? userAnswers[promptText] ?? ''
    const skipped = !answerText
    return {
      id: qId,
      prompt: promptText,
      answer_type: q.answer_type ?? 'free_text',
      options: q.options ?? [],
      answer: {
        skipped,
        selected_option_ids: [],
        free_text: answerText,
        answered_by: skipped ? 'ai_skip' : 'user',
        answered_at: skipped ? '' : now,
      },
    }
  })

  const interviewData = {
    schema_version: 1,
    ticket_id: ticketId,
    artifact: 'interview',
    status: 'draft',
    generated_by: {
      winner_model: winnerId,
      generated_at: now,
    },
    questions,
    follow_up_rounds: [],
    summary: {
      goals: [],
      constraints: [],
      non_goals: [],
    },
    approval: {
      approved_by: '',
      approved_at: '',
    },
  }

  return jsYaml.dump(interviewData, { lineWidth: 120, noRefs: true }) as string
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

  const stateLabel = phase === 'interview'
    ? 'VERIFYING_INTERVIEW_COVERAGE'
    : phase === 'prd'
      ? 'VERIFYING_PRD_COVERAGE'
      : 'VERIFYING_BEADS_COVERAGE'

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
    `Coverage verification started using winning model: ${winnerId}`,
  )

  // Select the appropriate prompt template and context phase
  const promptTemplate = phase === 'interview' ? PROM5 : phase === 'prd' ? PROM13 : PROM24
  const contextPhase = phase === 'interview'
    ? 'interview_coverage'
    : phase === 'prd'
      ? 'prd_coverage'
      : 'beads_coverage'

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

  const ticketState: TicketState = {
    ticketId: context.externalId,
    title: context.title,
    description: ticket?.description ?? '',
    codebaseMap,
    interview: refinedContent,
  }

  const interviewUiState = getLatestPhaseArtifact(ticketId, 'ui_state:interview_qa', 'UI_STATE')

  if (interviewUiState) {
    try {
      const parsed = JSON.parse(interviewUiState.content) as {
        data?: { answers?: Record<string, string> }
      }
      const answers = parsed?.data?.answers
      if (answers && typeof answers === 'object') {
        ticketState.userAnswers = JSON.stringify(answers)
      }
    } catch {
      // Ignore malformed UI state payload and proceed with available context.
    }
  }

  // Load additional artifacts from disk for PRD/beads coverage phases
  if (phase === 'prd' || phase === 'beads') {
    const prdPath = resolve(ticketDir, 'prd.yaml')
    if (existsSync(prdPath)) {
      try { ticketState.prd = readFileSync(prdPath, 'utf-8') } catch { /* ignore */ }
    }
  }
  if (phase === 'beads') {
    const beadsPath = resolve(ticketDir, 'beads', 'main', '.beads', 'issues.jsonl')
    if (existsSync(beadsPath)) {
      try { ticketState.beads = readFileSync(beadsPath, 'utf-8') } catch { /* ignore */ }
    }
  }

  const coverageContext = buildMinimalContext(contextPhase, ticketState)
  const promptContent = buildPromptFromTemplate(
    promptTemplate,
    coverageContext,
  )

  // Use a single session for the winning model only (not all council members)
  if (signal.aborted) throw new CancelledError(ticketId)
  const streamState = createOpenCodeStreamState()
  let sessionId = ''
  const runResult = await runOpenCodePrompt({
    adapter,
    projectPath: worktreePath,
    parts: [{ type: 'text', content: promptContent }],
    signal,
    model: winnerId,
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
  })
  const response = runResult.response
  const coverageMessages = runResult.messages

  emitOpenCodeSessionLogs(
    ticketId,
    context.externalId,
    stateLabel,
    winnerId,
    runResult.session.id,
    'coverage',
    response,
    coverageMessages,
  )

  // Store the coverage input artifact so the UI can display Q&A / doc being verified
  const coverageInputContent = phase === 'interview'
    ? JSON.stringify({ refinedContent, userAnswers: ticketState.userAnswers })
    : phase === 'prd'
      ? JSON.stringify({ prd: ticketState.prd, refinedContent })
      : JSON.stringify({ beads: ticketState.beads, refinedContent })
  insertPhaseArtifact(ticketId, {
    phase: stateLabel,
    artifactType: `${phase}_coverage_input`,
    content: coverageInputContent,
  })

  // Parse response: detect gaps vs clean coverage
  // Strategy: try YAML structured fields first, then explicit markers, then heuristic
  let detectedGaps = false
  try {
    const parsed = jsYaml.load(response) as Record<string, unknown> | null
    if (parsed && typeof parsed === 'object') {
      // Structured YAML: check for gaps field or status field
      if (Array.isArray(parsed.gaps)) {
        detectedGaps = parsed.gaps.length > 0
      } else if (typeof parsed.status === 'string') {
        const s = parsed.status.toLowerCase()
        detectedGaps = !(s === 'clean' || s === 'pass' || s === 'complete')
      } else if (parsed.follow_up_questions && Array.isArray(parsed.follow_up_questions)) {
        detectedGaps = (parsed.follow_up_questions as unknown[]).length > 0
      }
    }
  } catch {
    // Not valid YAML — fall through to marker-based detection
    const lowerResponse = response.toLowerCase()

    // Explicit markers (highest confidence)
    if (lowerResponse.includes('coverage_complete') || lowerResponse.includes('coverage_pass')) {
      detectedGaps = false
    } else if (lowerResponse.includes('coverage_fail') || lowerResponse.includes('coverage_gaps')) {
      detectedGaps = true
    } else {
      // Heuristic: check for follow-up questions being generated (not just mentioned)
      const hasFollowUpQuestions = /follow-up questions?:\s*\n\s*[-\d]/.test(lowerResponse)
        || /additional questions?\s*(needed|required|to ask)/i.test(response)
      detectedGaps = hasFollowUpQuestions
      // When ambiguous, default to clean (retry loop via GAPS_FOUND handles false negatives)
    }
  }

  // Store the coverage result artifact
  insertPhaseArtifact(ticketId, {
    phase: stateLabel,
    artifactType: `${phase}_coverage`,
    content: JSON.stringify({ winnerId, response, hasGaps: detectedGaps }),
  })

  if (detectedGaps) {
    emitPhaseLog(ticketId, context.externalId, stateLabel, 'info',
      `Coverage gaps detected by winning model ${winnerId}. Looping back for refinement.`)
    sendEvent({ type: 'GAPS_FOUND' })
  } else {
    // Generate interview.yaml when interview coverage passes (PROM5 output_file schema)
    if (phase === 'interview') {
      try {
        const interviewYaml = buildInterviewYaml(
          context.externalId,
          winnerId,
          refinedContent ?? '',
          ticketState.userAnswers,
        )
        const interviewPath = resolve(ticketDir, 'interview.yaml')
        safeAtomicWrite(interviewPath, interviewYaml)
        emitPhaseLog(ticketId, context.externalId, stateLabel, 'info',
          `Generated interview.yaml at ${interviewPath}`)
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
  const { worktreePath, ticket, codebaseMap } = loadTicketDirContext(context)

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

  // Load compiled questions
  const compiledArtifact = getLatestPhaseArtifact(ticketId, 'interview_compiled')

  let compiledQuestions = ''
  let maxQuestions = 50
  if (compiledArtifact) {
    try {
      const parsed = JSON.parse(compiledArtifact.content) as { refinedContent?: string; questions?: unknown[] }
      compiledQuestions = parsed.refinedContent ?? ''
      if (parsed.questions && Array.isArray(parsed.questions)) {
        maxQuestions = parsed.questions.length
      }
    } catch { /* ignore */ }
  }

  const ticketState: TicketState = {
    ticketId: context.externalId,
    title: context.title,
    description: ticket?.description ?? '',
    codebaseMap,
    interview: compiledQuestions,
  }

  emitPhaseLog(ticketId, context.externalId, 'WAITING_INTERVIEW_ANSWERS', 'info',
    `Starting PROM4 interview session with winning model: ${winnerId}`)

  if (signal.aborted) throw new CancelledError(ticketId)
  const streamState = createOpenCodeStreamState()

  const { sessionId, firstBatch } = await startInterviewSession(
    adapter,
    worktreePath,
    winnerId,
    compiledQuestions,
    ticketState,
    maxQuestions,
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
  )

  // Store session info
  interviewQASessions.set(ticketId, { sessionId, winnerId })
  insertPhaseArtifact(ticketId, {
    phase: 'WAITING_INTERVIEW_ANSWERS',
    artifactType: 'interview_qa_session',
    content: JSON.stringify({ sessionId, winnerId }),
  })

  // Store current batch
  upsertLatestPhaseArtifact(ticketId, 'interview_current_batch', 'WAITING_INTERVIEW_ANSWERS', JSON.stringify(firstBatch))

  emitPhaseLog(ticketId, context.externalId, 'WAITING_INTERVIEW_ANSWERS', 'info',
    `PROM4 session started (session=${sessionId}). First batch: ${firstBatch.questions.length} questions.`)
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
    batch: firstBatch,
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
  if (isMockOpenCodeMode()) {
    const ticket = getTicketByRef(ticketId)
    const compiledArtifact = getLatestPhaseArtifact(ticketId, 'interview_compiled')
    const refinedContent = compiledArtifact
      ? (() => {
          try {
            return (JSON.parse(compiledArtifact.content) as { refinedContent?: string }).refinedContent ?? ''
          } catch {
            return ''
          }
        })()
      : ''

    const finalYaml = buildInterviewYaml(
      ticket?.externalId ?? ticketId,
      'mock-model-1',
      refinedContent,
      JSON.stringify(batchAnswers),
    )

    return {
      questions: [],
      progress: { current: 1, total: 1 },
      isComplete: true,
      isFinalFreeForm: false,
      aiCommentary: 'Mock interview complete.',
      finalYaml,
      batchNumber: 1,
    }
  }

  // Get session info from memory or reload from DB
  let sessionInfo = interviewQASessions.get(ticketId)
  if (!sessionInfo) {
    const artifact = getLatestPhaseArtifact(ticketId, 'interview_qa_session')
    if (artifact) {
      try {
        sessionInfo = JSON.parse(artifact.content) as { sessionId: string; winnerId: string }
        interviewQASessions.set(ticketId, sessionInfo)
      } catch { /* ignore */ }
    }
  }

  if (!sessionInfo) {
    throw new Error('No active PROM4 session for this ticket')
  }

  const ticket = getTicketByRef(ticketId)
  const externalId = ticket?.externalId ?? ticketId

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
  )

  // Accumulate answers in batch history
  const existingHistory = getLatestPhaseArtifact(ticketId, 'interview_batch_history')

  let history: Array<{ batchNumber: number; answers: Record<string, string> }> = []
  if (existingHistory) {
    try { history = JSON.parse(existingHistory.content) as typeof history } catch { /* ignore */ }
  }
  history.push({ batchNumber: result.batchNumber, answers: batchAnswers })

  // Upsert history
  upsertLatestPhaseArtifact(ticketId, 'interview_batch_history', 'WAITING_INTERVIEW_ANSWERS', JSON.stringify(history))

  if (result.isComplete && result.finalYaml) {
    // Write final interview YAML to disk
    const paths = getTicketPaths(ticketId)
    if (!paths) {
      throw new Error(`Ticket workspace not initialized: missing ticket paths for ${externalId}`)
    }
    const ticketDir = paths.ticketDir
    const interviewPath = resolve(ticketDir, 'interview.yaml')
    safeAtomicWrite(interviewPath, result.finalYaml)
    emitPhaseLog(ticketId, externalId, 'WAITING_INTERVIEW_ANSWERS', 'info',
      `PROM4 interview complete. Final YAML written to ${interviewPath}.`)
  } else {
    // Store next batch as current
    upsertLatestPhaseArtifact(ticketId, 'interview_current_batch', 'WAITING_INTERVIEW_ANSWERS', JSON.stringify(result))

    emitPhaseLog(ticketId, externalId, 'WAITING_INTERVIEW_ANSWERS', 'info',
      `PROM4 batch ${result.batchNumber}: ${result.questions.length} questions. Progress: ${result.progress.current}/${result.progress.total}.`)
  }

  return result
}

function buildMockInterviewQuestions() {
  return [
    {
      id: 'goal',
      phase: 'discovery',
      question: 'What is the primary outcome this ticket should deliver?',
      priority: 'critical',
      rationale: 'Clarifies the core success criteria.',
    },
    {
      id: 'constraints',
      phase: 'delivery',
      question: 'What implementation constraints or boundaries should the agent respect?',
      priority: 'high',
      rationale: 'Prevents invalid implementation choices.',
    },
    {
      id: 'verification',
      phase: 'validation',
      question: 'How should success be verified once implementation is complete?',
      priority: 'high',
      rationale: 'Defines acceptance and testing expectations.',
    },
  ] as const
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
  }, { lineWidth: 120, noRefs: true }) as string
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
  return resolve(paths.ticketDir, 'beads', 'main', '.beads', 'issues.jsonl')
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
  const refinedContent = buildMockInterviewCompiledContent()
  insertPhaseArtifact(ticketId, {
    phase: 'COUNCIL_DELIBERATING',
    artifactType: 'interview_drafts',
    content: JSON.stringify({
      phase: 'interview',
      drafts: [{ memberId: 'mock-model-1', content: refinedContent, outcome: 'completed', duration: 1 }],
      memberOutcomes: { 'mock-model-1': { outcome: 'completed' } },
    }),
  })
  emitPhaseLog(ticketId, context.externalId, 'COUNCIL_DELIBERATING', 'info', 'Mock interview drafting complete.')
  sendEvent({ type: 'QUESTIONS_READY', result: { winnerId: 'mock-model-1' } })
}

async function handleMockInterviewVote(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
) {
  insertPhaseArtifact(ticketId, {
    phase: 'COUNCIL_VOTING_INTERVIEW',
    artifactType: 'interview_votes',
    content: JSON.stringify({ winnerId: 'mock-model-1', totalScore: 1 }),
  })
  emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_INTERVIEW', 'info', 'Mock interview winner selected.')
  sendEvent({ type: 'WINNER_SELECTED', winner: 'mock-model-1' })
}

async function handleMockInterviewCompile(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
) {
  const refinedContent = buildMockInterviewCompiledContent()
  const questions = buildMockInterviewQuestions()
  insertPhaseArtifact(ticketId, {
    phase: 'COMPILING_INTERVIEW',
    artifactType: 'interview_compiled',
    content: JSON.stringify({ winnerId: 'mock-model-1', refinedContent, questions }),
  })
  insertPhaseArtifact(ticketId, {
    phase: 'COMPILING_INTERVIEW',
    artifactType: 'interview_winner',
    content: JSON.stringify({ winnerId: 'mock-model-1' }),
  })
  emitPhaseLog(ticketId, context.externalId, 'COMPILING_INTERVIEW', 'info', 'Mock interview compiled.')
  sendEvent({ type: 'READY' })
}

async function handleMockInterviewQAStart(
  ticketId: string,
  context: TicketContext,
) {
  const batch: BatchResponse = {
    questions: buildMockInterviewQuestions().map(({ id, question, phase, priority, rationale }) => ({
      id,
      question,
      phase,
      priority,
      rationale,
    })),
    progress: { current: 1, total: 1 },
    isComplete: false,
    isFinalFreeForm: false,
    aiCommentary: 'Mock interview batch ready.',
    batchNumber: 1,
  }

  interviewQASessions.set(ticketId, { sessionId: 'mock-session', winnerId: 'mock-model-1' })
  insertPhaseArtifact(ticketId, {
    phase: 'WAITING_INTERVIEW_ANSWERS',
    artifactType: 'interview_qa_session',
    content: JSON.stringify({ sessionId: 'mock-session', winnerId: 'mock-model-1' }),
  })
  upsertLatestPhaseArtifact(ticketId, 'interview_current_batch', 'WAITING_INTERVIEW_ANSWERS', JSON.stringify(batch))
  emitPhaseLog(ticketId, context.externalId, 'WAITING_INTERVIEW_ANSWERS', 'info', 'Mock interview questions ready for input.')
  broadcaster.broadcast(ticketId, 'needs_input', {
    ticketId,
    type: 'interview_batch',
    batch,
  })
}

async function handleMockCoverage(
  ticketId: string,
  context: TicketContext,
  phase: 'interview' | 'prd' | 'beads',
  sendEvent: (event: TicketEvent) => void,
) {
  const stateLabel = phase === 'interview'
    ? 'VERIFYING_INTERVIEW_COVERAGE'
    : phase === 'prd'
      ? 'VERIFYING_PRD_COVERAGE'
      : 'VERIFYING_BEADS_COVERAGE'

  insertPhaseArtifact(ticketId, {
    phase: stateLabel,
    artifactType: `${phase}_coverage`,
    content: JSON.stringify({ winnerId: 'mock-model-1', response: 'mock coverage clean', hasGaps: false }),
  })

  if (phase === 'interview') {
    const compiledArtifact = getLatestPhaseArtifact(ticketId, 'interview_compiled')
    const refinedContent = compiledArtifact
      ? (() => {
          try {
            return (JSON.parse(compiledArtifact.content) as { refinedContent?: string }).refinedContent ?? ''
          } catch {
            return ''
          }
        })()
      : ''
    const paths = getTicketPaths(ticketId)
    if (paths) {
      safeAtomicWrite(
        resolve(paths.ticketDir, 'interview.yaml'),
        buildInterviewYaml(context.externalId, 'mock-model-1', refinedContent),
      )
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
    content: JSON.stringify({ winnerId: 'mock-model-1', totalScore: 1 }),
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
    content: JSON.stringify({ winnerId: 'mock-model-1', totalScore: 1 }),
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
  writeJsonl(resolve(paths.ticketDir, 'beads', 'main', '.beads', 'issues.jsonl'), expandedBeads)
  patchTicket(ticketId, {
    totalBeads: expandedBeads.length,
    currentBead: 0,
    percentComplete: 0,
  })
  emitPhaseLog(ticketId, context.externalId, 'REFINING_BEADS', 'info', `Mock beads expanded to ${expandedBeads.length} tasks.`)
  sendEvent({ type: 'REFINED' })
}

async function handleMockPreFlight(ticketId: string, context: TicketContext, sendEvent: (event: TicketEvent) => void) {
  const paths = getTicketPaths(ticketId)
  if (!paths) throw new Error(`Ticket workspace not initialized: missing ticket paths for ${context.externalId}`)
  const beadsPath = resolve(paths.ticketDir, 'beads', 'main', '.beads', 'issues.jsonl')
  const beads = existsSync(beadsPath)
    ? readFileSync(beadsPath, 'utf-8').split('\n').filter(Boolean).map(line => JSON.parse(line))
    : []
  const report = await runPreFlightChecks(adapter, ticketId, beads)
  insertPhaseArtifact(ticketId, {
    phase: 'PRE_FLIGHT_CHECK',
    artifactType: 'preflight_report',
    content: JSON.stringify(report),
  })
  if (!report.passed) {
    sendEvent({ type: 'CHECKS_FAILED', errors: report.criticalFailures.map(check => check.message) })
    return
  }
  emitPhaseLog(ticketId, context.externalId, 'PRE_FLIGHT_CHECK', 'info', 'Mock pre-flight checks passed.')
  sendEvent({ type: 'CHECKS_PASSED' })
}

async function handleMockCoding(ticketId: string, context: TicketContext, sendEvent: (event: TicketEvent) => void) {
  const paths = getTicketPaths(ticketId)
  if (!paths) throw new Error(`Ticket workspace not initialized: missing ticket paths for ${context.externalId}`)
  const beads = readTicketBeads(ticketId).map((bead) => ({
    ...bead,
    status: 'completed' as const,
    updatedAt: new Date().toISOString(),
    iteration: Math.max(bead.iteration ?? 0, 1),
  }))
  writeTicketBeads(ticketId, beads)
  updateTicketProgressFromBeads(ticketId, beads)

  const mockOutputPath = resolve(paths.worktreePath, 'looptroop-mock-output.md')
  safeAtomicWrite(
    mockOutputPath,
    [
      `# ${context.externalId}`,
      '',
      `Mock execution completed for ${context.title}.`,
      '',
      'Completed beads:',
      ...beads.map(bead => `- ${bead.title}`),
    ].join('\n'),
  )

  emitPhaseLog(ticketId, context.externalId, 'CODING', 'info', `Mock coding completed ${beads.length} beads.`)
  sendEvent({ type: 'ALL_BEADS_DONE' })
}

async function handleMockFinalTest(ticketId: string, context: TicketContext, sendEvent: (event: TicketEvent) => void) {
  emitPhaseLog(ticketId, context.externalId, 'RUNNING_FINAL_TEST', 'info', 'Mock final tests passed.')
  sendEvent({ type: 'TESTS_PASSED' })
}

async function handleMockIntegration(ticketId: string, context: TicketContext, sendEvent: (event: TicketEvent) => void) {
  emitPhaseLog(ticketId, context.externalId, 'INTEGRATING_CHANGES', 'info', 'Mock integration completed.')
  sendEvent({ type: 'INTEGRATION_DONE' })
}

async function handleMockCleanup(ticketId: string, context: TicketContext, sendEvent: (event: TicketEvent) => void) {
  const report = cleanupTicketResources(ticketId)
  insertPhaseArtifact(ticketId, {
    phase: 'CLEANING_ENV',
    artifactType: 'cleanup_report',
    content: JSON.stringify(report),
  })
  emitPhaseLog(ticketId, context.externalId, 'CLEANING_ENV', 'info', 'Mock cleanup completed.')
  sendEvent({ type: 'CLEANUP_DONE' })
}

async function handlePreFlight(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
) {
  const beads = readTicketBeads(ticketId)
  const report = await runPreFlightChecks(adapter, ticketId, beads)
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
    await handleMockCoding(ticketId, context, sendEvent)
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
  const codingModelId = context.lockedMainImplementer ?? 'implementer'
  const streamStates = new Map<string, OpenCodeStreamState>()
  const result = await executeBead(
    adapter,
    nextBead,
    contextParts,
    paths.worktreePath,
    context.maxIterations,
    undefined,
    {
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
    },
  )

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
) {
  if (isMockOpenCodeMode()) {
    await handleMockFinalTest(ticketId, context, sendEvent)
    return
  }

  const { worktreePath, ticket, codebaseMap } = loadTicketDirContext(context)
  const ticketDir = getTicketPaths(ticketId)?.ticketDir
  const ticketState: TicketState = {
    ticketId: context.externalId,
    title: context.title,
    description: ticket?.description ?? '',
    codebaseMap,
  }

  if (ticketDir) {
    const interviewPath = resolve(ticketDir, 'interview.yaml')
    const prdPath = resolve(ticketDir, 'prd.yaml')
    const beadsPath = resolve(ticketDir, 'beads', 'main', '.beads', 'issues.jsonl')

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
  const finalTestModelId = context.lockedMainImplementer ?? 'implementer'
  const streamStates = new Map<string, OpenCodeStreamState>()
  const output = await generateFinalTests(
    adapter,
    finalTestContext,
    worktreePath,
    {
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
    },
  )

  const report = {
    passed: true,
    checkedAt: new Date().toISOString(),
    message: `Final test report generated by ${finalTestModelId}.`,
    output,
  }
  insertPhaseArtifact(ticketId, {
    phase: 'RUNNING_FINAL_TEST',
    artifactType: 'final_test_report',
    content: JSON.stringify(report),
  })
  emitPhaseLog(ticketId, context.externalId, 'RUNNING_FINAL_TEST', 'test_result', report.message, {
    audience: 'all',
    kind: 'test',
    op: 'append',
    source: `model:${finalTestModelId}`,
    modelId: finalTestModelId,
    streaming: false,
  })
  sendEvent({ type: 'TESTS_PASSED' })
}

async function handleIntegration(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
) {
  if (isMockOpenCodeMode()) {
    await handleMockIntegration(ticketId, context, sendEvent)
    return
  }

  insertPhaseArtifact(ticketId, {
    phase: 'INTEGRATING_CHANGES',
    artifactType: 'integration_report',
    content: JSON.stringify({
      completedAt: new Date().toISOString(),
      message: 'Integration phase completed. Manual verification is required before cleanup.',
    }),
  })
  emitPhaseLog(ticketId, context.externalId, 'INTEGRATING_CHANGES', 'info', 'Integration phase completed.')
  sendEvent({ type: 'INTEGRATION_DONE' })
}

async function handleCleanup(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
) {
  if (isMockOpenCodeMode()) {
    await handleMockCleanup(ticketId, context, sendEvent)
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
      await handleMockPreFlight(ticketId, context, sendEvent)
      return
    case 'CODING':
      await handleMockCoding(ticketId, context, sendEvent)
      return
    case 'RUNNING_FINAL_TEST':
      await handleMockFinalTest(ticketId, context, sendEvent)
      return
    case 'INTEGRATING_CHANGES':
      await handleMockIntegration(ticketId, context, sendEvent)
      return
    case 'CLEANING_ENV':
      await handleMockCleanup(ticketId, context, sendEvent)
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
      if (phaseIntermediate.has(`${ticketId}:interview`)) {
        runningPhases.add(key)
        handleInterviewVote(ticketId, context, sendEvent, signal)
          .catch(err => {
            if (err instanceof CancelledError) return
            const errMsg = err instanceof Error ? err.message : String(err)
            console.error(`[runner] COUNCIL_VOTING_INTERVIEW failed for ticket ${context.externalId}: ${errMsg}`)
            emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_INTERVIEW', 'error', errMsg)
            sendEvent({ type: 'ERROR', message: errMsg })
          })
          .finally(() => {
            runningPhases.delete(key)
          })
      }
    } else if (state === 'COMPILING_INTERVIEW') {
      if (phaseIntermediate.has(`${ticketId}:interview`)) {
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
      if (phaseIntermediate.has(`${ticketId}:prd`)) {
        runningPhases.add(key)
        handlePrdVote(ticketId, context, sendEvent, signal)
          .catch(err => {
            if (err instanceof CancelledError) return
            const errMsg = err instanceof Error ? err.message : String(err)
            console.error(`[runner] COUNCIL_VOTING_PRD failed for ticket ${context.externalId}: ${errMsg}`)
            emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_PRD', 'error', errMsg)
            sendEvent({ type: 'ERROR', message: errMsg })
          })
          .finally(() => {
            runningPhases.delete(key)
          })
      }
    } else if (state === 'REFINING_PRD') {
      if (phaseIntermediate.has(`${ticketId}:prd`)) {
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
      if (phaseIntermediate.has(`${ticketId}:beads`)) {
        runningPhases.add(key)
        handleBeadsVote(ticketId, context, sendEvent, signal)
          .catch(err => {
            if (err instanceof CancelledError) return
            const errMsg = err instanceof Error ? err.message : String(err)
            console.error(`[runner] COUNCIL_VOTING_BEADS failed for ticket ${context.externalId}: ${errMsg}`)
            emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_BEADS', 'error', errMsg)
            sendEvent({ type: 'ERROR', message: errMsg })
          })
          .finally(() => {
            runningPhases.delete(key)
          })
      }
    } else if (state === 'REFINING_BEADS') {
      if (phaseIntermediate.has(`${ticketId}:beads`)) {
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
      handlePreFlight(ticketId, context, sendEvent)
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
      handleCoding(ticketId, context, sendEvent)
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
      handleFinalTest(ticketId, context, sendEvent)
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
