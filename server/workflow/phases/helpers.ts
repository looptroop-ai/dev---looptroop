import { broadcaster } from '../../sse/broadcaster'
import { appendLogEvent } from '../../log/executionLog'
import type { LogEventType, LogSource } from '../../log/types'
import { buildMinimalContext, type TicketState } from '../../opencode/contextBuilder'
import type { Message, PromptPart, StreamEvent } from '../../opencode/types'
import { PROM5, PROM13, PROM24 } from '../../prompts/index'
import type { DraftPhaseResult, DraftProgressEvent, DraftResult, MemberOutcome, Vote, VotePresentationOrder } from '../../council/types'
import { parseCouncilMembers } from '../../council/members'
import { db as appDb } from '../../db/index'
import { profiles } from '../../db/schema'
import { PROFILE_DEFAULTS } from '../../db/defaults'
import type { TicketContext } from '../../machines/types'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import {
  getLatestPhaseArtifact,
  getTicketContext as getStoredTicketContext,
  getTicketPaths,
  upsertLatestPhaseArtifact,
} from '../../storage/tickets'
import { buildPrdContextBuilder } from '../../phases/prd/draft'
import { buildBeadsContextBuilder } from '../../phases/beads/draft'
import { formatInterviewQuestionPreview, parseInterviewQuestions } from '../../phases/interview/questions'
import type { OpenCodePromptDispatchEvent } from '../runOpenCodePrompt'
import { buildSessionStatusLogEntries } from '../sessionStatusLogging'
import {
  type StructuredOutputMetadata,
} from '../../structuredOutput'
import type { StructuredLogFields, StructuredLogAudience, StructuredLogKind, StructuredLogOp, OpenCodeStreamState, PhaseIntermediateData } from './types'
import { phaseIntermediate } from './state'

