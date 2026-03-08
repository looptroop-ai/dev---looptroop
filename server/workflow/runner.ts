import { createActor } from 'xstate'
import { ticketMachine } from '../machines/ticketMachine'
import type { TicketContext, TicketEvent } from '../machines/types'
import { db } from '../db/index'
import { profiles, tickets, phaseArtifacts } from '../db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { broadcaster } from '../sse/broadcaster'
import { deliberateInterview, buildInterviewContextBuilder } from '../phases/interview/deliberate'
import { draftPRD, buildPrdContextBuilder } from '../phases/prd/draft'
import { draftBeads, buildBeadsContextBuilder } from '../phases/beads/draft'
import { expandBeads } from '../phases/beads/expand'
import type { BeadSubset } from '../phases/beads/types'
import { OpenCodeSDKAdapter } from '../opencode/adapter'
import type { CouncilResult, DraftProgressEvent, DraftResult, Vote } from '../council/types'
import { CancelledError } from '../council/types'
import { conductVoting, selectWinner } from '../council/voter'
import { refineDraft } from '../council/refiner'
import { appendLogEvent } from '../log/executionLog'
import type { LogEventType } from '../log/types'
import { buildMinimalContext, type TicketState } from '../opencode/contextBuilder'
import type { Message } from '../opencode/types'
import { buildPromptFromTemplate, PROM5, PROM13, PROM24 } from '../prompts/index'
import { startInterviewSession, submitBatchToSession, type BatchResponse } from '../phases/interview/qa'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
// @ts-expect-error no type declarations for js-yaml
import jsYaml from 'js-yaml'
import { safeAtomicWrite } from '../io/atomicWrite'
import { writeJsonl } from '../io/jsonl'
import { getTicketDir, getTicketWorktreePath } from '../ticket/initialize'

