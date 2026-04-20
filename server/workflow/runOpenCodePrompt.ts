import type { OpenCodeAdapter } from '../opencode/adapter'
import {
  analyzeAssistantMessages,
  type OpenCodeResponseMeta,
} from '../opencode/assistantMessageAnalysis'
import type {
  Message,
  SessionErrorStreamEvent,
  OpenCodeSessionCreateOptions,
  PromptPart,
  PromptSessionOptions,
  Session,
  StreamEvent,
} from '../opencode/types'
import { OPENCODE_EXECUTION_YOLO_PERMISSIONS } from '../opencode/permissions'
import type { OpenCodeToolPolicy } from '../opencode/toolPolicy'
import { parseModelRef } from '../opencode/types'
import { SessionManager, type SessionOwnership } from '../opencode/sessionManager'
import { resolveOpenCodeTools } from '../opencode/toolPolicy'
import { PROMPT_MIN_TIMEOUT_MS, PROMPT_MAX_TIMEOUT_MS } from '../lib/constants'

export interface OpenCodeRunCallbacks {
  onSessionCreated?: (session: Session) => void
  onPromptDispatched?: (event: OpenCodePromptDispatchEvent) => void
  onStreamEvent?: (event: StreamEvent) => void
  onStreamError?: (error: unknown) => void
  onPromptCompleted?: (event: OpenCodePromptCompletedEvent) => void
}

export interface OpenCodePromptDispatchEvent {
  session: Session
  parts: PromptPart[]
  promptText: string
  promptNumber: number
  model?: string
  agent?: string
  variant?: string
}

export interface OpenCodeSessionOwnership extends SessionOwnership {
  ticketId: string
  phase: string
  keepActive?: boolean
}

export interface OpenCodePromptCompletedEvent {
  session: Session
  parts: PromptPart[]
  response: string
  messages: Message[]
  responseMeta: OpenCodeResponseMeta
  attemptMeta: OpenCodeAttemptMeta
  model?: string
  agent?: string
  variant?: string
}

export interface OpenCodeRunOptions extends OpenCodeRunCallbacks {
  adapter: OpenCodeAdapter
  parts: PromptPart[]
  signal?: AbortSignal
  timeoutMs?: number
  model?: string
  agent?: string
  variant?: string
  toolPolicy?: OpenCodeToolPolicy
  sessionOwnership?: OpenCodeSessionOwnership
  erroredSessionPolicy?: OpenCodeErroredSessionPolicy
}

export interface OpenCodeRunResult {
  session: Session
  response: string
  messages: Message[]
  responseMeta: OpenCodeResponseMeta
  attemptMeta: OpenCodeAttemptMeta
}

export type OpenCodeErroredSessionPolicy = 'allow' | 'discard_errored_session_output'

export interface OpenCodeAttemptMeta {
  outcome: 'clean' | 'errored_session'
  responseAccepted: boolean
  discardedResponse: boolean
  sessionErrored: boolean
  latestAssistantErrored: boolean
  errorSource?: 'session_error' | 'assistant_error'
  error?: string
  errorDetails?: unknown
}

const sessionPromptDispatchCounts = new Map<string, number>()

function formatPromptText(parts: PromptPart[]): string {
  if (parts.length === 1 && !parts[0]?.source) {
    return parts[0]?.content ?? ''
  }

  return parts
    .map((part) => {
      const label = part.source ?? part.type
      return `### ${label}\n${part.content}`
    })
    .join('\n\n')
}

function reconcileResponseWithLatestAssistant(
  response: string,
  latestAssistantResponse: string,
  responseMeta: OpenCodeResponseMeta,
): string {
  if (responseMeta.latestAssistantWasStale || responseMeta.latestAssistantHasError) {
    return response
  }

  const current = response.trim()
  const latest = latestAssistantResponse.trim()
  if (!latest) return response
  if (!current) return latest
  if (latest.length > current.length && latest.startsWith(current)) {
    return latest
  }
  return response
}

function mergeSessionErrorIntoResponseMeta(
  responseMeta: OpenCodeResponseMeta,
  sessionErrorEvent?: SessionErrorStreamEvent,
): OpenCodeResponseMeta {
  if (!sessionErrorEvent) {
    return {
      ...responseMeta,
      sessionErrored: false,
    }
  }

  return {
    ...responseMeta,
    sessionErrored: true,
    sessionError: sessionErrorEvent.error,
    sessionErrorDetails: sessionErrorEvent.details,
  }
}

