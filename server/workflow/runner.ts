import { createActor } from 'xstate'
import { ticketMachine } from '../machines/ticketMachine'
import type { TicketContext, TicketEvent } from '../machines/types'
import { db } from '../db/index'
import { profiles, projects, tickets, phaseArtifacts } from '../db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { broadcaster } from '../sse/broadcaster'
import { deliberateInterview } from '../phases/interview/deliberate'
import { draftPRD } from '../phases/prd/draft'
import { draftBeads } from '../phases/beads/draft'
import { expandBeads } from '../phases/beads/expand'
import type { BeadSubset } from '../phases/beads/types'
import { OpenCodeSDKAdapter } from '../opencode/adapter'
import type { CouncilResult } from '../council/types'
import { CancelledError } from '../council/types'
import { appendLogEvent } from '../log/executionLog'
import type { LogEventType } from '../log/types'
import { buildMinimalContext, type TicketState } from '../opencode/contextBuilder'
import { buildPromptFromTemplate, PROM5, PROM13, PROM24 } from '../prompts/index'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
// @ts-expect-error no type declarations for js-yaml
import jsYaml from 'js-yaml'
import { safeAtomicWrite } from '../io/atomicWrite'
import { writeJsonl } from '../io/jsonl'
import { initializeTicket } from '../ticket/initialize'

const runningPhases = new Set<string>()
const phaseResults = new Map<string, CouncilResult>()
const adapter = new OpenCodeSDKAdapter()
const ticketAbortControllers = new Map<number, AbortController>()

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
}

async function handleInterviewDeliberate(
  ticketId: number,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  signal: AbortSignal,
) {
  const project = db.select().from(projects).where(eq(projects.id, context.projectId)).get()
  const projectPath = project?.folderPath ?? process.cwd()

  // Step 1: Initialize ticket directory structure so logs can be written
  const initResult = initializeTicket({ externalId: context.externalId, projectFolder: projectPath })
  if (!initResult.success) {
    const msg = `Ticket initialization failed: ${initResult.error}`
    console.error(`[runner] ${msg}`)
    emitPhaseLog(ticketId, context.externalId, 'COUNCIL_DELIBERATING', 'error', msg)
    throw new Error(msg)
  }

  // Step 2: Health-check OpenCode before doing any work
  if (signal.aborted) throw new CancelledError(ticketId)
  try {
    const health = await adapter.checkHealth()
    if (!health.available) {
      const msg = `OpenCode server is not running. Start it with \`opencode serve\`. (${health.error ?? 'connection refused'})`
      emitPhaseLog(ticketId, context.externalId, 'COUNCIL_DELIBERATING', 'error', msg)
      throw new Error(msg)
    }
  } catch (err) {
    // Re-throw if we already formatted the message
    if (err instanceof Error && err.message.startsWith('OpenCode server is not running')) throw err
    const msg = `OpenCode server is not running. Start it with \`opencode serve\`. (${err instanceof Error ? err.message : String(err)})`
    emitPhaseLog(ticketId, context.externalId, 'COUNCIL_DELIBERATING', 'error', msg)
    throw new Error(msg)
  }

  // Step 3: Resolve council members from locked config (frozen at ticket start)
  let members: Array<{ modelId: string; name: string }> = []

  if (context.lockedCouncilMembers && context.lockedCouncilMembers.length > 0) {
    members = context.lockedCouncilMembers.map(id => ({ modelId: id, name: id.split('/').pop() ?? id }))
  } else {
    // Fallback: read from profile only if no locked config (legacy tickets)
    const profile = db.select().from(profiles).get()
    if (profile?.councilMembers) {
      try {
        const modelIds = JSON.parse(profile.councilMembers) as string[]
        members = modelIds.map(id => ({ modelId: id, name: id.split('/').pop() ?? id }))
      } catch {
        // fallback below
      }
    }
  }

  if (members.length === 0) {
    members = [{ modelId: 'openai/gpt-5.3-codex', name: 'gpt-5.3-codex' }]
  }

  // Load ticket from DB to get full description
  const ticket = db.select().from(tickets).where(eq(tickets.id, ticketId)).get()
  const ticketDescription = ticket?.description ?? ''

  // Load codebase-map.yaml from disk if available
  const ticketDir = resolve(process.cwd(), '.looptroop/worktrees', context.externalId, '.ticket')
  const codebaseMapPath = resolve(ticketDir, 'codebase-map.yaml')
  let codebaseMap: string | undefined
  if (existsSync(codebaseMapPath)) {
    try {
      codebaseMap = readFileSync(codebaseMapPath, 'utf-8')
      console.log(`[runner] Loaded codebase-map.yaml (${codebaseMap.length} chars) for ticket ${context.externalId}`)
    } catch (err) {
      console.warn(`[runner] Failed to read codebase-map.yaml for ticket ${context.externalId}:`, err)
    }
  } else {
    console.warn(`[runner] codebase-map.yaml not found at ${codebaseMapPath}`)
  }

  // Build context via buildMinimalContext with full ticket state
  const ticketState: TicketState = {
    ticketId: context.externalId,
    title: context.title,
    description: ticketDescription,
    codebaseMap,
  }
  const ticketContext = buildMinimalContext('interview_draft', ticketState)

  emitPhaseLog(ticketId, context.externalId, 'COUNCIL_DELIBERATING', 'info', `Interview council drafting started. Context: ${ticketContext.length} parts, description=${ticketDescription.length > 0 ? 'present' : 'missing'}, codebaseMap=${codebaseMap ? 'loaded' : 'missing'}.`)

  if (signal.aborted) throw new CancelledError(ticketId)
  const result = await deliberateInterview(adapter, members, ticketContext, projectPath, signal)

  phaseResults.set(`${ticketId}:interview`, result)

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
      phase: 'COUNCIL_DELIBERATING',
      artifactType: 'interview_drafts',
      content: JSON.stringify(result),
    })
    .run()

  sendEvent({ type: 'QUESTIONS_READY', result: result as unknown as Record<string, unknown> })

  broadcaster.broadcast(String(ticketId), 'state_change', {
    ticketId: String(ticketId),
    from: 'COUNCIL_DELIBERATING',
    to: 'COUNCIL_VOTING_INTERVIEW',
  })
}