const runningPhases = new Set<string>()
const phaseResults = new Map<string, CouncilResult>()
const adapter = new OpenCodeSDKAdapter()
const ticketAbortControllers = new Map<number, AbortController>()
const interviewQASessions = new Map<number, { sessionId: string; winnerId: string }>()

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
export function cancelTicket(ticketId: number) {
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

function getOrCreateAbortSignal(ticketId: number): AbortSignal {
  let controller = ticketAbortControllers.get(ticketId)
  if (!controller) {
    controller = new AbortController()
    ticketAbortControllers.set(ticketId, controller)
  }
  return controller.signal
}

function emitPhaseLog(
  ticketId: number,
  ticketExternalId: string,
  phase: string,
  type: LogEventType,
  content: string,
  data?: Record<string, unknown>,
) {
  broadcaster.broadcast(String(ticketId), 'log', {
    ticketId: String(ticketId),
    phase,
    type,
    content,
    ...data,
  })
  appendLogEvent(ticketExternalId, type, phase, content, data, undefined, phase)
  if (type !== 'debug') {
    emitDebugLog(
      ticketId,
      ticketExternalId,
      phase,
      `app.${type}`,
      { content, ...(data ? { data } : {}) },
    )
  }
}

function emitDebugLog(
  ticketId: number,
  ticketExternalId: string,
  phase: string,
  message: string,
  payload?: unknown,
) {
  const payloadText = payload === undefined ? '' : ` ${stringifyForLog(payload)}`
  const content = `[DEBUG] ${message}${payloadText}`
  const debugData = payload && typeof payload === 'object'
    ? (payload as Record<string, unknown>)
    : (payload !== undefined ? { value: payload } : undefined)

  broadcaster.broadcast(String(ticketId), 'log', {
    ticketId: String(ticketId),
    phase,
    type: 'debug',
    content,
    source: 'debug',
  })
  appendLogEvent(ticketExternalId, 'debug', phase, content, debugData, 'debug', phase)
}

function emitStateChange(
  ticketId: number,
  ticketExternalId: string,
  from: string,
  to: string,
) {
  const payload = {
    ticketId: String(ticketId),
    from,
    to,
  }
  broadcaster.broadcast(String(ticketId), 'state_change', payload)
  appendLogEvent(
    ticketExternalId,
    'state_change',
    to,
    `Transition: ${from} -> ${to}`,
    payload,
    'system',
    to,
  )
  emitDebugLog(ticketId, ticketExternalId, to, 'app.state_change', payload)
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
  ticketId: number,
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

  emitPhaseLog(
    ticketId,
    ticketExternalId,
    phase,
    'model_output',
    `[${stage}] OpenCode session transcript (${messages.length} messages)`,
    { modelId: memberId },
  )

  const transcriptLines = extractOpenCodeMessageLines(messages)
  for (const line of transcriptLines) {
    emitPhaseLog(
      ticketId,
      ticketExternalId,
      phase,
      'model_output',
      line,
      { modelId: memberId },
    )
  }

  if (transcriptLines.length === 0 && response) {
    emitPhaseLog(
      ticketId,
      ticketExternalId,
      phase,
      'model_output',
      response,
      { modelId: memberId },
    )
  }

  emitDebugLog(ticketId, ticketExternalId, phase, `opencode.${stage}.response`, { memberId, response })
  for (const message of messages) {
    emitDebugLog(ticketId, ticketExternalId, phase, `opencode.${stage}.raw_message`, { memberId, message })
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
  ticketId: number,
  ticketExternalId: string,
  phase: string,
  label: string,
  entry: DraftProgressEvent,
) {
  if (entry.status === 'session_created' && entry.sessionId) {
    emitPhaseLog(
      ticketId,
      ticketExternalId,
      phase,
      'info',
      `${label} draft session created for ${entry.memberId}: ${entry.sessionId}.`,
    )
    return
  }

  if (entry.status === 'finished' && entry.outcome && entry.outcome !== 'completed') {
    const detail = entry.outcome === 'timed_out'
      ? 'timed out'
      : `failed (${entry.error ?? 'invalid output'})`
    const durationText = typeof entry.duration === 'number' ? ` after ${formatDurationMs(entry.duration)}` : ''
    const sessionText = entry.sessionId ? ` session=${entry.sessionId}` : ''
    emitPhaseLog(
      ticketId,
      ticketExternalId,
      phase,
      'error',
      `${label} draft ${detail} for ${entry.memberId}${sessionText}${durationText}.`,
    )
  }
}

async function handleInterviewDeliberate(
  ticketId: number,
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
    `Council members resolved from ${describeCouncilMemberSource(council.source)}: ${members.length} members (${formatCouncilMemberRoster(members)}).`,
  )

  const ticketDescription = ticket?.description ?? ''
  emitPhaseLog(ticketId, context.externalId, phase, 'info', `Loaded codebase map artifact (${codebaseMap.length} chars).`)

  // Build context via buildMinimalContext with full ticket state
  const ticketState: TicketState = {
    ticketId: context.externalId,
    title: context.title,
    description: ticketDescription,
    codebaseMap,
  }
  const ticketContext = buildMinimalContext('interview_draft', ticketState)

  emitPhaseLog(ticketId, context.externalId, phase, 'info', `Interview council drafting started. Context: ${ticketContext.length} parts, description=${ticketDescription.length > 0 ? 'present' : 'missing'}, codebaseMap=${codebaseMap ? 'loaded' : 'missing'}.`)
  emitPhaseLog(ticketId, context.externalId, phase, 'info', `Dispatching interview draft requests to ${members.length} council members.`)

  if (signal.aborted) throw new CancelledError(ticketId)
  const startedAt = Date.now()
  const result = await deliberateInterview(
    adapter,
    members,
    ticketContext,
    worktreePath,
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
    const questionCount = (draft.content.match(/\?/g) || []).length
    const detail = draft.outcome === 'timed_out'
      ? 'timed out'
      : draft.outcome === 'invalid_output'
        ? 'invalid output'
        : `proposed ${questionCount} questions`
    emitPhaseLog(
      ticketId,
      context.externalId,
      'COUNCIL_DELIBERATING',
      'model_output',
      `${draft.memberId} ${detail}.`,
      {
        modelId: draft.memberId,
        outcome: draft.outcome,
        duration: draft.duration,
      },
    )
  }

  db.insert(phaseArtifacts)
    .values({
      ticketId,
      phase,
      artifactType: 'interview_drafts',
      content: JSON.stringify(result),
    })
    .run()
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
  ticketId: number,
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
  )

  const { winnerId, totalScore } = selectWinner(votes, members)

  // Store vote results for refine step
  intermediate.votes = votes
  intermediate.winnerId = winnerId

  db.insert(phaseArtifacts)
    .values({
      ticketId,
      phase: 'COUNCIL_VOTING_INTERVIEW',
      artifactType: 'interview_votes',
      content: JSON.stringify({ votes, winnerId, totalScore }),
    })
    .run()
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
  ticketId: number,
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

  db.insert(phaseArtifacts)
    .values({
      ticketId,
      phase: 'COMPILING_INTERVIEW',
      artifactType: 'interview_compiled',
      content: JSON.stringify({
        winnerId: intermediate.winnerId,
        refinedContent,
        questions: parsedQuestions,
      }),
    })
    .run()

  // Persist winnerId separately so it survives server restarts and is available
  // for VERIFYING_INTERVIEW_COVERAGE and downstream phases (PROM4/PROM5 wiring)
  db.insert(phaseArtifacts)
    .values({
      ticketId,
      phase: 'COMPILING_INTERVIEW',
      artifactType: 'interview_winner',
      content: JSON.stringify({ winnerId: intermediate.winnerId }),
    })
    .run()

  emitPhaseLog(
    ticketId,
    context.externalId,
    'COMPILING_INTERVIEW',
    'info',
    `Compiled final interview from winner ${intermediate.winnerId}. Parsed ${parsedQuestions.length} structured questions.`,
  )
  sendEvent({ type: 'READY' })
  broadcaster.broadcast(String(ticketId), 'needs_input', {
    ticketId: String(ticketId),
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
    members = context.lockedCouncilMembers.map(id => ({ modelId: id, name: id.split('/').pop() ?? id }))
    source = 'locked_ticket'
  } else {
    const profile = db.select().from(profiles).get()
    if (profile?.councilMembers) {
      try {
        const modelIds = JSON.parse(profile.councilMembers) as string[]
        members = modelIds.map(id => ({ modelId: id, name: id.split('/').pop() ?? id }))
        if (members.length > 0) source = 'profile'
      } catch { /* fallback below */ }
    }
  }

  if (members.length === 0) {
    members = [{ modelId: 'openai/gpt-5.3-codex', name: 'gpt-5.3-codex' }]
    source = 'default'
  }
  return { members, source }
}

// --- Helper: load ticket dir paths and codebase map ---
function loadTicketDirContext(context: TicketContext) {
  const ticket = db.select().from(tickets).where(eq(tickets.id, Number(context.ticketId))).get()
  const worktreePath = getTicketWorktreePath(context.externalId)
  const ticketDir = getTicketDir(context.externalId)

  if (!existsSync(ticketDir)) {
    throw new Error(`Ticket workspace not initialized: missing ticket directory for ${context.externalId}`)
  }

  const codebaseMapPath = resolve(ticketDir, 'codebase-map.yaml')
  if (!existsSync(codebaseMapPath)) {
    throw new Error(`Ticket workspace not initialized: missing codebase-map.yaml for ${context.externalId}`)
  }

  const codebaseMap = readFileSync(codebaseMapPath, 'utf-8')

  return { worktreePath, ticket, ticketDir, codebaseMap }
}

// ─── PRD Phase Handlers ───

async function handlePrdDraft(
  ticketId: number,
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
    `Council members resolved from ${describeCouncilMemberSource(council.source)}: ${members.length} members (${formatCouncilMemberRoster(members)}).`)
  emitPhaseLog(ticketId, context.externalId, phase, 'info',
    interview
      ? `Loaded interview artifact (${interview.length} chars).`
      : 'Interview artifact missing; PRD drafting will rely on available ticket context.')
  emitPhaseLog(ticketId, context.externalId, phase, 'info',
    `PRD council drafting started. Context: ${ticketContext.length} parts, interview=${interview ? 'loaded' : 'missing'}.`)
  emitPhaseLog(ticketId, context.externalId, phase, 'info', `Dispatching PRD draft requests to ${members.length} council members.`)

  if (signal.aborted) throw new CancelledError(ticketId)
  const startedAt = Date.now()
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
    emitPhaseLog(ticketId, context.externalId, 'DRAFTING_PRD', 'model_output',
      `${draft.memberId} ${detail}.`,
      { modelId: draft.memberId, outcome: draft.outcome, duration: draft.duration })
  }

  db.insert(phaseArtifacts)
    .values({
      ticketId,
      phase,
      artifactType: 'prd_drafts',
      content: JSON.stringify(result),
    })
    .run()
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
  ticketId: number,
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
  )

  const { winnerId, totalScore } = selectWinner(votes, members)

  intermediate.votes = votes
  intermediate.winnerId = winnerId

  db.insert(phaseArtifacts)
    .values({
      ticketId,
      phase: 'COUNCIL_VOTING_PRD',
      artifactType: 'prd_votes',
      content: JSON.stringify({ votes, winnerId, totalScore }),
    })
    .run()
  emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_PRD', 'info',
    `PRD voting selected winner: ${winnerId} (score: ${totalScore}).`)
  sendEvent({ type: 'WINNER_SELECTED', winner: winnerId })
  emitStateChange(ticketId, context.externalId, 'COUNCIL_VOTING_PRD', 'REFINING_PRD')
}