function buildAttemptMeta(
  responseMeta: OpenCodeResponseMeta,
  erroredSessionPolicy: OpenCodeErroredSessionPolicy | undefined,
): OpenCodeAttemptMeta {
  const sessionErrored = Boolean(responseMeta.sessionErrored)
  const latestAssistantErrored = Boolean(responseMeta.latestAssistantHasError)
  const erroredSessionDetected = sessionErrored || latestAssistantErrored
  const discardedResponse = erroredSessionDetected && erroredSessionPolicy === 'discard_errored_session_output'
  const errorSource = sessionErrored
    ? 'session_error'
    : latestAssistantErrored
      ? 'assistant_error'
      : undefined
  const error = sessionErrored
    ? responseMeta.sessionError
    : latestAssistantErrored
      ? responseMeta.latestAssistantError
      : undefined
  const errorDetails = sessionErrored
    ? responseMeta.sessionErrorDetails
    : latestAssistantErrored
      ? responseMeta.latestAssistantErrorInfo
      : undefined

  return {
    outcome: erroredSessionDetected ? 'errored_session' : 'clean',
    responseAccepted: !discardedResponse,
    discardedResponse,
    sessionErrored,
    latestAssistantErrored,
    ...(errorSource ? { errorSource } : {}),
    ...(error ? { error } : {}),
    ...(errorDetails !== undefined ? { errorDetails } : {}),
  }
}

function resolveSessionCreateOptions(): OpenCodeSessionCreateOptions {
  return {
    permission: OPENCODE_EXECUTION_YOLO_PERMISSIONS,
  }
}

export async function runOpenCodePrompt({
  adapter,
  projectPath,
  parts,
  signal,
  timeoutMs,
  model,
  agent,
  variant,
  toolPolicy,
  sessionOwnership,
  erroredSessionPolicy,
  onSessionCreated,
  onPromptDispatched,
  onStreamEvent,
  onPromptCompleted,
}: OpenCodeRunOptions & { projectPath: string }): Promise<OpenCodeRunResult> {
  const sessionManager = sessionOwnership ? new SessionManager(adapter) : null
  const sessionCreateOptions = resolveSessionCreateOptions()
  const session = sessionOwnership
    ? await sessionManager!.validateAndReconnect(sessionOwnership.ticketId, sessionOwnership.phase, {
      phaseAttempt: sessionOwnership.phaseAttempt,
      ...(sessionOwnership.memberId !== undefined ? { memberId: sessionOwnership.memberId } : {}),
      ...(sessionOwnership.beadId !== undefined ? { beadId: sessionOwnership.beadId } : {}),
      ...(sessionOwnership.iteration !== undefined ? { iteration: sessionOwnership.iteration } : {}),
      ...(sessionOwnership.step !== undefined ? { step: sessionOwnership.step } : {}),
    }) ?? await sessionManager!.createSessionForPhase(
      sessionOwnership.ticketId,
      sessionOwnership.phase,
      sessionOwnership.phaseAttempt ?? 1,
      sessionOwnership.memberId ?? undefined,
      sessionOwnership.beadId ?? undefined,
      sessionOwnership.iteration ?? undefined,
      sessionOwnership.step ?? undefined,
      projectPath,
      sessionCreateOptions,
    )
    : await adapter.createSession(projectPath, signal, sessionCreateOptions)
  onSessionCreated?.(session)
  try {
    const result = await runOpenCodeSessionPrompt({
      adapter,
      session,
      parts,
      signal,
      timeoutMs,
      model,
      agent,
      variant,
      toolPolicy,
      erroredSessionPolicy,
      onPromptDispatched,
      onStreamEvent,
      onPromptCompleted,
    })
    if (sessionManager && !sessionOwnership?.keepActive) {
      await sessionManager.completeSession(session.id)
    }
    return result
  } catch (error) {
    if (sessionManager && !sessionOwnership?.keepActive) {
      await sessionManager.abandonSession(session.id)
    }
    throw error
  }
}

