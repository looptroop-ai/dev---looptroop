import type { OpenCodeAdapter } from '../../opencode/adapter'
import type { Bead } from '../beads/types'
import type { Message, PromptPart, Session, StreamEvent } from '../../opencode/types'
import { parseCompletionMarker } from './completionChecker'
import {
  runOpenCodePrompt,
  runOpenCodeSessionPrompt,
  type OpenCodePromptCompletedEvent,
  type OpenCodePromptDispatchEvent,
} from '../../workflow/runOpenCodePrompt'
import { PROFILE_DEFAULTS } from '../../db/defaults'
import { throwIfAborted } from '../../council/types'
import { throwIfCancelled } from '../../lib/abort'
import { buildStructuredRetryPrompt } from '../../structuredOutput'
import { SessionManager } from '../../opencode/sessionManager'
import { COUNCIL_RESPONSE_TIMEOUT_MS } from '../../lib/constants'
import { getStructuredRetryDecision } from '../../lib/structuredOutputRetry'
import { buildPromptFromTemplate, buildSameSessionPromptFromTemplate, PROM_CODING, PROM51 } from '../../prompts/index'
import { BEAD_RETRY_BUDGET_EXHAUSTED } from '../../../shared/errorCodes'

const BEAD_STATUS_SCHEMA_REMINDER = [
  'Return exactly one <BEAD_STATUS>...</BEAD_STATUS> block and nothing else.',
  'Inside the marker, return a single JSON or YAML object with: bead_id, status, checks.',
  'checks must contain exactly: tests, lint, typecheck, qualitative.',
  'If work is complete, every check must be pass and status must be done.',
  'If work is not complete, return the same shape with status error and include a short reason field.',
].join('\n')

const CONTINUE_CODING_SCHEMA_REMINDER = [
  'Continue working in this same session until the bead is actually complete.',
  'Do not stop because lint, tests, or typecheck failed; inspect the real failures, fix them, and rerun the same checks.',
  'Do not reply with a plain-text progress update or plan. Keep using tools and continue working until you can return the final marker.',
  'Do not return status error while iteration time remains unless the app interrupts you.',
  'Return exactly one <BEAD_STATUS>...</BEAD_STATUS> block and nothing else when all required checks pass.',
  'Inside the final marker, use status done and checks.tests/lint/typecheck/qualitative = pass.',
].join('\n')

export interface ExecutionResult {
  beadId: string
  success: boolean
  iteration: number
  output: string
  errors: string[]
  errorCodes?: string[]
}

type ContextPartsInput = PromptPart[] | (() => Promise<PromptPart[]>)
type CodingPromptStage =
  | 'coding_main'
  | 'coding_continue'
  | 'coding_structured_retry'
  | 'context_wipe_note'

async function resolveContextParts(input: ContextPartsInput): Promise<PromptPart[]> {
  if (typeof input === 'function') {
    return await input()
  }
  return input
}

function getRemainingTimeoutMs(deadlineAt: number): number {
  return Math.max(0, deadlineAt - Date.now())
}

function buildContinuationPrompt(
  beadId: string,
  errors: string[],
  previousResponse: string,
): PromptPart[] {
  const failureSummary = errors.join('; ') || 'Completion marker was not accepted.'
  const prompt = [
    '## Continue Bead Execution',
    '',
    `Bead: ${beadId}`,
    '',
    'The current bead attempt is still in progress. Do not stop yet.',
    'Inspect the real failures, keep editing code in this same session, rerun the failing checks, and continue until the bead is actually complete or the app interrupts you.',
    '',
    `Current blocker summary: ${failureSummary}`,
    '',
    CONTINUE_CODING_SCHEMA_REMINDER,
    '',
    'Previous response:',
    '```',
    previousResponse,
    '```',
  ].join('\n')
  return [{ type: 'text', content: prompt }]
}

function shouldUseStructuredRetry(result: ReturnType<typeof parseCompletionMarker>): boolean {
  return !result.complete && (!result.markerFound || Boolean(result.validationError))
}

