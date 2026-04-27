import type { TicketContext, TicketEvent } from '../../machines/types'
import { getTicketPaths, insertPhaseArtifact } from '../../storage/tickets'
import { isMockOpenCodeMode } from '../../opencode/factory'
import { executeBead } from '../../phases/execution/executor'
import { getNextBead, isAllComplete } from '../../phases/execution/scheduler'
import type { Bead } from '../../phases/beads/types'
import { recordBeadStartCommit, commitBeadChanges, resetToBeadStart, captureBeadDiff } from '../../phases/execution/gitOps'
import { EXECUTION_RUNTIME_PRESERVE_PATHS } from '../../phases/executionSetup/storage'
import { throwIfAborted } from '../../council/types'
import { broadcaster } from '../../sse/broadcaster'
import { withCommandLoggingAsync, withCommandLoggingFieldsAsync } from '../../log/commandLogger'
import { adapter } from './state'
import { emitPhaseLog, emitAiMilestone, emitOpenCodeSessionLogs, emitOpenCodeStreamEvent, emitOpenCodePromptLog, createOpenCodeStreamState, resolveExecutionRuntimeSettings } from './helpers'
import type { OpenCodeStreamState } from './types'
import { readTicketBeads, recoverCodingBeadWithReset, writeTicketBeads, updateTicketProgressFromBeads } from './beadsPhase'

