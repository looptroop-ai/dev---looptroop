import type { TicketContext, TicketEvent } from '../../machines/types'
import { getTicketPaths, insertPhaseArtifact } from '../../storage/tickets'
import { isMockOpenCodeMode } from '../../opencode/factory'
import { executeBead } from '../../phases/execution/executor'
import { getNextBead, isAllComplete } from '../../phases/execution/scheduler'
import { throwIfAborted } from '../../council/types'
import { broadcaster } from '../../sse/broadcaster'
import { adapter } from './state'
import { emitPhaseLog, emitAiMilestone, emitOpenCodeStreamEvent, emitOpenCodePromptLog, createOpenCodeStreamState, resolveExecutionRuntimeSettings } from './helpers'
import type { OpenCodeStreamState } from './types'
import { readTicketBeads, writeTicketBeads, updateTicketProgressFromBeads } from './beadsPhase'

export async function handleMockExecutionUnsupported(
  ticketId: string,
  context: TicketContext,
  phase: string,
  sendEvent: (event: TicketEvent) => void,
) {
  const message = 'Mock OpenCode mode stops before execution. Start a real OpenCode server to continue past planning phases.'
  emitPhaseLog(ticketId, context.externalId, phase, 'error', message)
  sendEvent({ type: 'ERROR', message, codes: ['MOCK_EXECUTION_UNSUPPORTED'] })
}

export async function handleCoding(
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
    ? { ...bead, status: 'in_progress' as const, updatedAt: now, startedAt: now }
    : bead)
  writeTicketBeads(ticketId, inProgressBeads)
  updateTicketProgressFromBeads(ticketId, inProgressBeads)

  const codingModelId = context.lockedMainImplementer
  if (!codingModelId) {
    throw new Error('No locked main implementer is configured for coding')
  }

  emitPhaseLog(ticketId, context.externalId, 'CODING', 'info', `Executing bead ${nextBead.id}: ${nextBead.title}`, { source: 'system', modelId: codingModelId })

  const contextParts = await adapter.assembleBeadContext(ticketId, nextBead.id)
  throwIfAborted(signal, ticketId)
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
      variant: context.lockedMainImplementerVariant ?? undefined,
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
    const nowStr = new Date().toISOString()
    const failedBeads = inProgressBeads.map(bead => bead.id === nextBead.id
      ? {
          ...bead,
          status: 'error' as const,
          iteration: result.iteration,
          updatedAt: nowStr,
        }
      : bead)
    writeTicketBeads(ticketId, failedBeads)
    updateTicketProgressFromBeads(ticketId, failedBeads)
    emitPhaseLog(ticketId, context.externalId, 'CODING', 'error', `Bead ${nextBead.id} failed.`, {
      source: 'system',
      modelId: codingModelId,
      errors: result.errors,
    })
    sendEvent({ type: 'BEAD_ERROR' })
    return
  }

  const doneNow = new Date().toISOString()
  const completedBeads = inProgressBeads.map(bead => bead.id === nextBead.id
    ? {
        ...bead,
        status: 'done' as const,
        iteration: result.iteration,
        updatedAt: doneNow,
        completedAt: doneNow,
      }
    : bead)
  writeTicketBeads(ticketId, completedBeads)
  updateTicketProgressFromBeads(ticketId, completedBeads)

  broadcaster.broadcast(ticketId, 'bead_complete', {
    ticketId,
    beadId: nextBead.id,
    title: nextBead.title,
    completed: completedBeads.filter(bead => bead.status === 'done').length,
    total: completedBeads.length,
  })

  emitPhaseLog(ticketId, context.externalId, 'CODING', 'bead_complete', `Completed bead ${nextBead.id}: ${nextBead.title}`, { source: 'system', modelId: codingModelId })
  if (isAllComplete(completedBeads)) {
    sendEvent({ type: 'ALL_BEADS_DONE' })
  } else {
    sendEvent({ type: 'BEAD_COMPLETE' })
  }
}