async function handlePrdRefine(
  ticketId: number,
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
  )

  // Clean up intermediate data
  phaseIntermediate.delete(`${ticketId}:prd`)

  const ticketDir = resolve(process.cwd(), '.looptroop/worktrees', context.externalId, '.ticket')
  const prdPath = resolve(ticketDir, 'prd.yaml')

  db.insert(phaseArtifacts)
    .values({
      ticketId,
      phase: 'REFINING_PRD',
      artifactType: 'prd_refined',
      content: JSON.stringify({
        winnerId: intermediate.winnerId,
        refinedContent,
      }),
    })
    .run()

  // Save refined PRD to disk
  safeAtomicWrite(prdPath, refinedContent)

  emitPhaseLog(ticketId, context.externalId, 'REFINING_PRD', 'info',
    `Refined PRD from winner ${intermediate.winnerId}. Saved to ${prdPath}.`)

  sendEvent({ type: 'REFINED' })

  emitStateChange(ticketId, context.externalId, 'REFINING_PRD', 'VERIFYING_PRD_COVERAGE')
}

// ─── Beads Phase Handlers ───

async function handleBeadsDraft(
  ticketId: number,
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
    `Council members resolved from ${describeCouncilMemberSource(council.source)}: ${members.length} members (${formatCouncilMemberRoster(members)}).`)
  emitPhaseLog(ticketId, context.externalId, phase, 'info',
    prd
      ? `Loaded PRD artifact (${prd.length} chars).`
      : 'PRD artifact missing; beads drafting will rely on available ticket context.')
  emitPhaseLog(ticketId, context.externalId, phase, 'info',
    `Beads council drafting started. Context: ${ticketContext.length} parts, prd=${prd ? 'loaded' : 'missing'}.`)
  emitPhaseLog(ticketId, context.externalId, phase, 'info', `Dispatching beads draft requests to ${members.length} council members.`)

  if (signal.aborted) throw new CancelledError(ticketId)
  const startedAt = Date.now()
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
    emitPhaseLog(ticketId, context.externalId, 'DRAFTING_BEADS', 'model_output',
      `${draft.memberId} ${detail}.`,
      { modelId: draft.memberId, outcome: draft.outcome, duration: draft.duration })
  }

  db.insert(phaseArtifacts)
    .values({
      ticketId,
      phase,
      artifactType: 'beads_drafts',
      content: JSON.stringify(result),
    })
    .run()
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
  ticketId: number,
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
  )

  const { winnerId, totalScore } = selectWinner(votes, members)

  intermediate.votes = votes
  intermediate.winnerId = winnerId

  db.insert(phaseArtifacts)
    .values({
      ticketId,
      phase: 'COUNCIL_VOTING_BEADS',
      artifactType: 'beads_votes',
      content: JSON.stringify({ votes, winnerId, totalScore }),
    })
    .run()
  emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_BEADS', 'info',
    `Beads voting selected winner: ${winnerId} (score: ${totalScore}).`)
  sendEvent({ type: 'WINNER_SELECTED', winner: winnerId })
  emitStateChange(ticketId, context.externalId, 'COUNCIL_VOTING_BEADS', 'REFINING_BEADS')
}

