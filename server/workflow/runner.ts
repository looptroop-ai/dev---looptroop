import { createActor } from 'xstate'
import { ticketMachine } from '../machines/ticketMachine'
import type { TicketContext, TicketEvent } from '../machines/types'
import { db } from '../db/index'
import { profiles, projects, tickets, phaseArtifacts } from '../db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { broadcaster } from '../sse/broadcaster'
import { deliberateInterview } from '../phases/interview/deliberate'
import { OpenCodeSDKAdapter } from '../opencode/adapter'
import type { CouncilResult } from '../council/types'
import { appendLogEvent } from '../log/executionLog'
import type { LogEventType } from '../log/types'
import { buildMinimalContext, type TicketState } from '../opencode/contextBuilder'
import { buildPromptFromTemplate, PROM5, PROM13, PROM24 } from '../prompts/index'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { initializeTicket } from '../ticket/initialize'

const runningPhases = new Set<string>()
const phaseResults = new Map<string, CouncilResult>()
const adapter = new OpenCodeSDKAdapter()

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
  appendLogEvent(ticketExternalId, type, phase, content, data)
}

async function handleInterviewDeliberate(
  ticketId: number,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
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

  const result = await deliberateInterview(adapter, members, ticketContext, projectPath)

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
  db.insert(phaseArtifacts)
    .values({
      ticketId,
      phase: 'COMPILING_INTERVIEW',
      artifactType: 'interview_compiled',
      content: JSON.stringify({
        winnerId: result.winnerId,
        refinedContent: result.refinedContent,
      }),
    })
    .run()
  emitPhaseLog(
    ticketId,
    context.externalId,
    'COMPILING_INTERVIEW',
    'info',
    `Compiled final interview from winner ${result.winnerId}.`,
  )
  sendEvent({ type: 'READY' })
  broadcaster.broadcast(String(ticketId), 'needs_input', {
    ticketId: String(ticketId),
    type: 'interview_questions',
    context: { questions: result.refinedContent },
  })
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
  const councilResult = phaseResults.get(`${ticketId}:${phase}`)
  if (!councilResult) {
    const msg = `No council result found for ${phase} phase — cannot determine winning model`
    emitPhaseLog(ticketId, context.externalId, stateLabel, 'error', msg)
    sendEvent({ type: 'ERROR', message: msg, codes: ['COVERAGE_FAILED'] })
    return
  }

  const winnerId = councilResult.winnerId
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

  const ticketState: TicketState = {
    ticketId: context.externalId,
    title: context.title,
    description: ticket?.description ?? '',
    codebaseMap,
    interview: councilResult.refinedContent,
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
  const session = await adapter.createSession(projectPath)
  const response = await adapter.promptSession(session.id, [
    { type: 'text', content: promptContent },
  ])

  // Parse response: detect gaps vs clean coverage
  const lowerResponse = response.toLowerCase()
  const hasGaps = lowerResponse.includes('gap') || lowerResponse.includes('missing')
    || lowerResponse.includes('uncovered') || lowerResponse.includes('follow-up question')
    || lowerResponse.includes('discrepanc')
  const isClean = lowerResponse.includes('no gaps') || lowerResponse.includes('complete and ready')
    || lowerResponse.includes('coverage is complete') || lowerResponse.includes('no discrepanc')
    || lowerResponse.includes('ready for')

  // Store the coverage verification artifact
  db.insert(phaseArtifacts)
    .values({
      ticketId,
      phase: stateLabel,
      artifactType: `${phase}_coverage`,
      content: JSON.stringify({ winnerId, response, hasGaps: hasGaps && !isClean }),
    })
    .run()

  if (hasGaps && !isClean) {
    emitPhaseLog(ticketId, context.externalId, stateLabel, 'info',
      `Coverage gaps detected by winning model ${winnerId}. Looping back for refinement.`)
    sendEvent({ type: 'GAPS_FOUND' })
  } else {
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

    if (runningPhases.has(key)) return

    if (state === 'COUNCIL_DELIBERATING') {
      runningPhases.add(key)
      handleInterviewDeliberate(ticketId, context, sendEvent)
        .catch(err => {
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
      handleCoverageVerification(ticketId, context, sendEvent, 'interview')
        .catch(err => {
          const errMsg = err instanceof Error ? err.message : String(err)
          console.error(`[runner] VERIFYING_INTERVIEW_COVERAGE failed for ticket ${context.externalId}: ${errMsg}`)
          emitPhaseLog(ticketId, context.externalId, 'VERIFYING_INTERVIEW_COVERAGE', 'error', errMsg)
          sendEvent({ type: 'ERROR', message: errMsg, codes: ['COVERAGE_FAILED'] })
        })
        .finally(() => {
          runningPhases.delete(key)
        })
    } else if (state === 'VERIFYING_PRD_COVERAGE') {
      runningPhases.add(key)
      handleCoverageVerification(ticketId, context, sendEvent, 'prd')
        .catch(err => {
          const errMsg = err instanceof Error ? err.message : String(err)
          console.error(`[runner] VERIFYING_PRD_COVERAGE failed for ticket ${context.externalId}: ${errMsg}`)
          emitPhaseLog(ticketId, context.externalId, 'VERIFYING_PRD_COVERAGE', 'error', errMsg)
          sendEvent({ type: 'ERROR', message: errMsg, codes: ['COVERAGE_FAILED'] })
        })
        .finally(() => {
          runningPhases.delete(key)
        })
    } else if (state === 'VERIFYING_BEADS_COVERAGE') {
      runningPhases.add(key)
      handleCoverageVerification(ticketId, context, sendEvent, 'beads')
        .catch(err => {
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
