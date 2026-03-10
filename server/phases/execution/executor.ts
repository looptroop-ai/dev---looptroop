import type { OpenCodeAdapter } from '../../opencode/adapter'
import type { Bead } from '../beads/types'
import type { PromptPart, StreamEvent } from '../../opencode/types'
import { parseCompletionMarker } from './completionChecker'
import { runOpenCodePrompt } from '../../workflow/runOpenCodePrompt'
import { PROFILE_DEFAULTS } from '../../db/defaults'

const COMPLETION_INSTRUCTIONS = [
  'When complete, output a <BEAD_STATUS>COMPLETE</BEAD_STATUS> marker.',
  'If you cannot complete, output <BEAD_STATUS>FAILED: reason</BEAD_STATUS>.',
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
  callbacks?: {
    model?: string
    onSessionCreated?: (sessionId: string, iteration: number) => void
    onOpenCodeStreamEvent?: (entry: { sessionId: string; iteration: number; event: StreamEvent }) => void
  },
): Promise<ExecutionResult> {
  let iteration = 0
  let lastOutput = ''
  const errors: string[] = []

  while (iteration < maxIterations) {
    iteration++

    try {
      let sessionId = ''
      const beadPrompt: PromptPart[] = [
        ...contextParts,
        {
          type: 'text',
          content: [
            `## Bead: ${bead.title}`,
            `ID: ${bead.id}`,
            `Description: ${bead.description}`,
            `Acceptance Criteria:`,
            ...bead.acceptanceCriteria.map((ac) => `- ${ac}`),
            `Tests:`,
            ...bead.tests.map((t) => `- ${t}`),
            `Test Commands:`,
            ...bead.testCommands.map((c) => `- ${c}`),
            '',
            COMPLETION_INSTRUCTIONS,
          ].join('\n'),
        },
      ]

      const runResult = await runOpenCodePrompt({
        adapter,
        projectPath,
        parts: beadPrompt,
        timeoutMs: timeout,
        model: callbacks?.model,
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

      lastOutput = runResult.response

      // Check completion
      const result = parseCompletionMarker(lastOutput)
      if (result.complete && result.gatesValid) {
        return { beadId: bead.id, success: true, iteration, output: lastOutput, errors: [] }
      }

      errors.push(`Iteration ${iteration}: ${result.errors.join(', ') || 'Incomplete'}`)
    } catch (err) {
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
