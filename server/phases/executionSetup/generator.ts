import type { OpenCodeAdapter } from '../../opencode/adapter'
import type { PromptPart, Session, StreamEvent } from '../../opencode/types'
import { buildPromptFromTemplate, PROM_EXECUTION_SETUP } from '../../prompts/index'
import {
  runOpenCodePrompt,
  runOpenCodeSessionPrompt,
  type OpenCodePromptCompletedEvent,
  type OpenCodePromptDispatchEvent,
} from '../../workflow/runOpenCodePrompt'
import { throwIfAborted } from '../../council/types'
import { throwIfCancelled } from '../../lib/abort'
import { buildStructuredRetryPrompt } from '../../structuredOutput'
import { buildStructuredOutputMetadata } from '../../structuredOutput/metadata'
import { SessionManager } from '../../opencode/sessionManager'
import { COUNCIL_RESPONSE_TIMEOUT_MS } from '../../lib/constants'
import { classifyStructuredFailureFromError, getStructuredRetryDecision } from '../../lib/structuredOutputRetry'
import { resolveStructuredRetryDiagnostic } from '../../lib/structuredRetryDiagnostics'
import type { StructuredOutputMetadata } from '../../structuredOutput/types'
import { parseExecutionSetupResult } from './parser'
import type { ExecutionSetupGenerationResult } from './types'

const EXECUTION_SETUP_SCHEMA_REMINDER = [
  'Return exactly one <EXECUTION_SETUP_RESULT>...</EXECUTION_SETUP_RESULT> block and nothing else.',
  'Inside the marker, return a single JSON or YAML object with top-level keys: status, summary, profile, checks.',
  'status must be ready.',
  'profile.artifact must be execution_setup_profile.',
  'profile.temp_roots and profile.reusable_artifacts[].path may name any repository-local or tool-cache path used by setup.',
  'checks must contain exactly: workspace, tooling, temp_scope, policy.',
].join('\n')

type ExecutionSetupPromptStage =
  | 'execution_setup_main'
  | 'execution_setup_structured_retry'

export type GenerateExecutionSetupResult = ExecutionSetupGenerationResult

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function buildPromptFailureGeneration(
  session: Session,
  error: unknown,
  previousDiagnostics: NonNullable<StructuredOutputMetadata['retryDiagnostics']> = [],
): GenerateExecutionSetupResult {
  const validationError = `Execution setup prompt failed: ${errorMessage(error)}`
  const retryDiagnostics = [
    ...previousDiagnostics,
    resolveStructuredRetryDiagnostic({
      attempt: previousDiagnostics.length + 1,
      rawResponse: '',
      validationError,
      failureClass: classifyStructuredFailureFromError(error),
    }),
  ]

  return {
    session,
    output: '',
    result: null,
    parse: {
      markerFound: false,
      result: null,
      errors: [validationError],
      validationError,
    },
    structuredOutput: buildStructuredOutputMetadata({
      autoRetryCount: retryDiagnostics.length,
      validationError,
      retryDiagnostics,
    }),
  }
}

