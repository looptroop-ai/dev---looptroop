import { createActor } from 'xstate'
import { ticketMachine } from '../machines/ticketMachine'
import type { TicketContext, TicketEvent } from '../machines/types'
import { db } from '../db/index'
import { profiles, projects, phaseArtifacts } from '../db/schema'
import { eq } from 'drizzle-orm'
import { broadcaster } from '../sse/broadcaster'
import { deliberateInterview } from '../phases/interview/deliberate'
import { OpenCodeSDKAdapter } from '../opencode/adapter'
import type { CouncilResult } from '../council/types'
import { appendLogEvent } from '../log/executionLog'
import type { LogEventType } from '../log/types'

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
  const profile = db.select().from(profiles).get()
  let members: Array<{ modelId: string; name: string }> = []

  if (profile?.councilMembers) {
    try {
      const modelIds = JSON.parse(profile.councilMembers) as string[]
      members = modelIds.map(id => ({ modelId: id, name: id.split('/').pop() ?? id }))
    } catch {
      // fallback below
    }
  }

  if (members.length === 0) {
    members = [{ modelId: 'openai/gpt-5.3-codex', name: 'gpt-5.3-codex' }]
  }

  const project = db.select().from(projects).where(eq(projects.id, context.projectId)).get()
  const projectPath = project?.folderPath ?? process.cwd()

  const ticketContext = [
    {
      type: 'text' as const,
      content: `Title: ${context.title}\nDescription: Interview questions for this ticket`,
    },
  ]

  emitPhaseLog(ticketId, context.externalId, 'COUNCIL_DELIBERATING', 'info', 'Interview council drafting started.')

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
          emitPhaseLog(ticketId, context.externalId, 'COUNCIL_DELIBERATING', 'error', String(err))
          sendEvent({ type: 'ERROR', message: String(err) })
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
            emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_INTERVIEW', 'error', String(err))
            sendEvent({ type: 'ERROR', message: String(err) })
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
            emitPhaseLog(ticketId, context.externalId, 'COMPILING_INTERVIEW', 'error', String(err))
            sendEvent({ type: 'ERROR', message: String(err) })
          })
          .finally(() => {
            runningPhases.delete(key)
          })
      }
    }
  })
}
