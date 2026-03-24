import type { OpenCodeAdapter } from '../opencode/adapter'
import type {
  Message,
  PromptPart,
  PromptSessionOptions,
  Session,
  StreamEvent,
} from '../opencode/types'
import { parseModelRef } from '../opencode/types'
import { SessionManager, type SessionOwnership } from '../opencode/sessionManager'

export interface OpenCodeRunCallbacks {
  onSessionCreated?: (session: Session) => void
  onPromptDispatched?: (event: OpenCodePromptDispatchEvent) => void
  onStreamEvent?: (event: StreamEvent) => void
  onStreamError?: (error: unknown) => void
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

export interface OpenCodeRunOptions extends OpenCodeRunCallbacks {
  adapter: OpenCodeAdapter
  parts: PromptPart[]
  signal?: AbortSignal
  timeoutMs?: number
  model?: string
  agent?: string
  variant?: string
  sessionOwnership?: OpenCodeSessionOwnership
}

export interface OpenCodeRunResult {
  session: Session
  response: string
  messages: Message[]
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

export async function runOpenCodePrompt({
  adapter,
  projectPath,
  parts,
  signal,
  timeoutMs,
  model,
  agent,
  variant,
  sessionOwnership,
  onSessionCreated,
  onPromptDispatched,
  onStreamEvent,
}: OpenCodeRunOptions & { projectPath: string }): Promise<OpenCodeRunResult> {
  const sessionManager = sessionOwnership ? new SessionManager(adapter) : null
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
    )
    : await adapter.createSession(projectPath, signal)
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
      onPromptDispatched,
      onStreamEvent,
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
  sessionOwnership,
  onPromptDispatched,
  onStreamEvent,
  onStreamError,
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
  const stepFinishSafetyMs = timeoutMs
    ? Math.min(Math.max(timeoutMs / 10, 10_000), 30_000)
    : undefined
  const promptOptions: PromptSessionOptions = {
    ...(combinedSignal ? { signal: combinedSignal } : {}),
    ...(parsedModel ? { model: parsedModel } : {}),
    ...(agent ? { agent } : {}),
    ...(variant ? { variant } : {}),
    ...(onStreamEvent ? { onEvent: onStreamEvent } : {}),
    ...(stepFinishSafetyMs !== undefined ? { stepFinishSafetyMs } : {}),
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
  try {
    messages = await adapter.getSessionMessages(resolvedSession.id)
  } catch {
    messages = []
  }

  return {
    session: resolvedSession,
    response,
    messages,
  }
}
