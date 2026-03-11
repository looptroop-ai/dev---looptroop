import type { OpenCodeAdapter } from '../../opencode/adapter'
import type { Bead } from '../beads/types'
import type { PromptPart, StreamEvent } from '../../opencode/types'
import { parseCompletionMarker } from './completionChecker'
import { runOpenCodePrompt } from '../../workflow/runOpenCodePrompt'
import { PROFILE_DEFAULTS } from '../../db/defaults'
import { throwIfAborted } from '../../council/types'
import { throwIfCancelled } from '../../lib/abort'
import { buildCompletionInstructions } from './completionSchema'

const COMPLETION_INSTRUCTIONS = buildCompletionInstructions()

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
  },
): Promise<ExecutionResult> {
  let iteration = 0
  let lastOutput = ''
  const errors: string[] = []

  while (maxIterations <= 0 || iteration < maxIterations) {
    iteration++
    throwIfAborted(signal)

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
      })

      throwIfAborted(signal)
      lastOutput = runResult.response

      // Check completion
      const result = parseCompletionMarker(lastOutput)
      if (result.complete && result.gatesValid) {
        return { beadId: bead.id, success: true, iteration, output: lastOutput, errors: [] }
      }

      errors.push(`Iteration ${iteration}: ${result.errors.join(', ') || 'Incomplete'}`)
    } catch (err) {
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