async function handleInterviewVote(
  ticketId: number,
  result: CouncilResult,
  ticketExternalId: string,
  sendEvent: (event: TicketEvent) => void,
) {
  await Promise.resolve()
  db.insert(phaseArtifacts)
    .values({
      ticketId,
      phase: 'COUNCIL_VOTING_INTERVIEW',
      artifactType: 'interview_votes',
      content: JSON.stringify(result),
    })
    .run()
  emitPhaseLog(
    ticketId,
    ticketExternalId,
    'COUNCIL_VOTING_INTERVIEW',
    'info',
    `Interview voting selected winner: ${result.winnerId}.`,
  )
  sendEvent({ type: 'WINNER_SELECTED', winner: result.winnerId })
  broadcaster.broadcast(String(ticketId), 'state_change', {
    ticketId: String(ticketId),
    from: 'COUNCIL_VOTING_INTERVIEW',
    to: 'COMPILING_INTERVIEW',
  })
}

async function handleInterviewCompile(
  ticketId: number,
  result: CouncilResult,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
) {
  await Promise.resolve()

  // Parse YAML questions from refined content into structured list
  let parsedQuestions: unknown[] = []
  try {
    const yamlParsed = jsYaml.load(result.refinedContent) as Record<string, unknown> | unknown[] | null
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
        winnerId: result.winnerId,
        refinedContent: result.refinedContent,
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
      content: JSON.stringify({ winnerId: result.winnerId }),
    })
    .run()

  emitPhaseLog(
    ticketId,
    context.externalId,
    'COMPILING_INTERVIEW',
    'info',
    `Compiled final interview from winner ${result.winnerId}. Parsed ${parsedQuestions.length} structured questions.`,
  )
  sendEvent({ type: 'READY' })
  broadcaster.broadcast(String(ticketId), 'needs_input', {
    ticketId: String(ticketId),
    type: 'interview_questions',
    context: { questions: result.refinedContent, parsedQuestions, winnerId: result.winnerId },
  })
}