export async function runOpenCodeSessionPrompt({
  adapter,
  session,
  parts,
  signal,
  timeoutMs,
  model,
  agent,
  variant,
  toolPolicy,
  sessionOwnership,
  erroredSessionPolicy,
  onPromptDispatched,
  onStreamEvent,
  onStreamError,
  onPromptCompleted,
}: OpenCodeRunOptions & { session: Session }): Promise<OpenCodeRunResult> {
  let resolvedSession = session
  if (sessionOwnership) {
    const sessionManager = new SessionManager(adapter)
    const reconnected = await sessionManager.validateAndReconnect(sessionOwnership.ticketId, sessionOwnership.phase, {
      phaseAttempt: sessionOwnership.phaseAttempt,
      ...(sessionOwnership.memberId !== undefined ? { memberId: sessionOwnership.memberId } : {}),
      ...(sessionOwnership.beadId !== undefined ? { beadId: sessionOwnership.beadId } : {}),
      ...(sessionOwnership.iteration !== undefined ? { iteration: sessionOwnership.iteration } : {}),
      ...(sessionOwnership.step !== undefined ? { step: sessionOwnership.step } : {}),
    })
    if (!reconnected || reconnected.id !== session.id) {
      throw new Error(`OpenCode session ${session.id} is no longer active for ${sessionOwnership.ticketId}:${sessionOwnership.phase}`)
    }
    resolvedSession = reconnected
  }

  let response = ''
  const deadlineController = timeoutMs ? new AbortController() : undefined
  const combinedSignal = deadlineController
    ? signal
      ? AbortSignal.any([signal, deadlineController.signal])
      : deadlineController.signal
    : signal
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined
  const parsedModel = model ? parseModelRef(model) : undefined
  const tools = resolveOpenCodeTools(toolPolicy)
  const stepFinishSafetyMs = timeoutMs
    ? Math.min(Math.max(timeoutMs / 10, PROMPT_MIN_TIMEOUT_MS), PROMPT_MAX_TIMEOUT_MS)
    : undefined
  const promptOptions: PromptSessionOptions = {
    ...(combinedSignal ? { signal: combinedSignal } : {}),
    ...(parsedModel ? { model: parsedModel } : {}),
    ...(agent ? { agent } : {}),
    ...(variant ? { variant } : {}),
    ...(tools ? { tools } : {}),
    ...(stepFinishSafetyMs !== undefined ? { stepFinishSafetyMs } : {}),
  }
  let sessionErrorEvent: SessionErrorStreamEvent | undefined
  promptOptions.onEvent = (event) => {
    if (event.type === 'session_error') {
      sessionErrorEvent = event
    }
    onStreamEvent?.(event)
  }

  try {
    const promptNumber = (sessionPromptDispatchCounts.get(resolvedSession.id) ?? 0) + 1
    sessionPromptDispatchCounts.set(resolvedSession.id, promptNumber)
    onPromptDispatched?.({
      session: resolvedSession,
      parts,
      promptText: formatPromptText(parts),
      promptNumber,
      ...(model ? { model } : {}),
      ...(agent ? { agent } : {}),
      ...(variant ? { variant } : {}),
    })

    if (deadlineController) {
      deadlineTimer = setTimeout(() => deadlineController.abort(), timeoutMs)
    }
    response = await adapter.promptSession(resolvedSession.id, parts, signal, promptOptions)
    // Adapter completed but deadline may have fired during execution;
    // enforce the timeout even if the adapter didn't respect the signal.
    if (deadlineController?.signal.aborted) {
      throw new Error('Timeout')
    }
  } catch (error) {
    if (deadlineController?.signal.aborted) {
      await adapter.abortSession(resolvedSession.id)
      const timeoutError = error instanceof Error && error.message === 'Timeout' ? error : new Error('Timeout')
      onStreamError?.(timeoutError)
      throw timeoutError
    }
    onStreamError?.(error)
    throw error
  } finally {
    if (deadlineTimer) {
      clearTimeout(deadlineTimer)
    }
  }

  let messages: Message[] = []
  let latestAssistantResponse = ''
  let responseMeta: OpenCodeResponseMeta = {
    hasAssistantMessage: false,
    latestAssistantWasEmpty: true,
    latestAssistantHasError: false,
    latestAssistantWasStale: false,
    sessionErrored: false,
  }
  try {
    messages = await adapter.getSessionMessages(resolvedSession.id)
    const latestAssistant = analyzeAssistantMessages(messages)
    latestAssistantResponse = latestAssistant.responseText
    responseMeta = latestAssistant.responseMeta
  } catch {
    messages = []
  }
  responseMeta = mergeSessionErrorIntoResponseMeta(responseMeta, sessionErrorEvent)
  const attemptMeta = buildAttemptMeta(responseMeta, erroredSessionPolicy)
  response = attemptMeta.discardedResponse
    ? ''
    : reconcileResponseWithLatestAssistant(response, latestAssistantResponse, responseMeta)

  const result = {
    session: resolvedSession,
    response,
    messages,
    responseMeta,
    attemptMeta,
  }
  onPromptCompleted?.({
    session: resolvedSession,
    parts,
    response,
    messages,
    responseMeta,
    attemptMeta,
    ...(model ? { model } : {}),
    ...(agent ? { agent } : {}),
    ...(variant ? { variant } : {}),
  })

  return result
}