async function handleBeadsRefine(
  ticketId: number,
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
  )

  // Clean up intermediate data
  phaseIntermediate.delete(`${ticketId}:beads`)

  const ticketDir = resolve(process.cwd(), '.looptroop/worktrees', context.externalId, '.ticket')
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

  db.insert(phaseArtifacts)
    .values({
      ticketId,
      phase: 'REFINING_BEADS',
      artifactType: 'beads_refined',
      content: JSON.stringify({
        winnerId: intermediate.winnerId,
        refinedContent,
        expandedBeads,
      }),
    })
    .run()

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
      if (/^\d+[\.\)]\s/.test(trimmed) || /^[-*]\s/.test(trimmed) || /^\*\*Q\d/i.test(trimmed) || trimmed.endsWith('?')) {
        const q = trimmed.replace(/^[-*\d\.\)]+\s*/, '').replace(/^\*\*/, '').replace(/\*\*$/, '')
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
  ticketId: number,
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
  let councilResult = phaseResults.get(`${ticketId}:${phase}`)
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
    const winnerArtifact = db.select().from(phaseArtifacts)
      .where(and(
        eq(phaseArtifacts.ticketId, ticketId),
        eq(phaseArtifacts.artifactType, winnerArtifactType),
      ))
      .orderBy(desc(phaseArtifacts.id))
      .get()

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
    const compiledArtifact = db.select().from(phaseArtifacts)
      .where(and(
        eq(phaseArtifacts.ticketId, ticketId),
        eq(phaseArtifacts.artifactType, compiledArtifactType),
      ))
      .orderBy(desc(phaseArtifacts.id))
      .get()
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

  const interviewUiState = db.select().from(phaseArtifacts)
    .where(and(
      eq(phaseArtifacts.ticketId, ticketId),
      eq(phaseArtifacts.phase, 'UI_STATE'),
      eq(phaseArtifacts.artifactType, 'ui_state:interview_qa'),
    ))
    .orderBy(desc(phaseArtifacts.id))
    .get()

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
    coverageContext.map(p => ({ type: p.type, content: p.content })),
  )

  // Use a single session for the winning model only (not all council members)
  if (signal.aborted) throw new CancelledError(ticketId)
  const session = await adapter.createSession(worktreePath, signal)
  emitPhaseLog(
    ticketId,
    context.externalId,
    stateLabel,
    'info',
    `OpenCode coverage: sending ${phase} verification prompt to ${winnerId} (session=${session.id}).`,
  )
  const response = await adapter.promptSession(session.id, [
    { type: 'text', content: promptContent },
  ], signal)
  const coverageMessages = await adapter.getSessionMessages(session.id)

  emitOpenCodeSessionLogs(
    ticketId,
    context.externalId,
    stateLabel,
    winnerId,
    session.id,
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
  db.insert(phaseArtifacts)
    .values({
      ticketId,
      phase: stateLabel,
      artifactType: `${phase}_coverage_input`,
      content: coverageInputContent,
    })
    .run()

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
  db.insert(phaseArtifacts)
    .values({
      ticketId,
      phase: stateLabel,
      artifactType: `${phase}_coverage`,
      content: JSON.stringify({ winnerId, response, hasGaps: detectedGaps }),
    })
    .run()

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
  ticketId: number,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  signal: AbortSignal,
) {
  const { worktreePath, ticket, codebaseMap } = loadTicketDirContext(context)

  // Resolve winnerId from persisted artifact
  const winnerArtifact = db.select().from(phaseArtifacts)
    .where(and(
      eq(phaseArtifacts.ticketId, ticketId),
      eq(phaseArtifacts.artifactType, 'interview_winner'),
    ))
    .orderBy(desc(phaseArtifacts.id))
    .get()

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
  const compiledArtifact = db.select().from(phaseArtifacts)
    .where(and(
      eq(phaseArtifacts.ticketId, ticketId),
      eq(phaseArtifacts.artifactType, 'interview_compiled'),
    ))
    .orderBy(desc(phaseArtifacts.id))
    .get()

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

  const { sessionId, firstBatch } = await startInterviewSession(
    adapter, worktreePath, winnerId, compiledQuestions, ticketState, maxQuestions, signal,
  )

  // Store session info
  interviewQASessions.set(ticketId, { sessionId, winnerId })
  db.insert(phaseArtifacts)
    .values({
      ticketId,
      phase: 'WAITING_INTERVIEW_ANSWERS',
      artifactType: 'interview_qa_session',
      content: JSON.stringify({ sessionId, winnerId }),
    })
    .run()

  // Store current batch
  db.insert(phaseArtifacts)
    .values({
      ticketId,
      phase: 'WAITING_INTERVIEW_ANSWERS',
      artifactType: 'interview_current_batch',
      content: JSON.stringify(firstBatch),
    })
    .run()

  emitPhaseLog(ticketId, context.externalId, 'WAITING_INTERVIEW_ANSWERS', 'info',
    `PROM4 session started (session=${sessionId}). First batch: ${firstBatch.questions.length} questions.`)

  // Broadcast first batch to frontend via SSE
  broadcaster.broadcast(String(ticketId), 'needs_input', {
    ticketId: String(ticketId),
    type: 'interview_batch',
    batch: firstBatch,
  })
}