// --- Helper: resolve council members from context (shared by PRD/Beads draft handlers) ---
function resolveCouncilMembers(context: TicketContext): Array<{ modelId: string; name: string }> {
  let members: Array<{ modelId: string; name: string }> = []

  if (context.lockedCouncilMembers && context.lockedCouncilMembers.length > 0) {
    members = context.lockedCouncilMembers.map(id => ({ modelId: id, name: id.split('/').pop() ?? id }))
  } else {
    const profile = db.select().from(profiles).get()
    if (profile?.councilMembers) {
      try {
        const modelIds = JSON.parse(profile.councilMembers) as string[]
        members = modelIds.map(id => ({ modelId: id, name: id.split('/').pop() ?? id }))
      } catch { /* fallback below */ }
    }
  }

  if (members.length === 0) {
    members = [{ modelId: 'openai/gpt-5.3-codex', name: 'gpt-5.3-codex' }]
  }
  return members
}

// --- Helper: load ticket dir paths and codebase map ---
function loadTicketDirContext(context: TicketContext) {
  const project = db.select().from(projects).where(eq(projects.id, context.projectId)).get()
  const projectPath = project?.folderPath ?? process.cwd()
  const ticket = db.select().from(tickets).where(eq(tickets.id, Number(context.ticketId))).get()
  const ticketDir = resolve(process.cwd(), '.looptroop/worktrees', context.externalId, '.ticket')

  const codebaseMapPath = resolve(ticketDir, 'codebase-map.yaml')
  let codebaseMap: string | undefined
  if (existsSync(codebaseMapPath)) {
    try { codebaseMap = readFileSync(codebaseMapPath, 'utf-8') } catch { /* ignore */ }
  }

  return { projectPath, ticket, ticketDir, codebaseMap }
}

// ─── PRD Phase Handlers ───

async function handlePrdDraft(
  ticketId: number,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  signal: AbortSignal,
) {
  const { projectPath, ticket, ticketDir, codebaseMap } = loadTicketDirContext(context)
  const members = resolveCouncilMembers(context)

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

  emitPhaseLog(ticketId, context.externalId, 'DRAFTING_PRD', 'info',
    `PRD council drafting started. Context: ${ticketContext.length} parts, interview=${interview ? 'loaded' : 'missing'}.`)

  if (signal.aborted) throw new CancelledError(ticketId)
  const result = await draftPRD(adapter, members, ticketContext, projectPath)

  phaseResults.set(`${ticketId}:prd`, result)

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
      phase: 'DRAFTING_PRD',
      artifactType: 'prd_drafts',
      content: JSON.stringify(result),
    })
    .run()

  sendEvent({ type: 'DRAFTS_READY' })

  broadcaster.broadcast(String(ticketId), 'state_change', {
    ticketId: String(ticketId),
    from: 'DRAFTING_PRD',
    to: 'COUNCIL_VOTING_PRD',
  })
}

async function handlePrdVote(
  ticketId: number,
  result: CouncilResult,
  ticketExternalId: string,
  sendEvent: (event: TicketEvent) => void,
) {
  await Promise.resolve()
  db.insert(phaseArtifacts)
    .values({
      ticketId,
      phase: 'COUNCIL_VOTING_PRD',
      artifactType: 'prd_votes',
      content: JSON.stringify(result),
    })
    .run()
  emitPhaseLog(ticketId, ticketExternalId, 'COUNCIL_VOTING_PRD', 'info',
    `PRD voting selected winner: ${result.winnerId}.`)
  sendEvent({ type: 'WINNER_SELECTED', winner: result.winnerId })
  broadcaster.broadcast(String(ticketId), 'state_change', {
    ticketId: String(ticketId),
    from: 'COUNCIL_VOTING_PRD',
    to: 'REFINING_PRD',
  })
}

