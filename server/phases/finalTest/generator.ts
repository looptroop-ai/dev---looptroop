import type { OpenCodeAdapter } from '../../opencode/adapter'
import type { PromptPart, StreamEvent } from '../../opencode/types'
import { buildPromptFromTemplate, PROM52 } from '../../prompts/index'
import {
  runOpenCodePrompt,
  runOpenCodeSessionPrompt,
  type OpenCodePromptDispatchEvent,
} from '../../workflow/runOpenCodePrompt'
import { throwIfAborted } from '../../council/types'
import { throwIfCancelled } from '../../lib/abort'
import { parseFinalTestCommands, type FinalTestCommandPlan } from './parser'
import { buildStructuredRetryPrompt } from '../../structuredOutput'
import { buildStructuredOutputMetadata } from '../../structuredOutput/metadata'
import { SessionManager } from '../../opencode/sessionManager'
import { COUNCIL_RESPONSE_TIMEOUT_MS } from '../../lib/constants'
import { getStructuredRetryDecision } from '../../lib/structuredOutputRetry'
import type { StructuredOutputMetadata } from '../../structuredOutput/types'
import { resolveStructuredRetryDiagnostic } from '../../lib/structuredRetryDiagnostics'

const FINAL_TEST_SCHEMA_REMINDER = [
  'Return exactly one <FINAL_TEST_COMMANDS>...</FINAL_TEST_COMMANDS> block and nothing else.',
  'Inside the marker, return a single JSON or YAML object with a non-empty commands field.',
  'commands must contain executable shell commands. A single command string is acceptable only if it is the full command to run.',
  'summary is optional.',
].join('\n')

export interface FinalTestGenerationResult {
  output: string
  commandPlan: FinalTestCommandPlan
  structuredOutput: StructuredOutputMetadata
}