function mergeBeadRetryMetadata(
  beads: Bead[],
  beadId: string,
  options: {
    notes: string
    iteration: number
    status: Bead['status']
    updatedAt?: string
  },
): Bead[] {
  const updatedAt = options.updatedAt ?? new Date().toISOString()
  return beads.map((bead) => {
    if (bead.id !== beadId) return bead
    return {
      ...bead,
      status: options.status,
      notes: options.notes,
      iteration: Math.max(bead.iteration ?? 0, options.iteration),
      updatedAt,
    }
  })
}

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

  let beads = readTicketBeads(ticketId)
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

  const codingModelId = context.lockedMainImplementer
  if (!codingModelId) {
    throw new Error('No locked main implementer is configured for coding')
  }

  const interruptedBead = recoverCodingBeadWithReset(ticketId, {
    worktreePath: paths.worktreePath,
    onlyInProgress: true,
    requireReset: true,
    preservePaths: [...EXECUTION_RUNTIME_PRESERVE_PATHS],
  })
  if (interruptedBead) {
    emitPhaseLog(
      ticketId,
      context.externalId,
      'CODING',
      'info',
      `Recovered interrupted bead ${interruptedBead.id} from its start snapshot and returned it to pending before resuming.`,
      { source: 'system', modelId: codingModelId, beadId: interruptedBead.id },
    )
    beads = readTicketBeads(ticketId)
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

  emitPhaseLog(ticketId, context.externalId, 'CODING', 'info', `Executing bead ${nextBead.id}: ${nextBead.title}`, { source: 'system', modelId: codingModelId, beadId: nextBead.id })

  // Record bead start commit for potential reset on context wipe
  let beadStartCommit: string | null = null
  try {
    beadStartCommit = await withCommandLoggingFieldsAsync({ beadId: nextBead.id }, async () => recordBeadStartCommit(paths.worktreePath))
    const beadsWithCommit = readTicketBeads(ticketId).map(b =>
      b.id === nextBead.id ? { ...b, beadStartCommit } : b)
    writeTicketBeads(ticketId, beadsWithCommit)
  } catch (err) {
    emitPhaseLog(ticketId, context.externalId, 'CODING', 'info', `Could not record bead start commit: ${err instanceof Error ? err.message : 'Unknown error'}`, { source: 'system', modelId: codingModelId, beadId: nextBead.id })
  }

  throwIfAborted(signal, ticketId)
  const executionSettings = resolveExecutionRuntimeSettings(context)
  const streamStates = new Map<string, OpenCodeStreamState>()
  const result = await withCommandLoggingFieldsAsync({ beadId: nextBead.id }, async () => await executeBead(
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
            beadId: nextBead.id,
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
          nextBead.id,
        )
      },
      onPromptDispatched: ({ event }) => {
        emitOpenCodePromptLog(
          ticketId,
          context.externalId,
          'CODING',
          codingModelId,
          event,
          nextBead.id,
        )
      },
      onPromptCompleted: ({ stage, event }) => {
        emitOpenCodeSessionLogs(
          ticketId,
          context.externalId,
          'CODING',
          codingModelId,
          event.session.id,
          stage,
          event.response,
          event.messages,
          streamStates.get(event.session.id),
          nextBead.id,
        )
      },
      onContextWipe: async ({ beadId, notes, iteration }) => {
        const nextIteration = iteration + 1
        if (!beadStartCommit) {
          throw new Error(`Cannot reset bead ${beadId} for attempt ${nextIteration}: missing bead start commit`)
        }

        const beadsBeforeReset = readTicketBeads(ticketId)
        const retryUpdatedAt = new Date().toISOString()
        try {
          await withCommandLoggingFieldsAsync(
            { beadId },
            async () => resetToBeadStart(paths.worktreePath, beadStartCommit!, {
              preservePaths: [...EXECUTION_RUNTIME_PRESERVE_PATHS],
            }),
          )
        } catch (err) {
          const preservedFailureBeads = mergeBeadRetryMetadata(beadsBeforeReset, beadId, {
            notes,
            iteration: nextIteration,
            status: 'error',
            updatedAt: retryUpdatedAt,
          })
          writeTicketBeads(ticketId, preservedFailureBeads)
          emitPhaseLog(
            ticketId,
            context.externalId,
            'CODING',
            'error',
            `Could not reset bead ${beadId} to bead start commit: ${err instanceof Error ? err.message : 'Unknown error'}`,
            { source: 'system', modelId: codingModelId, beadId },
          )
          throw err
        }

        const updated = mergeBeadRetryMetadata(beadsBeforeReset, beadId, {
          notes,
          iteration: nextIteration,
          status: 'pending',
          updatedAt: retryUpdatedAt,
        })
        writeTicketBeads(ticketId, updated)
        emitPhaseLog(
          ticketId,
          context.externalId,
          'CODING',
          'info',
          `Reset bead ${beadId} to its start snapshot and appended retry notes for attempt ${nextIteration}.`,
          { source: 'system', modelId: codingModelId, beadId },
        )
      },
    },
  ))
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
      beadId: nextBead.id,
      errors: result.errors,
    })
    sendEvent(result.errorCodes && result.errorCodes.length > 0
      ? { type: 'BEAD_ERROR', codes: result.errorCodes }
      : { type: 'BEAD_ERROR' })
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
    const gitResult = await withCommandLoggingFieldsAsync({ beadId: nextBead.id }, async () => commitBeadChanges(paths.worktreePath, nextBead.id, nextBead.title))
    if (gitResult.error) {
      emitPhaseLog(ticketId, context.externalId, 'CODING', 'info', `Git operation warning for bead ${nextBead.id}: ${gitResult.error}`, { source: 'system', modelId: codingModelId, beadId: nextBead.id })
    }
    if (gitResult.committed) {
      emitPhaseLog(ticketId, context.externalId, 'CODING', 'info', `Committed bead ${nextBead.id} changes${gitResult.pushed ? ' and pushed' : ' (push pending)'}`, { source: 'system', modelId: codingModelId, beadId: nextBead.id })
    }
  } catch (err) {
    emitPhaseLog(ticketId, context.externalId, 'CODING', 'info', `Could not commit bead changes: ${err instanceof Error ? err.message : 'Unknown error'}`, { source: 'system', modelId: codingModelId, beadId: nextBead.id })
  }

  // Capture code-only diff for this bead (excludes .ticket/** metadata)
  if (beadStartCommit) {
    try {
      const diffContent = await withCommandLoggingFieldsAsync({ beadId: nextBead.id }, async () => captureBeadDiff(paths.worktreePath, beadStartCommit))
      insertPhaseArtifact(ticketId, {
        phase: 'CODING',
        artifactType: `bead_diff:${nextBead.id}`,
        content: diffContent,
      })
    } catch (err) {
      emitPhaseLog(ticketId, context.externalId, 'CODING', 'info', `Could not capture bead diff: ${err instanceof Error ? err.message : 'Unknown error'}`, { source: 'system', modelId: codingModelId, beadId: nextBead.id })
    }
  }

  broadcaster.broadcast(ticketId, 'bead_complete', {
    ticketId,
    beadId: nextBead.id,
    title: nextBead.title,
    completed: completedBeads.filter(bead => bead.status === 'done').length,
    total: completedBeads.length,
  })

  emitPhaseLog(ticketId, context.externalId, 'CODING', 'bead_complete', `Completed bead ${nextBead.id}: ${nextBead.title}`, { source: 'system', modelId: codingModelId, beadId: nextBead.id })
  if (isAllComplete(completedBeads)) {
    sendEvent({ type: 'ALL_BEADS_DONE' })
  } else {
    sendEvent({ type: 'BEAD_COMPLETE' })
  }
    },
    (phase, type, content, data) => emitPhaseLog(ticketId, context.externalId, phase, type, content, { source: 'system', audience: 'all', ...(data ?? {}) }),
  )
}