async function handlePrdRefine(
  ticketId: number,
  result: CouncilResult,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
) {
  await Promise.resolve()

  const ticketDir = resolve(process.cwd(), '.looptroop/worktrees', context.externalId, '.ticket')
  const prdPath = resolve(ticketDir, 'prd.yaml')

  db.insert(phaseArtifacts)
    .values({
      ticketId,
      phase: 'REFINING_PRD',
      artifactType: 'prd_refined',
      content: JSON.stringify({
        winnerId: result.winnerId,
        refinedContent: result.refinedContent,
      }),
    })
    .run()

  // Save refined PRD to disk
  safeAtomicWrite(prdPath, result.refinedContent)

  emitPhaseLog(ticketId, context.externalId, 'REFINING_PRD', 'info',
    `Refined PRD from winner ${result.winnerId}. Saved to ${prdPath}.`)

  sendEvent({ type: 'REFINED' })

  broadcaster.broadcast(String(ticketId), 'state_change', {
    ticketId: String(ticketId),
    from: 'REFINING_PRD',
    to: 'VERIFYING_PRD_COVERAGE',
  })
}

// ─── Beads Phase Handlers ───

async function handleBeadsDraft(
  ticketId: number,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  signal: AbortSignal,
) {
  const { projectPath, ticket, ticketDir, codebaseMap } = loadTicketDirContext(context)
  const members = resolveCouncilMembers(context)

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

  emitPhaseLog(ticketId, context.externalId, 'DRAFTING_BEADS', 'info',
    `Beads council drafting started. Context: ${ticketContext.length} parts, prd=${prd ? 'loaded' : 'missing'}.`)

  if (signal.aborted) throw new CancelledError(ticketId)
  const result = await draftBeads(adapter, members, ticketContext, projectPath)

  phaseResults.set(`${ticketId}:beads`, result)

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
      phase: 'DRAFTING_BEADS',
      artifactType: 'beads_drafts',
      content: JSON.stringify(result),
    })
    .run()

  sendEvent({ type: 'DRAFTS_READY' })

  broadcaster.broadcast(String(ticketId), 'state_change', {
    ticketId: String(ticketId),
    from: 'DRAFTING_BEADS',
    to: 'COUNCIL_VOTING_BEADS',
  })
}

async function handleBeadsVote(
  ticketId: number,
  result: CouncilResult,
  ticketExternalId: string,
  sendEvent: (event: TicketEvent) => void,
) {
  await Promise.resolve()
  db.insert(phaseArtifacts)
    .values({
      ticketId,
      phase: 'COUNCIL_VOTING_BEADS',
      artifactType: 'beads_votes',
      content: JSON.stringify(result),
    })
    .run()
  emitPhaseLog(ticketId, ticketExternalId, 'COUNCIL_VOTING_BEADS', 'info',
    `Beads voting selected winner: ${result.winnerId}.`)
  sendEvent({ type: 'WINNER_SELECTED', winner: result.winnerId })
  broadcaster.broadcast(String(ticketId), 'state_change', {
    ticketId: String(ticketId),
    from: 'COUNCIL_VOTING_BEADS',
    to: 'REFINING_BEADS',
  })
}