export async function generateExecutionSetup(
  adapter: OpenCodeAdapter,
  ticketContext: PromptPart[],
  projectPath: string,
  signal?: AbortSignal,
  callbacks?: {
    ticketId?: string
    model?: string
    variant?: string
    timeoutMs?: number
    phaseAttempt?: number
    onSessionCreated?: (sessionId: string) => void
    onOpenCodeStreamEvent?: (entry: { sessionId: string; event: StreamEvent }) => void
    onPromptDispatched?: (entry: { sessionId: string; event: OpenCodePromptDispatchEvent }) => void
    onPromptCompleted?: (entry: { stage: ExecutionSetupPromptStage; event: OpenCodePromptCompletedEvent }) => void
  },
): Promise<GenerateExecutionSetupResult> {
  const promptContent = buildPromptFromTemplate(PROM_EXECUTION_SETUP, ticketContext)
  const promptParts = [{ type: 'text', content: promptContent }] as PromptPart[]
  let sessionId = ''
  let activeSessionId: string | null = null
  let activeSession: Session | null = null
  const sessionManager = callbacks?.ticketId ? new SessionManager(adapter) : null
  throwIfAborted(signal)

  const runMainSetupPrompt = async () => await runOpenCodePrompt({
    adapter,
    projectPath,
    parts: promptParts,
    signal,
    timeoutMs: callbacks?.timeoutMs ?? COUNCIL_RESPONSE_TIMEOUT_MS,
    model: callbacks?.model,
    variant: callbacks?.variant,
    erroredSessionPolicy: 'discard_errored_session_output',
    toolPolicy: PROM_EXECUTION_SETUP.toolPolicy,
    ...(callbacks?.ticketId
      ? {
          sessionOwnership: {
            ticketId: callbacks.ticketId,
            phase: 'PREPARING_EXECUTION_ENV',
            phaseAttempt: callbacks.phaseAttempt ?? 1,
            keepActive: true,
            ...(callbacks.model ? { memberId: callbacks.model } : {}),
          },
        }
      : {}),
    onSessionCreated: (session) => {
      sessionId = session.id
      activeSessionId = session.id
      activeSession = session
      callbacks?.onSessionCreated?.(session.id)
    },
    onStreamEvent: (event) => {
      if (!sessionId) return
      callbacks?.onOpenCodeStreamEvent?.({ sessionId, event })
    },
    onPromptDispatched: (event) => {
      callbacks?.onPromptDispatched?.({ sessionId: event.session.id, event })
    },
    onPromptCompleted: (event) => {
      callbacks?.onPromptCompleted?.({ stage: 'execution_setup_main', event })
    },
  })

  let result: Awaited<ReturnType<typeof runMainSetupPrompt>>
  try {
    result = await runMainSetupPrompt()
  } catch (error) {
    throwIfCancelled(error, signal)
    if (activeSessionId && sessionManager) {
      await sessionManager.abandonSession(activeSessionId)
      activeSessionId = null
      activeSession = null
    }

    try {
      result = await runMainSetupPrompt()
    } catch (retryError) {
      throwIfCancelled(retryError, signal)
      if (!activeSession) {
        throw retryError
      }
      return buildPromptFailureGeneration(
        activeSession,
        retryError,
        [
          resolveStructuredRetryDiagnostic({
            attempt: 1,
            rawResponse: '',
            validationError: `Execution setup prompt failed: ${errorMessage(error)}`,
            failureClass: classifyStructuredFailureFromError(error),
          }),
        ],
      )
    }
  }

  throwIfAborted(signal)
  activeSessionId = result.session.id
  activeSession = result.session

  let response = result.response
  let parsed = parseExecutionSetupResult(response)
  const retryDiagnostics: NonNullable<StructuredOutputMetadata['retryDiagnostics']> = []
  let structuredOutput = buildStructuredOutputMetadata({
    autoRetryCount: 0,
    repairApplied: Boolean(parsed.repairApplied),
    repairWarnings: parsed.repairWarnings ?? [],
    ...(parsed.validationError ? { validationError: parsed.validationError } : {}),
  })

  if (parsed.errors.length > 0) {
    const retryDecision = getStructuredRetryDecision(response, result.responseMeta)
    retryDiagnostics.push(resolveStructuredRetryDiagnostic({
      attempt: 1,
      rawResponse: response,
      validationError: parsed.validationError ?? parsed.errors.join('; '),
      failureClass: retryDecision.failureClass,
      retryDiagnostic: parsed.retryDiagnostic,
    }))
    structuredOutput = buildStructuredOutputMetadata(structuredOutput, {
      autoRetryCount: 1,
      validationError: parsed.validationError,
      retryDiagnostics,
    })

    try {
      if (retryDecision.reuseSession) {
        const retryParts = buildStructuredRetryPrompt([], {
          validationError: parsed.errors.join('; '),
          rawResponse: response,
          schemaReminder: EXECUTION_SETUP_SCHEMA_REMINDER,
        })
        const retryResult = await runOpenCodeSessionPrompt({
          adapter,
          session: result.session,
          parts: retryParts,
          signal,
          timeoutMs: callbacks?.timeoutMs ?? COUNCIL_RESPONSE_TIMEOUT_MS,
          model: callbacks?.model,
          erroredSessionPolicy: 'discard_errored_session_output',
          toolPolicy: PROM_EXECUTION_SETUP.toolPolicy,
          onStreamEvent: (event) => {
            if (!sessionId) return
            callbacks?.onOpenCodeStreamEvent?.({ sessionId, event })
          },
          onPromptDispatched: (event) => {
            callbacks?.onPromptDispatched?.({ sessionId: event.session.id, event })
          },
          onPromptCompleted: (event) => {
            callbacks?.onPromptCompleted?.({ stage: 'execution_setup_structured_retry', event })
          },
        })
        throwIfAborted(signal)
        response = retryResult.response
      } else {
        if (activeSessionId && sessionManager) {
          await sessionManager.abandonSession(activeSessionId)
          activeSessionId = null
          activeSession = null
        }
        result = await runOpenCodePrompt({
          adapter,
          projectPath,
          parts: promptParts,
          signal,
          timeoutMs: callbacks?.timeoutMs ?? COUNCIL_RESPONSE_TIMEOUT_MS,
          model: callbacks?.model,
          variant: callbacks?.variant,
          erroredSessionPolicy: 'discard_errored_session_output',
          toolPolicy: PROM_EXECUTION_SETUP.toolPolicy,
          ...(callbacks?.ticketId
            ? {
                sessionOwnership: {
                  ticketId: callbacks.ticketId,
                  phase: 'PREPARING_EXECUTION_ENV',
                  phaseAttempt: callbacks.phaseAttempt ?? 1,
                  keepActive: true,
                  ...(callbacks.model ? { memberId: callbacks.model } : {}),
                },
              }
            : {}),
          onSessionCreated: (session) => {
            sessionId = session.id
            activeSessionId = session.id
            activeSession = session
            callbacks?.onSessionCreated?.(session.id)
          },
          onStreamEvent: (event) => {
            if (!sessionId) return
            callbacks?.onOpenCodeStreamEvent?.({ sessionId, event })
          },
          onPromptDispatched: (event) => {
            callbacks?.onPromptDispatched?.({ sessionId: event.session.id, event })
          },
          onPromptCompleted: (event) => {
            callbacks?.onPromptCompleted?.({ stage: 'execution_setup_main', event })
          },
        })
        throwIfAborted(signal)
        activeSessionId = result.session.id
        activeSession = result.session
        response = result.response
      }
    } catch (error) {
      throwIfCancelled(error, signal)
      if (!activeSession) {
        throw error
      }
      return buildPromptFailureGeneration(activeSession, error, retryDiagnostics)
    }

    parsed = parseExecutionSetupResult(response)
    structuredOutput = buildStructuredOutputMetadata(structuredOutput, {
      repairApplied: Boolean(parsed.repairApplied),
      repairWarnings: parsed.repairWarnings ?? [],
      ...(parsed.validationError ? { validationError: parsed.validationError } : {}),
    })
    if (parsed.errors.length > 0) {
      retryDiagnostics.push(resolveStructuredRetryDiagnostic({
        attempt: 2,
        rawResponse: response,
        validationError: parsed.validationError ?? parsed.errors.join('; '),
        retryDiagnostic: parsed.retryDiagnostic,
      }))
      structuredOutput = buildStructuredOutputMetadata(structuredOutput, {
        retryDiagnostics,
      })
    }
  }

  if (!activeSession) {
    throw new Error('Execution setup session was not available after prompt completion')
  }

  return {
    session: activeSession,
    output: response,
    result: parsed.result,
    parse: parsed,
    structuredOutput,
  }
}
