import { createActor } from 'xstate'
import { ticketMachine } from '../machines/ticketMachine'
import type { TicketContext, TicketEvent } from '../machines/types'
import { db } from '../db/index'
import { profiles, projects, tickets, phaseArtifacts } from '../db/schema'
import { eq } from 'drizzle-orm'
import { broadcaster } from '../sse/broadcaster'
import { deliberateInterview } from '../phases/interview/deliberate'
import { OpenCodeSDKAdapter } from '../opencode/adapter'
import type { CouncilResult } from '../council/types'
import { appendLogEvent } from '../log/executionLog'
import type { LogEventType } from '../log/types'
import { buildMinimalContext, type TicketState } from '../opencode/contextBuilder'
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
    }
  })
}
