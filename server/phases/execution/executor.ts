import type { OpenCodeAdapter } from '../../opencode/adapter'
import type { Bead } from '../beads/types'
import type { PromptPart } from '../../opencode/types'
import { parseCompletionMarker } from './completionChecker'

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
  maxIterations: number = 5,
  timeout: number = 600000,
): Promise<ExecutionResult> {
  let iteration = 0
  let lastOutput = ''
  const errors: string[] = []

  while (iteration < maxIterations) {
    iteration++

    try {
      // Fresh session per attempt
      const session = await adapter.createSession(projectPath)

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

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Execution timeout')), timeout),
      )

      const execPromise = adapter.promptSession(session.id, beadPrompt)

      lastOutput = await Promise.race([execPromise, timeoutPromise])

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
