import type { OpenCodeAdapter } from '../opencode/adapter'
import type {
  Message,
  PromptPart,
  PromptSessionOptions,
  Session,
  StreamEvent,
} from '../opencode/types'
import { parseModelRef } from '../opencode/types'

export interface OpenCodeRunCallbacks {
  onSessionCreated?: (session: Session) => void
  onStreamEvent?: (event: StreamEvent) => void
  onStreamError?: (error: unknown) => void
}

export interface OpenCodeRunOptions extends OpenCodeRunCallbacks {
  adapter: OpenCodeAdapter
  parts: PromptPart[]
  signal?: AbortSignal
  timeoutMs?: number
  model?: string
  agent?: string
  variant?: string
}

export interface OpenCodeRunResult {
  session: Session
  response: string
  messages: Message[]
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
  onSessionCreated,
  onStreamEvent,
}: OpenCodeRunOptions & { projectPath: string }): Promise<OpenCodeRunResult> {
  const session = await adapter.createSession(projectPath, signal)
  onSessionCreated?.(session)
  return runOpenCodeSessionPrompt({
    adapter,
    session,
    parts,
    signal,
    timeoutMs,
    model,
    agent,
    variant,
    onStreamEvent,
  })
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
  onStreamEvent,
  onStreamError,
}: OpenCodeRunOptions & { session: Session }): Promise<OpenCodeRunResult> {
  let response = ''
  const parsedModel = model ? parseModelRef(model) : undefined
  const promptOptions: PromptSessionOptions = {
    ...(signal ? { signal } : {}),
    ...(parsedModel ? { model: parsedModel } : {}),
    ...(agent ? { agent } : {}),
    ...(variant ? { variant } : {}),
    ...(onStreamEvent ? { onEvent: onStreamEvent } : {}),
  }

  try {
    if (timeoutMs) {
      response = await Promise.race([
        adapter.promptSession(session.id, parts, signal, promptOptions),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), timeoutMs),
        ),
      ])
    } else {
      response = await adapter.promptSession(session.id, parts, signal, promptOptions)
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Timeout') {
      await adapter.abortSession(session.id)
    }
    onStreamError?.(error)
    throw error
  }

  let messages: Message[] = []
  try {
    messages = await adapter.getSessionMessages(session.id)
  } catch {
    messages = []
  }

  return {
    session,
    response,
    messages,
  }
}