/**
 * Handle a batch of user answers submitted during the PROM4 interview loop.
 * Called by the API route, not the state machine subscriber.
 */
export async function handleInterviewQABatch(
  ticketId: number,
  batchAnswers: Record<string, string>,
): Promise<BatchResponse> {
  // Get session info from memory or reload from DB
  let sessionInfo = interviewQASessions.get(ticketId)
  if (!sessionInfo) {
    const artifact = db.select().from(phaseArtifacts)
      .where(and(
        eq(phaseArtifacts.ticketId, ticketId),
        eq(phaseArtifacts.artifactType, 'interview_qa_session'),
      ))
      .orderBy(desc(phaseArtifacts.id))
      .get()
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

  const ticket = db.select().from(tickets).where(eq(tickets.id, ticketId)).get()
  const externalId = ticket?.externalId ?? String(ticketId)

  const signal = getOrCreateAbortSignal(ticketId)
  const result = await submitBatchToSession(adapter, sessionInfo.sessionId, batchAnswers, signal)

  // Accumulate answers in batch history
  const existingHistory = db.select().from(phaseArtifacts)
    .where(and(
      eq(phaseArtifacts.ticketId, ticketId),
      eq(phaseArtifacts.artifactType, 'interview_batch_history'),
    ))
    .orderBy(desc(phaseArtifacts.id))
    .get()

  let history: Array<{ batchNumber: number; answers: Record<string, string> }> = []
  if (existingHistory) {
    try { history = JSON.parse(existingHistory.content) as typeof history } catch { /* ignore */ }
  }
  history.push({ batchNumber: result.batchNumber, answers: batchAnswers })

  // Upsert history
  if (existingHistory) {
    db.update(phaseArtifacts)
      .set({ content: JSON.stringify(history) })
      .where(eq(phaseArtifacts.id, existingHistory.id))
      .run()
  } else {
    db.insert(phaseArtifacts)
      .values({
        ticketId,
        phase: 'WAITING_INTERVIEW_ANSWERS',
        artifactType: 'interview_batch_history',
        content: JSON.stringify(history),
      })
      .run()
  }

  if (result.isComplete && result.finalYaml) {
    // Write final interview YAML to disk
    const ticketDir = resolve(process.cwd(), '.looptroop/worktrees', externalId, '.ticket')
    const interviewPath = resolve(ticketDir, 'interview.yaml')
    safeAtomicWrite(interviewPath, result.finalYaml)
    emitPhaseLog(ticketId, externalId, 'WAITING_INTERVIEW_ANSWERS', 'info',
      `PROM4 interview complete. Final YAML written to ${interviewPath}.`)
  } else {
    // Store next batch as current
    const currentBatchArtifact = db.select().from(phaseArtifacts)
      .where(and(
        eq(phaseArtifacts.ticketId, ticketId),
        eq(phaseArtifacts.artifactType, 'interview_current_batch'),
      ))
      .orderBy(desc(phaseArtifacts.id))
      .get()

    if (currentBatchArtifact) {
      db.update(phaseArtifacts)
        .set({ content: JSON.stringify(result) })
        .where(eq(phaseArtifacts.id, currentBatchArtifact.id))
        .run()
    } else {
      db.insert(phaseArtifacts)
        .values({
          ticketId,
          phase: 'WAITING_INTERVIEW_ANSWERS',
          artifactType: 'interview_current_batch',
          content: JSON.stringify(result),
        })
        .run()
    }

    emitPhaseLog(ticketId, externalId, 'WAITING_INTERVIEW_ANSWERS', 'info',
      `PROM4 batch ${result.batchNumber}: ${result.questions.length} questions. Progress: ${result.progress.current}/${result.progress.total}.`)
  }

  return result
}

export function attachWorkflowRunner(
  ticketId: number,
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
    }
  })
}