export async function generateFinalTests(
  adapter: OpenCodeAdapter,
  ticketContext: PromptPart[],
  projectPath: string,
  signal?: AbortSignal,
  callbacks?: {
    ticketId?: string
    model?: string
    variant?: string
    timeoutMs?: number
    onSessionCreated?: (sessionId: string) => void
    onOpenCodeStreamEvent?: (entry: { sessionId: string; event: StreamEvent }) => void
    onPromptDispatched?: (entry: { sessionId: string; event: OpenCodePromptDispatchEvent }) => void
  },
): Promise<FinalTestGenerationResult> {
  const promptContent = buildPromptFromTemplate(PROM52, ticketContext)
  const promptParts = [{ type: 'text', content: promptContent }] as PromptPart[]
  let sessionId = ''
  let activeSessionId: string | null = null
  const sessionManager = callbacks?.ticketId ? new SessionManager(adapter) : null
  throwIfAborted(signal)
  let result: Awaited<ReturnType<typeof runOpenCodePrompt>>
  try {
    result = await runOpenCodePrompt({
      adapter,
      projectPath,
      parts: promptParts,
      signal,
      timeoutMs: callbacks?.timeoutMs ?? COUNCIL_RESPONSE_TIMEOUT_MS,
      model: callbacks?.model,
      variant: callbacks?.variant,
      toolPolicy: PROM52.toolPolicy,
      ...(callbacks?.ticketId
        ? {
            sessionOwnership: {
              ticketId: callbacks.ticketId,
              phase: 'RUNNING_FINAL_TEST',
              phaseAttempt: 1,
              keepActive: true,
              ...(callbacks.model ? { memberId: callbacks.model } : {}),
            },
          }
        : {}),
      onSessionCreated: (session) => {
        sessionId = session.id
        activeSessionId = session.id
        callbacks?.onSessionCreated?.(session.id)
      },
      onStreamEvent: (event) => {
        if (!sessionId) return
        callbacks?.onOpenCodeStreamEvent?.({
          sessionId,
          event,
        })
      },
      onPromptDispatched: (event) => {
        callbacks?.onPromptDispatched?.({
          sessionId: event.session.id,
          event,
        })
      },
    })
  } catch (error) {
    if (activeSessionId && sessionManager) {
      await sessionManager.abandonSession(activeSessionId)
    }
    throwIfCancelled(error, signal)
    throw error
  }
  throwIfAborted(signal)
  activeSessionId = result.session.id

  let response = result.response
  let commandPlan = parseFinalTestCommands(response)
  const retryDiagnostics: NonNullable<StructuredOutputMetadata['retryDiagnostics']> = []
  let structuredOutput = buildStructuredOutputMetadata({
    autoRetryCount: 0,
    repairApplied: Boolean(commandPlan.repairApplied),
    repairWarnings: commandPlan.repairWarnings ?? [],
    ...(commandPlan.validationError ? { validationError: commandPlan.validationError } : {}),
  })
  if (commandPlan.errors.length > 0) {
    const retryDecision = getStructuredRetryDecision(response, result.responseMeta)
    retryDiagnostics.push(resolveStructuredRetryDiagnostic({
      attempt: 1,
      rawResponse: response,
      validationError: commandPlan.validationError ?? commandPlan.errors.join('; '),
      failureClass: retryDecision.failureClass,
      retryDiagnostic: commandPlan.retryDiagnostic,
    }))
    structuredOutput = buildStructuredOutputMetadata(structuredOutput, {
      autoRetryCount: 1,
      validationError: commandPlan.validationError,
      retryDiagnostics,
    })
    try {
      if (retryDecision.reuseSession) {
        const retryParts = buildStructuredRetryPrompt([], {
          validationError: commandPlan.errors.join('; '),
          rawResponse: response,
          schemaReminder: FINAL_TEST_SCHEMA_REMINDER,
        })
        const retryResult = await runOpenCodeSessionPrompt({
          adapter,
          session: result.session,
          parts: retryParts,
          signal,
          timeoutMs: callbacks?.timeoutMs ?? COUNCIL_RESPONSE_TIMEOUT_MS,
          model: callbacks?.model,
          toolPolicy: PROM52.toolPolicy,
          onStreamEvent: (event) => {
            if (!sessionId) return
            callbacks?.onOpenCodeStreamEvent?.({
              sessionId,
              event,
            })
          },
          onPromptDispatched: (event) => {
            callbacks?.onPromptDispatched?.({
              sessionId: event.session.id,
              event,
            })
          },
        })
        throwIfAborted(signal)
        response = retryResult.response
      } else {
        if (activeSessionId && sessionManager) {
          await sessionManager.abandonSession(activeSessionId)
          activeSessionId = null
        }
        result = await runOpenCodePrompt({
          adapter,
          projectPath,
          parts: promptParts,
          signal,
          timeoutMs: callbacks?.timeoutMs ?? COUNCIL_RESPONSE_TIMEOUT_MS,
          model: callbacks?.model,
          variant: callbacks?.variant,
          toolPolicy: PROM52.toolPolicy,
          ...(callbacks?.ticketId
            ? {
                sessionOwnership: {
                  ticketId: callbacks.ticketId,
                  phase: 'RUNNING_FINAL_TEST',
                  phaseAttempt: 1,
                  keepActive: true,
                  ...(callbacks.model ? { memberId: callbacks.model } : {}),
                },
              }
            : {}),
          onSessionCreated: (session) => {
            sessionId = session.id
            activeSessionId = session.id
            callbacks?.onSessionCreated?.(session.id)
          },
          onStreamEvent: (event) => {
            if (!sessionId) return
            callbacks?.onOpenCodeStreamEvent?.({
              sessionId,
              event,
            })
          },
          onPromptDispatched: (event) => {
            callbacks?.onPromptDispatched?.({
              sessionId: event.session.id,
              event,
            })
          },
        })
        throwIfAborted(signal)
        activeSessionId = result.session.id
        response = result.response
      }
    } catch (error) {
      if (activeSessionId && sessionManager) {
        await sessionManager.abandonSession(activeSessionId)
        activeSessionId = null
      }
      throwIfCancelled(error, signal)
      throw error
    }

    commandPlan = parseFinalTestCommands(response)
    structuredOutput = buildStructuredOutputMetadata(structuredOutput, {
      repairApplied: Boolean(commandPlan.repairApplied),
      repairWarnings: commandPlan.repairWarnings ?? [],
      ...(commandPlan.validationError ? { validationError: commandPlan.validationError } : {}),
    })
    if (commandPlan.errors.length > 0) {
      retryDiagnostics.push(resolveStructuredRetryDiagnostic({
        attempt: 2,
        rawResponse: response,
        validationError: commandPlan.validationError ?? commandPlan.errors.join('; '),
        retryDiagnostic: commandPlan.retryDiagnostic,
      }))
      structuredOutput = buildStructuredOutputMetadata(structuredOutput, {
        retryDiagnostics,
      })
    }
  }

  if (activeSessionId && sessionManager) {
    await sessionManager.completeSession(activeSessionId)
  }

  return {
    output: response,
    commandPlan,
    structuredOutput,
  }
}