function truncateForNote(text: string, maxLength = 600): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength)}...`
}

function extractRecentFailureExcerpts(messages: Message[], maxItems = 5): string[] {
  const excerpts: string[] = []

  for (let messageIndex = messages.length - 1; messageIndex >= 0 && excerpts.length < maxItems; messageIndex -= 1) {
    const message = messages[messageIndex]
    const parts = Array.isArray(message?.parts) ? message.parts : []
    for (let partIndex = parts.length - 1; partIndex >= 0 && excerpts.length < maxItems; partIndex -= 1) {
      const part = parts[partIndex]
      if (part?.type !== 'tool') continue
      const toolName = typeof part.tool === 'string' ? part.tool : 'tool'
      const state = typeof part.state === 'object' && part.state !== null
        ? part.state as {
            status?: string
            error?: string
            output?: string
          }
        : null
      const status = state?.status
      const rawDetails = typeof state?.error === 'string'
        ? state.error
        : typeof state?.output === 'string'
          ? state.output
          : ''
      const details = truncateForNote(rawDetails, 320)
      const looksFailing = status === 'error' || /fail|error|exception|not ok|timed out/i.test(rawDetails)
      if (!looksFailing) continue
      excerpts.push(`${toolName} (${status ?? 'unknown'}): ${details || 'No details captured.'}`)
    }
  }

  return excerpts
}

function buildFallbackContextWipeNote(options: {
  iteration: number
  errors: string[]
  recentFailureExcerpts: string[]
  lastOutput: string
}): string {
  const lines = [
    `Attempt ${options.iteration} failed or stalled before completion.`,
    `Errors: ${options.errors.join(' | ') || 'No explicit error recorded.'}`,
  ]

  if (options.recentFailureExcerpts.length > 0) {
    lines.push(`Recent failures: ${options.recentFailureExcerpts.join(' | ')}`)
  }

  const lastOutput = truncateForNote(options.lastOutput, 500)
  if (lastOutput) {
    lines.push(`Last model output: ${lastOutput}`)
  }

  lines.push('Next attempt: start from the clean bead snapshot, rerun the failing checks, and do not stop until every required gate passes or the app times out the iteration.')
  return lines.join('\n')
}

async function generateContextWipeNote(
  adapter: OpenCodeAdapter,
  session: Session,
  bead: Bead,
  iterationErrors: string[],
  lastOutput: string,
  recentFailureExcerpts: string[],
  signal?: AbortSignal,
  options?: {
    model?: string
    variant?: string
    iteration?: number
    onOpenCodeStreamEvent?: (entry: { sessionId: string; iteration: number; event: StreamEvent }) => void
    onPromptDispatched?: (entry: { sessionId: string; iteration: number; event: OpenCodePromptDispatchEvent }) => void
    onPromptCompleted?: (entry: { iteration: number; stage: CodingPromptStage; event: OpenCodePromptCompletedEvent }) => void
  },
): Promise<string> {
  const errorContext: PromptPart = {
    type: 'text',
    source: 'error_context',
    content: [
      `## Failed Iteration Errors`,
      iterationErrors.join('\n'),
      '',
      `## Recent Failure Excerpts`,
      recentFailureExcerpts.length > 0 ? recentFailureExcerpts.map((entry) => `- ${entry}`).join('\n') : 'No recent failing tool or test excerpts captured.',
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

  const promptContent = buildSameSessionPromptFromTemplate(PROM51, [beadData, errorContext])
  const result = await runOpenCodeSessionPrompt({
    adapter,
    session,
    parts: [{ type: 'text', content: promptContent }],
    signal,
    timeoutMs: COUNCIL_RESPONSE_TIMEOUT_MS,
    model: options?.model,
    variant: options?.variant,
    erroredSessionPolicy: 'discard_errored_session_output',
    toolPolicy: PROM51.toolPolicy,
    onStreamEvent: (event) => {
      if (options?.iteration == null) return
      options.onOpenCodeStreamEvent?.({
        sessionId: session.id,
        iteration: options.iteration,
        event,
      })
    },
    onPromptDispatched: (event) => {
      if (options?.iteration == null) return
      options.onPromptDispatched?.({
        sessionId: event.session.id,
        iteration: options.iteration,
        event,
      })
    },
    onPromptCompleted: (event) => {
      if (options?.iteration == null) return
      options.onPromptCompleted?.({
        iteration: options.iteration,
        stage: 'context_wipe_note',
        event,
      })
    },
  })

  return result.response.trim()
}