export function emitPhaseLog(
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

export function emitDebugLog(
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

export function stringifyForLog(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function createOpenCodeStreamState(): OpenCodeStreamState {
  return { seenFirstActivity: false, liveKinds: new Map(), liveContents: new Map() }
}

export function formatToolState(event: Extract<StreamEvent, { type: 'tool' }>): string {
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

export function emitStructuredPhaseLog(
  ticketId: string,
  ticketExternalId: string,
  phase: string,
  type: LogEventType,
  content: string,
  fields: StructuredLogFields,
) {
  emitPhaseLog(ticketId, ticketExternalId, phase, type, content, fields)
}

export function emitAiMilestone(
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

export function emitAiDetail(
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

export function emitOpenCodePromptLog(
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

export function finalizeOpenCodeParts(
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

export function emitOpenCodeStreamEvent(
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

export function extractOpenCodeMessageLines(messages: Message[]): string[] {
  const lines: string[] = []

  for (const message of messages) {
    const directRole = message.role
    const directContent = message.content
    const directTimestamp = message.timestamp

    if (directContent) {
      lines.push(`[${directRole ?? 'message'}]${directTimestamp ? ` [${directTimestamp}]` : ''} ${directContent}`)
      continue
    }

    const info = message.info ?? null
    const role = info && typeof info.sender === 'string'
      ? info.sender
      : info && typeof info.role === 'string'
        ? info.role
        : info && typeof info.author === 'string'
          ? info.author
          : 'message'
    const timestamp = info && typeof info.timestamp === 'string' ? info.timestamp : undefined

    const parts = message.parts ?? []
    if (parts.length === 0) {
      lines.push(`[${role}]${timestamp ? ` [${timestamp}]` : ''} ${stringifyForLog(message)}`)
      continue
    }

    for (const part of parts) {
      const partType = part.type ?? 'part'
      const text = 'text' in part && typeof part.text === 'string'
        ? part.text
        : 'content' in part && typeof part.content === 'string'
          ? part.content
          : 'output' in part && typeof part.output === 'string'
            ? part.output
            : 'value' in part && typeof part.value === 'string'
              ? part.value
              : stringifyForLog(part)

      lines.push(`[${role}/${partType}]${timestamp ? ` [${timestamp}]` : ''} ${text}`)
    }
  }

  return lines
}

export function emitOpenCodeSessionLogs(
  ticketId: string,
  ticketExternalId: string,
  phase: string,
  memberId: string,
  sessionId: string,
  stage: 'draft' | 'vote' | 'refine' | 'coverage' | 'relevant_files_scan',
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

export function mapCouncilStageToStatus(
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

export function formatCouncilMemberRoster(members: Array<{ modelId: string; name: string }>): string {
  return members.map(member => member.modelId).join(', ')
}

export function describeCouncilMemberSource(source: 'locked_ticket' | 'profile'): string {
  if (source === 'locked_ticket') return 'locked ticket config'
  return 'profile config'
}

export function formatCouncilResolutionLog(
  context: TicketContext,
  council: {
    members: Array<{ modelId: string; name: string }>
    source: 'locked_ticket' | 'profile'
  },
): string {
  const implementer = context.lockedMainImplementer ?? 'not configured'
  return `Council members resolved from ${describeCouncilMemberSource(council.source)}: ${council.members.length} members (${formatCouncilMemberRoster(council.members)}). Main implementer: ${implementer}.`
}

export function resolveInterviewDraftSettings(context: TicketContext): {
  maxInitialQuestions: number
  coverageFollowUpBudgetPercent: number
  draftTimeoutMs: number
  minQuorum: number
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
  }
}

export function resolveCoverageRuntimeSettings(context: TicketContext): {
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

export function getCoverageStateLabel(phase: 'interview' | 'prd' | 'beads'): string {
  return phase === 'interview'
    ? 'VERIFYING_INTERVIEW_COVERAGE'
    : phase === 'prd'
      ? 'VERIFYING_PRD_COVERAGE'
      : 'VERIFYING_BEADS_COVERAGE'
}

export function getCoverageContextPhase(phase: 'interview' | 'prd' | 'beads'): 'interview_coverage' | 'prd_coverage' | 'beads_coverage' {
  return phase === 'interview'
    ? 'interview_coverage'
    : phase === 'prd'
      ? 'prd_coverage'
      : 'beads_coverage'
}

export function getCoveragePromptTemplate(phase: 'interview' | 'prd' | 'beads') {
  return phase === 'interview' ? PROM5 : phase === 'prd' ? PROM13 : PROM24
}

export function describeCoverageTerminationReason(reason: string): string {
  if (reason === 'coverage_pass_limit_reached') return 'retry cap reached'
  if (reason === 'follow_up_budget_exhausted') return 'follow-up budget exhausted'
  if (reason === 'follow_up_generation_failed') return 'follow-up generation failed'
  return 'manual review required'
}

export function buildCoveragePromptConfiguration(input: {
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

export function resolveCouncilRuntimeSettings(context: TicketContext): {
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

export function resolveExecutionRuntimeSettings(context: TicketContext): {
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

export function formatDurationMs(durationMs: number): string {
  if (durationMs >= 60000) return `${(durationMs / 60000).toFixed(1)}m`
  if (durationMs >= 1000) return `${(durationMs / 1000).toFixed(1)}s`
  return `${durationMs}ms`
}

export function formatDraftRoundSummary(
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

export function summarizeDraftOutcomes(drafts: DraftResult[]) {
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

export function emitDraftProgressInfoLog(
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

export function createPendingDrafts(members: Array<{ modelId: string }>): DraftResult[] {
  return members.map(member => ({
    memberId: member.modelId,
    content: '',
    outcome: 'pending',
    duration: 0,
  }))
}

export function tryBuildInterviewQuestionPreview(label: string, content?: string): string | null {
  if (!content?.trim()) return null

  try {
    const questions = parseInterviewQuestions(content, { allowTopLevelArray: true })
    if (questions.length === 0) return null
    return formatInterviewQuestionPreview(label, questions)
  } catch {
    return null
  }
}

export function upsertCouncilDraftArtifact(
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

export function upsertCouncilVoteArtifact(
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

export function collectMembersByOutcome(
  memberOutcomes: Record<string, MemberOutcome>,
  outcome: MemberOutcome,
) {
  return Object.entries(memberOutcomes)
    .filter(([, memberOutcome]) => memberOutcome === outcome)
    .map(([memberId]) => memberId)
}

export function emitCouncilDecisionLogs(
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

export function resolveCouncilMembers(context: TicketContext): {
  members: Array<{ modelId: string; name: string; variant?: string }>
  source: 'locked_ticket' | 'profile'
} {
  let members: Array<{ modelId: string; name: string; variant?: string }> = []
  let source: 'locked_ticket' | 'profile' = 'profile'

  const variantMap: Record<string, string> = context.lockedCouncilMemberVariants
    ? (typeof context.lockedCouncilMemberVariants === 'string'
      ? JSON.parse(context.lockedCouncilMemberVariants as string)
      : context.lockedCouncilMemberVariants as Record<string, string>)
    : {}

  if (context.lockedCouncilMembers && context.lockedCouncilMembers.length > 0) {
    members = context.lockedCouncilMembers
      .map(id => ({ modelId: id, name: id.split('/').pop() ?? id, variant: variantMap[id] }))
    source = 'locked_ticket'
  } else {
    const profile = appDb.select().from(profiles).get()
    const configuredMembers = parseCouncilMembers(profile?.councilMembers)
    const profileVariants: Record<string, string> = profile?.councilMemberVariants
      ? (typeof profile.councilMemberVariants === 'string'
        ? JSON.parse(profile.councilMemberVariants)
        : profile.councilMemberVariants as Record<string, string>)
      : {}
    if (configuredMembers.length > 0) {
      members = configuredMembers
        .map(id => ({ modelId: id, name: id.split('/').pop() ?? id, variant: profileVariants[id] }))
      source = 'profile'
    }
  }

  if (members.length === 0) {
    throw new Error('No valid council members are configured for this ticket')
  }
  return { members, source }
}

export function loadTicketDirContext(context: TicketContext) {
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

  const relevantFilesPath = resolve(ticketDir, 'relevant-files.yaml')
  let relevantFiles: string | undefined
  if (existsSync(relevantFilesPath)) {
    try { relevantFiles = readFileSync(relevantFilesPath, 'utf-8') } catch { /* ignore */ }
  }

  return { worktreePath, ticket: ticket.localTicket, ticketDir, relevantFiles }
}

export function buildStructuredMetadata(
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

/**
 * Attempt to recover phaseIntermediate data from persisted artifacts after a
 * server restart. Returns true if the data was recovered (or already present).
 */
export function tryRecoverPhaseIntermediate(
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

    const { worktreePath, ticket, ticketDir, relevantFiles } = loadTicketDirContext(context)

    let contextBuilder: PhaseIntermediateData['contextBuilder']
    let baseTicketState: TicketState | undefined
    if (pipeline === 'interview') {
      const ticketState: TicketState = {
        ticketId: context.externalId,
        title: context.title,
        description: ticket?.description ?? '',
        relevantFiles,
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
        relevantFiles,
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
        relevantFiles,
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
