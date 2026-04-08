import type { TicketContext, TicketEvent } from '../../machines/types'
import { getTicketPaths, insertPhaseArtifact } from '../../storage/tickets'
import { isMockOpenCodeMode } from '../../opencode/factory'
import { executeBead } from '../../phases/execution/executor'
import { getNextBead, isAllComplete } from '../../phases/execution/scheduler'
import { recordBeadStartCommit, commitBeadChanges, resetToBeadStart, captureBeadDiff } from '../../phases/execution/gitOps'
import { throwIfAborted } from '../../council/types'
import { broadcaster } from '../../sse/broadcaster'
import { withCommandLoggingAsync } from '../../log/commandLogger'
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
  return withCommandLoggingAsync(
    ticketId, context.externalId, 'CODING',
    async () => {
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

  // Record bead start commit for potential reset on context wipe
  let beadStartCommit: string | null = null
  try {
    beadStartCommit = recordBeadStartCommit(paths.worktreePath)
    const beadsWithCommit = readTicketBeads(ticketId).map(b =>
      b.id === nextBead.id ? { ...b, beadStartCommit } : b)
    writeTicketBeads(ticketId, beadsWithCommit)
  } catch (err) {
    emitPhaseLog(ticketId, context.externalId, 'CODING', 'info', `Could not record bead start commit: ${err instanceof Error ? err.message : 'Unknown error'}`, { source: 'system', modelId: codingModelId })
  }

  throwIfAborted(signal, ticketId)
  const executionSettings = resolveExecutionRuntimeSettings(context)
  const streamStates = new Map<string, OpenCodeStreamState>()
  const result = await executeBead(
    adapter,
    nextBead,
    () => adapter.assembleBeadContext(ticketId, nextBead.id),
    paths.worktreePath,
    executionSettings.maxIterations,
    executionSettings.perIterationTimeoutMs,
    signal,
    {
      ticketId,
      model: codingModelId,
      variant: context.lockedMainImplementerVariant ?? undefined,
      onSessionCreated: (sessionId, iteration) => {
        const currentBeads = readTicketBeads(ticketId)
        const updated = currentBeads.map((bead) => bead.id === nextBead.id
          ? {
              ...bead,
              status: 'in_progress' as const,
              iteration,
              updatedAt: new Date().toISOString(),
            }
          : bead)
        writeTicketBeads(ticketId, updated)
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
      onNotesUpdated: (beadId, notes) => {
        const currentBeads = readTicketBeads(ticketId)
        const updated = currentBeads.map(b => b.id === beadId ? { ...b, notes } : b)
        writeTicketBeads(ticketId, updated)

        // Reset to bead start commit on context wipe
        if (beadStartCommit) {
          try {
            resetToBeadStart(paths.worktreePath, beadStartCommit)
          } catch (err) {
            emitPhaseLog(ticketId, context.externalId, 'CODING', 'info', `Could not reset to bead start commit: ${err instanceof Error ? err.message : 'Unknown error'}`, { source: 'system', modelId: codingModelId })
          }
        }
      },
    },
  )
  throwIfAborted(signal, ticketId)

  insertPhaseArtifact(ticketId, {
    phase: 'CODING',
    artifactType: `bead_execution:${nextBead.id}`,
    content: JSON.stringify(result),
  })

  // Reload beads from disk to avoid overwriting fields (notes, beadStartCommit)
  // that were persisted during execution via callbacks
  const freshBeads = readTicketBeads(ticketId)

  if (!result.success) {
    const nowStr = new Date().toISOString()
    const failedBeads = freshBeads.map(bead => bead.id === nextBead.id
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
  const completedBeads = freshBeads.map(bead => bead.id === nextBead.id
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

  // Commit and push bead changes
  try {
    const gitResult = commitBeadChanges(paths.worktreePath, nextBead.id, nextBead.title)
    if (gitResult.error) {
      emitPhaseLog(ticketId, context.externalId, 'CODING', 'info', `Git operation warning for bead ${nextBead.id}: ${gitResult.error}`, { source: 'system', modelId: codingModelId })
    }
    if (gitResult.committed) {
      emitPhaseLog(ticketId, context.externalId, 'CODING', 'info', `Committed bead ${nextBead.id} changes${gitResult.pushed ? ' and pushed' : ' (push pending)'}`, { source: 'system', modelId: codingModelId })
    }
  } catch (err) {
    emitPhaseLog(ticketId, context.externalId, 'CODING', 'info', `Could not commit bead changes: ${err instanceof Error ? err.message : 'Unknown error'}`, { source: 'system', modelId: codingModelId })
  }

  // Capture code-only diff for this bead (excludes .ticket/** metadata)
  if (beadStartCommit) {
    try {
      const diffContent = captureBeadDiff(paths.worktreePath, beadStartCommit)
      insertPhaseArtifact(ticketId, {
        phase: 'CODING',
        artifactType: `bead_diff:${nextBead.id}`,
        content: diffContent,
      })
    } catch (err) {
      emitPhaseLog(ticketId, context.externalId, 'CODING', 'info', `Could not capture bead diff: ${err instanceof Error ? err.message : 'Unknown error'}`, { source: 'system', modelId: codingModelId })
    }
  }

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
    },
    (phase, type, content) => emitPhaseLog(ticketId, context.externalId, phase, type, content, { source: 'system', audience: 'all' }),
  )
}