export async function executeBead(
  adapter: OpenCodeAdapter,
  bead: Bead,
  contextParts: ContextPartsInput,
  projectPath: string,
  maxIterations: number = PROFILE_DEFAULTS.maxIterations,
  timeout: number = PROFILE_DEFAULTS.perIterationTimeout,
  signal?: AbortSignal,
  callbacks?: {
    ticketId?: string
    model?: string
    variant?: string
    onSessionCreated?: (sessionId: string, iteration: number) => void
    onOpenCodeStreamEvent?: (entry: { sessionId: string; iteration: number; event: StreamEvent }) => void
    onPromptDispatched?: (entry: { sessionId: string; iteration: number; event: OpenCodePromptDispatchEvent }) => void
    onPromptCompleted?: (entry: { iteration: number; stage: CodingPromptStage; event: OpenCodePromptCompletedEvent }) => void
    onContextWipe?: (entry: { beadId: string; notes: string; iteration: number }) => Promise<void>
  },
): Promise<ExecutionResult> {
  const startingIteration = Number.isInteger(bead.iteration) && bead.iteration > 0
    ? bead.iteration
    : 1
  const maxAttemptIteration = maxIterations > 0
    ? startingIteration + maxIterations - 1
    : null
  let iteration = startingIteration
  let lastAttemptIteration = startingIteration - 1
  let lastOutput = ''
  const errors: string[] = []
  const sessionManager = callbacks?.ticketId ? new SessionManager(adapter) : null

  while (maxAttemptIteration == null || iteration <= maxAttemptIteration) {
    lastAttemptIteration = iteration
    throwIfAborted(signal)
    let activeSessionId: string | null = null
    let activeSession: Session | null = null
    const iterationErrors: string[] = []
    let latestMessages: Message[] = []
    const deadlineAt = Date.now() + timeout

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
        timeoutMs: getRemainingTimeoutMs(deadlineAt),
        model: callbacks?.model,
        variant: callbacks?.variant,
        erroredSessionPolicy: 'discard_errored_session_output',
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
          activeSession = session
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
        onPromptCompleted: (event) => {
          callbacks?.onPromptCompleted?.({
            iteration,
            stage: 'coding_main',
            event,
          })
        },
      })

      let runResult = await runBeadPrompt()

      while (true) {
        throwIfAborted(signal)
        activeSessionId = runResult.session.id
        activeSession = runResult.session
        lastOutput = runResult.response
        latestMessages = runResult.messages

        const result = parseCompletionMarker(lastOutput)
        if (result.complete && result.gatesValid) {
          if (activeSessionId && sessionManager) {
            await sessionManager.completeSession(activeSessionId)
            activeSessionId = null
          }
          activeSession = null
          return { beadId: bead.id, success: true, iteration, output: lastOutput, errors: [] }
        }

        const incompleteSummary = result.errors.join(', ') || 'Incomplete'
        if (!iterationErrors.includes(incompleteSummary)) {
          iterationErrors.push(incompleteSummary)
        }

        const remainingMs = getRemainingTimeoutMs(deadlineAt)
        if (remainingMs <= 0) {
          throw new Error('Timeout')
        }

        if (shouldUseStructuredRetry(result)) {
          const retryDecision = getStructuredRetryDecision(lastOutput, runResult.responseMeta)
          if (retryDecision.reuseSession) {
            const retryParts = buildStructuredRetryPrompt([], {
              validationError: result.errors.join('; ') || 'Completion marker missing or invalid.',
              rawResponse: lastOutput,
              schemaReminder: BEAD_STATUS_SCHEMA_REMINDER,
            })
            runResult = await runOpenCodeSessionPrompt({
              adapter,
              session: runResult.session,
              parts: retryParts,
              signal,
              timeoutMs: remainingMs,
              model: callbacks?.model,
              erroredSessionPolicy: 'discard_errored_session_output',
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
              onPromptCompleted: (event) => {
                callbacks?.onPromptCompleted?.({
                  iteration,
                  stage: 'coding_structured_retry',
                  event,
                })
              },
            })
            continue
          }

          if (activeSessionId && sessionManager) {
            await sessionManager.abandonSession(activeSessionId)
            activeSessionId = null
          }
          activeSession = null
          runResult = await runBeadPrompt()
          continue
        }

        runResult = await runOpenCodeSessionPrompt({
          adapter,
          session: runResult.session,
          parts: buildContinuationPrompt(bead.id, result.errors, lastOutput),
          signal,
          timeoutMs: remainingMs,
          model: callbacks?.model,
          variant: callbacks?.variant,
          erroredSessionPolicy: 'discard_errored_session_output',
          toolPolicy: PROM_CODING.toolPolicy,
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
          onPromptCompleted: (event) => {
            callbacks?.onPromptCompleted?.({
              iteration,
              stage: 'coding_continue',
              event,
            })
          },
        })
      }
    } catch (err) {
      throwIfCancelled(err, signal)
      const msg = err instanceof Error ? err.message : 'Unknown error'
      iterationErrors.push(msg)
    }

    if (iterationErrors.length === 0) {
      iterationErrors.push('Incomplete')
    }

    const formattedIterationErrors = iterationErrors.map((msg) => `Iteration ${iteration}: ${msg}`)
    errors.push(...formattedIterationErrors)

    const contextWipeSession = activeSession
    const contextWipeSessionId = activeSessionId
    activeSession = null
    activeSessionId = null

    const recentFailureExcerpts = extractRecentFailureExcerpts(latestMessages)
    let note = ''
    try {
      if (contextWipeSession) {
        note = await generateContextWipeNote(
          adapter,
          contextWipeSession,
          bead,
          formattedIterationErrors,
          lastOutput,
          recentFailureExcerpts,
          signal,
          {
            model: callbacks?.model,
            variant: callbacks?.variant,
            iteration,
            onOpenCodeStreamEvent: callbacks?.onOpenCodeStreamEvent,
            onPromptDispatched: callbacks?.onPromptDispatched,
            onPromptCompleted: callbacks?.onPromptCompleted,
          },
        )
      }
    } catch {
      // Best effort only; deterministic fallback note below keeps the retry durable.
    }

    const effectiveNote = note || buildFallbackContextWipeNote({
      iteration,
      errors: formattedIterationErrors,
      recentFailureExcerpts,
      lastOutput,
    })

    const noteHeader = `[Iteration ${iteration} — ${new Date().toISOString()}]`
    const stampedNote = `${noteHeader}\n${effectiveNote}`
    bead.notes = bead.notes ? `${bead.notes}\n\n---\n\n${stampedNote}` : stampedNote
    try {
      await callbacks?.onContextWipe?.({
        beadId: bead.id,
        notes: bead.notes,
        iteration,
      })
    } finally {
      if (contextWipeSessionId && sessionManager) {
        await sessionManager.abandonSession(contextWipeSessionId)
      }
    }
    throwIfAborted(signal)

    if (maxAttemptIteration !== null && iteration >= maxAttemptIteration) {
      break
    }
    iteration++
  }

  if (maxAttemptIteration !== null && lastAttemptIteration >= maxAttemptIteration) {
    errors.push(`Reached the configured per-bead retry budget at iteration ${lastAttemptIteration}.`)
  }

  return {
    beadId: bead.id,
    success: false,
    iteration: lastAttemptIteration,
    output: lastOutput,
    errors,
    ...(maxAttemptIteration !== null && lastAttemptIteration >= maxAttemptIteration
      ? { errorCodes: [BEAD_RETRY_BUDGET_EXHAUSTED] }
      : {}),
  }
}
