import type { OpenCodeAdapter } from '../../opencode/adapter'
import type { Bead } from '../beads/types'
import type { PromptPart, StreamEvent } from '../../opencode/types'
import { parseCompletionMarker } from './completionChecker'
import {
  runOpenCodePrompt,
  runOpenCodeSessionPrompt,
  type OpenCodePromptDispatchEvent,
} from '../../workflow/runOpenCodePrompt'
import { PROFILE_DEFAULTS } from '../../db/defaults'
import { throwIfAborted } from '../../council/types'
import { throwIfCancelled } from '../../lib/abort'
import { buildCompletionInstructions } from './completionSchema'
import { buildStructuredRetryPrompt } from '../../structuredOutput'
import { SessionManager } from '../../opencode/sessionManager'

const COMPLETION_INSTRUCTIONS = buildCompletionInstructions()
const BEAD_STATUS_SCHEMA_REMINDER = [
  'Return exactly one <BEAD_STATUS>...</BEAD_STATUS> block and nothing else.',
  'Inside the marker, return a single JSON or YAML object with: bead_id, status, checks.',
  'checks must contain exactly: tests, lint, typecheck, qualitative.',
  'If work is complete, every check must be pass and status must be completed.',
  'If work is not complete, return the same shape with status failed and include a short reason.',
].join('\n')

export interface ExecutionResult {
  beadId: string
  success: boolean
  iteration: number
  output: string
  errors: string[]
}

export async function executeBead(
  adapter: OpenCodeAdapter,
  bead: Bead,
  contextParts: PromptPart[],
  projectPath: string,
  maxIterations: number = PROFILE_DEFAULTS.maxIterations,
  timeout: number = 600000,
  signal?: AbortSignal,
  callbacks?: {
    ticketId?: string
    model?: string
    onSessionCreated?: (sessionId: string, iteration: number) => void
    onOpenCodeStreamEvent?: (entry: { sessionId: string; iteration: number; event: StreamEvent }) => void
    onPromptDispatched?: (entry: { sessionId: string; iteration: number; event: OpenCodePromptDispatchEvent }) => void
  },
): Promise<ExecutionResult> {
  let iteration = 0
  let lastOutput = ''
  const errors: string[] = []
  const sessionManager = callbacks?.ticketId ? new SessionManager(adapter) : null

  while (maxIterations <= 0 || iteration < maxIterations) {
    iteration++
    throwIfAborted(signal)
    let activeSessionId: string | null = null

    try {
      let sessionId = ''
      const beadPrompt: PromptPart[] = [
        ...contextParts,
        {
          type: 'text',
          content: [
            `## Active Bead`,
            `ID: ${bead.id}`,
            `Title: ${bead.title}`,
            'Use the bead_data and bead_notes context above as the source of truth for requirements, files, tests, and prior failures.',
            'Update the worktree until every required quality gate passes.',
            '',
            COMPLETION_INSTRUCTIONS,
          ].join('\n'),
        },
      ]

      const runResult = await runOpenCodePrompt({
        adapter,
        projectPath,
        parts: beadPrompt,
        signal,
        timeoutMs: timeout,
        model: callbacks?.model,
        ...(callbacks?.ticketId
          ? {
              sessionOwnership: {
                ticketId: callbacks.ticketId,
                phase: 'CODING',
                memberId: callbacks.model,
                beadId: bead.id,
                iteration,
                keepActive: true,
              },
            }
          : {}),
        onSessionCreated: (session) => {
          sessionId = session.id
          callbacks?.onSessionCreated?.(session.id, iteration)
        },
        onStreamEvent: (event) => {
          if (!sessionId) return
          callbacks?.onOpenCodeStreamEvent?.({
            sessionId,
            iteration,
            event,
          })
        },
        onPromptDispatched: (event) => {
          callbacks?.onPromptDispatched?.({
            sessionId: event.session.id,
            iteration,
            event,
          })
        },
      })

      throwIfAborted(signal)
      activeSessionId = runResult.session.id
      lastOutput = runResult.response

      // Check completion
      let result = parseCompletionMarker(lastOutput)
      if (!result.complete) {
        const retryParts = buildStructuredRetryPrompt([], {
          validationError: result.errors.join('; ') || 'Completion marker missing or invalid.',
          rawResponse: lastOutput,
          schemaReminder: BEAD_STATUS_SCHEMA_REMINDER,
        })
        const retryResult = await runOpenCodeSessionPrompt({
          adapter,
          session: runResult.session,
          parts: retryParts,
          signal,
          timeoutMs: timeout,
          model: callbacks?.model,
          ...(callbacks?.ticketId
            ? {
                sessionOwnership: {
                  ticketId: callbacks.ticketId,
                  phase: 'CODING',
                  memberId: callbacks.model,
                  beadId: bead.id,
                  iteration,
                  keepActive: true,
                },
              }
            : {}),
          onStreamEvent: (event) => {
            callbacks?.onOpenCodeStreamEvent?.({
              sessionId: runResult.session.id,
              iteration,
              event,
            })
          },
          onPromptDispatched: (event) => {
            callbacks?.onPromptDispatched?.({
              sessionId: event.session.id,
              iteration,
              event,
            })
          },
        })

        throwIfAborted(signal)
        lastOutput = retryResult.response
        result = parseCompletionMarker(lastOutput)
      }

      if (activeSessionId && sessionManager) {
        await sessionManager.completeSession(activeSessionId)
        activeSessionId = null
      }

      if (result.complete && result.gatesValid) {
        return { beadId: bead.id, success: true, iteration, output: lastOutput, errors: [] }
      }

      errors.push(`Iteration ${iteration}: ${result.errors.join(', ') || 'Incomplete'}`)
    } catch (err) {
      if (activeSessionId && sessionManager) {
        await sessionManager.abandonSession(activeSessionId)
      }
      throwIfCancelled(err, signal)
      const msg = err instanceof Error ? err.message : 'Unknown error'
      errors.push(`Iteration ${iteration}: ${msg}`)
    }
  }

  return {
    beadId: bead.id,
    success: false,
    iteration,
    output: lastOutput,
    errors,
  }
}