async function handleBeadsRefine(
  ticketId: number,
  result: CouncilResult,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
) {
  await Promise.resolve()

  const ticketDir = resolve(process.cwd(), '.looptroop/worktrees', context.externalId, '.ticket')
  const beadsPath = resolve(ticketDir, 'beads', 'main', '.beads', 'issues.jsonl')

  // Parse refined content as bead subsets and expand to full beads
  let beadSubsets: BeadSubset[] = []
  try {
    beadSubsets = JSON.parse(result.refinedContent) as BeadSubset[]
  } catch {
    // If refinedContent is not valid JSON array, wrap as single-item
    beadSubsets = [{ id: 'bead-1', title: 'Main task', prdRefs: [], description: result.refinedContent, contextGuidance: '', acceptanceCriteria: [], tests: [], testCommands: [] }]
  }

  const expandedBeads = expandBeads(beadSubsets)

  db.insert(phaseArtifacts)
    .values({
      ticketId,
      phase: 'REFINING_BEADS',
      artifactType: 'beads_refined',
      content: JSON.stringify({
        winnerId: result.winnerId,
        refinedContent: result.refinedContent,
        expandedBeads,
      }),
    })
    .run()

  // Save expanded beads to disk as JSONL
  writeJsonl(beadsPath, expandedBeads)

  emitPhaseLog(ticketId, context.externalId, 'REFINING_BEADS', 'info',
    `Refined and expanded ${expandedBeads.length} beads from winner ${result.winnerId}. Saved to ${beadsPath}.`)

  sendEvent({ type: 'REFINED' })

  broadcaster.broadcast(String(ticketId), 'state_change', {
    ticketId: String(ticketId),
    from: 'REFINING_BEADS',
    to: 'VERIFYING_BEADS_COVERAGE',
  })
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

  // Parse user answers
  let userAnswers: Record<string, string> = {}
  if (userAnswersJson) {
    try { userAnswers = JSON.parse(userAnswersJson) as Record<string, string> } catch { /* ignore */ }
  }

  // Build structured questions with answers merged in
  const questions = parsedQuestions.map((q, idx) => {
    const qId = q.id ?? `Q${idx + 1}`
    const answerText = userAnswers[qId] ?? userAnswers[q.prompt ?? ''] ?? ''
    const skipped = !answerText
    return {
      id: qId,
      prompt: q.prompt ?? '',
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
  const project = db.select().from(projects).where(eq(projects.id, context.projectId)).get()
  const projectPath = project?.folderPath ?? process.cwd()
  const ticket = db.select().from(tickets).where(eq(tickets.id, ticketId)).get()

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

  // Build context for the coverage verification phase
  const ticketDir = resolve(process.cwd(), '.looptroop/worktrees', context.externalId, '.ticket')
  const codebaseMapPath = resolve(ticketDir, 'codebase-map.yaml')
  let codebaseMap: string | undefined
  if (existsSync(codebaseMapPath)) {
    try { codebaseMap = readFileSync(codebaseMapPath, 'utf-8') } catch { /* ignore */ }
  }

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
  const session = await adapter.createSession(projectPath, signal)
  const response = await adapter.promptSession(session.id, [
    { type: 'text', content: promptContent },
  ], signal)

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
          const codes = isOpenCode ? ['OPENCODE_UNREACHABLE'] : ['QUORUM_NOT_MET']
          console.error(`[runner] COUNCIL_DELIBERATING failed for ticket ${context.externalId}: ${errMsg}`)
          emitPhaseLog(ticketId, context.externalId, 'COUNCIL_DELIBERATING', 'error', errMsg)
          sendEvent({ type: 'ERROR', message: errMsg, codes })
        })
        .finally(() => {
          runningPhases.delete(key)
        })
    } else if (state === 'COUNCIL_VOTING_INTERVIEW') {
      const result = phaseResults.get(`${ticketId}:interview`)
      if (result) {
        runningPhases.add(key)
        handleInterviewVote(ticketId, result, context.externalId, sendEvent)
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
      const result = phaseResults.get(`${ticketId}:interview`)
      if (result) {
        runningPhases.add(key)
        handleInterviewCompile(ticketId, result, context, sendEvent)
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
      const result = phaseResults.get(`${ticketId}:prd`)
      if (result) {
        runningPhases.add(key)
        handlePrdVote(ticketId, result, context.externalId, sendEvent)
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
      const result = phaseResults.get(`${ticketId}:prd`)
      if (result) {
        runningPhases.add(key)
        handlePrdRefine(ticketId, result, context, sendEvent)
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
      const result = phaseResults.get(`${ticketId}:beads`)
      if (result) {
        runningPhases.add(key)
        handleBeadsVote(ticketId, result, context.externalId, sendEvent)
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
      const result = phaseResults.get(`${ticketId}:beads`)
      if (result) {
        runningPhases.add(key)
        handleBeadsRefine(ticketId, result, context, sendEvent)
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
