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
import { buildStructuredRetryPrompt } from '../../structuredOutput'
import { SessionManager } from '../../opencode/sessionManager'
import { BEAD_EXECUTION_TIMEOUT_MS, COUNCIL_RESPONSE_TIMEOUT_MS } from '../../lib/constants'
import { getStructuredRetryDecision } from '../../lib/structuredOutputRetry'
import { buildPromptFromTemplate, PROM_CODING, PROM51 } from '../../prompts/index'

const BEAD_STATUS_SCHEMA_REMINDER = [
  'Return exactly one <BEAD_STATUS>...</BEAD_STATUS> block and nothing else.',
  'Inside the marker, return a single JSON or YAML object with: bead_id, status, checks.',
  'checks must contain exactly: tests, lint, typecheck, qualitative.',
  'If work is complete, every check must be pass and status must be done.',
  'If work is not complete, return the same shape with status error and include a short reason field.',
].join('\n')

export interface ExecutionResult {
  beadId: string
  success: boolean
  iteration: number
  output: string
  errors: string[]
}

type ContextPartsInput = PromptPart[] | (() => Promise<PromptPart[]>)

async function resolveContextParts(input: ContextPartsInput): Promise<PromptPart[]> {
  if (typeof input === 'function') {
    return await input()
  }
  return input
}

async function generateContextWipeNote(
  adapter: OpenCodeAdapter,
  bead: Bead,
  projectPath: string,
  iterationErrors: string[],
  lastOutput: string,
  signal?: AbortSignal,
): Promise<string> {
  const errorContext: PromptPart = {
    type: 'text',
    source: 'error_context',
    content: [
      `## Failed Iteration Errors`,
      iterationErrors.join('\n'),
      '',
      `## Last Output (truncated)`,
      lastOutput.slice(0, 2000),
    ].join('\n'),
  }

  const beadData: PromptPart = {
    type: 'text',
    source: 'bead_data',
    content: JSON.stringify(bead, null, 2),
  }

  const promptContent = buildPromptFromTemplate(PROM51, [beadData, errorContext])
  const result = await runOpenCodePrompt({
    adapter,
    projectPath,
    parts: [{ type: 'text', content: promptContent }],
    signal,
    timeoutMs: COUNCIL_RESPONSE_TIMEOUT_MS,
  })

  return result.response
}

export async function executeBead(
  adapter: OpenCodeAdapter,
  bead: Bead,
  contextParts: ContextPartsInput,
  projectPath: string,
  maxIterations: number = PROFILE_DEFAULTS.maxIterations,
  timeout: number = BEAD_EXECUTION_TIMEOUT_MS,
  signal?: AbortSignal,
  callbacks?: {
    ticketId?: string
    model?: string
    variant?: string
    onSessionCreated?: (sessionId: string, iteration: number) => void
    onOpenCodeStreamEvent?: (entry: { sessionId: string; iteration: number; event: StreamEvent }) => void
    onPromptDispatched?: (entry: { sessionId: string; iteration: number; event: OpenCodePromptDispatchEvent }) => void
    onNotesUpdated?: (beadId: string, notes: string) => void
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
      const promptContent = buildPromptFromTemplate(PROM_CODING, await resolveContextParts(contextParts))
      const beadPrompt: PromptPart[] = [
        {
          type: 'text',
          content: promptContent,
        },
      ]

      const runBeadPrompt = () => runOpenCodePrompt({
        adapter,
        projectPath,
        parts: beadPrompt,
        signal,
        timeoutMs: timeout,
        model: callbacks?.model,
        variant: callbacks?.variant,
        toolPolicy: PROM_CODING.toolPolicy,
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
          activeSessionId = session.id
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

      let runResult = await runBeadPrompt()

      throwIfAborted(signal)
      activeSessionId = runResult.session.id
      lastOutput = runResult.response

      // Check completion
      let result = parseCompletionMarker(lastOutput)
      if (!result.complete) {
        const retryDecision = getStructuredRetryDecision(lastOutput, runResult.responseMeta)
        if (retryDecision.reuseSession) {
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
        } else {
          if (activeSessionId && sessionManager) {
            await sessionManager.abandonSession(activeSessionId)
            activeSessionId = null
          }
          runResult = await runBeadPrompt()
          throwIfAborted(signal)
          activeSessionId = runResult.session.id
          lastOutput = runResult.response
          result = parseCompletionMarker(lastOutput)
        }
      }

      if (activeSessionId && sessionManager) {
        await sessionManager.completeSession(activeSessionId)
        activeSessionId = null
      }

      if (result.complete && result.gatesValid) {
        return { beadId: bead.id, success: true, iteration, output: lastOutput, errors: [] }
      }

      errors.push(`Iteration ${iteration}: ${result.errors.join(', ') || 'Incomplete'}`)

      // Generate context wipe note via PROM51 in a fresh session
      try {
        const note = await generateContextWipeNote(adapter, bead, projectPath, errors, lastOutput, signal)
        if (note) {
          bead.notes = bead.notes ? `${bead.notes}\n\n---\n\n${note}` : note
          callbacks?.onNotesUpdated?.(bead.id, bead.notes)
        }
      } catch {
        // Non-blocking: if PROM51 fails, continue without notes
      }
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
