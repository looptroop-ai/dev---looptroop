import { describe, expect, it } from 'vitest'
import { OpenCodeSDKAdapter, type OpenCodeAdapter } from '../../opencode/adapter'
import type {
  HealthStatus,
  Message,
  PromptPart,
  PromptSessionOptions,
  Session,
  StreamEvent,
} from '../../opencode/types'
import { deliberateInterview } from '../../phases/interview/deliberate'
import {
  runOpenCodePrompt,
  runOpenCodeSessionPrompt,
  type OpenCodePromptDispatchEvent,
} from '../runOpenCodePrompt'

type OpenCodeSDKClient = NonNullable<ConstructorParameters<typeof OpenCodeSDKAdapter>[1]>

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

class TestOpenCodeAdapter implements OpenCodeAdapter {
  private readonly queuedResponses: Array<string | Deferred<string>>
  private readonly sessionMessages = new Map<string, Message[]>()
  private sessionCounter = 0

  constructor(responses: Array<string | Deferred<string>>) {
    this.queuedResponses = [...responses]
  }

  async createSession(projectPath: string): Promise<Session> {
    this.sessionCounter += 1
    return {
      id: `ses-${this.sessionCounter}`,
      projectPath,
    }
  }

  async promptSession(
    sessionId: string,
    _parts: PromptPart[],
    _signal?: AbortSignal,
    options?: PromptSessionOptions,
  ): Promise<string> {
    const queued = this.queuedResponses.shift() ?? 'assistant response'
    const response = typeof queued === 'string' ? queued : await queued.promise

    const assistantMessage: Message = {
      id: `msg-${sessionId}-${this.sessionMessages.size + 1}`,
      role: 'assistant',
      content: response,
      timestamp: new Date().toISOString(),
    }
    this.sessionMessages.set(sessionId, [assistantMessage])

    options?.onEvent?.({
      type: 'text',
      sessionId,
      messageId: assistantMessage.id,
      partId: `part-${assistantMessage.id}`,
      text: response,
      streaming: false,
      complete: true,
    })
    options?.onEvent?.({
      type: 'done',
      sessionId,
    })

    return response
  }

  async listSessions(): Promise<Session[]> {
    return []
  }

  async getSessionMessages(sessionId: string): Promise<Message[]> {
    return this.sessionMessages.get(sessionId) ?? []
  }

  async *subscribeToEvents(sessionId: string, _signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    yield { type: 'done', sessionId }
  }

  async abortSession(_sessionId: string): Promise<boolean> {
    return true
  }

  async assembleBeadContext(_ticketId: string, _beadId: string): Promise<PromptPart[]> {
    return []
  }

  async assembleCouncilContext(_ticketId: string, _phase: string): Promise<PromptPart[]> {
    return []
  }

  async checkHealth(): Promise<HealthStatus> {
    return { available: true }
  }
}

describe('runOpenCodePrompt', () => {
  it('dispatches prompt metadata before the prompt completes', async () => {
    const deferredResponse = createDeferred<string>()
    const adapter = new TestOpenCodeAdapter([deferredResponse])
    const callbackOrder: string[] = []
    let dispatchedEvent: OpenCodePromptDispatchEvent | null = null

    const runPromise = runOpenCodePrompt({
      adapter,
      projectPath: '/tmp/project',
      parts: [{ type: 'text', content: 'PROM1 body' }],
      model: 'openai/gpt-5-mini',
      onSessionCreated: () => {
        callbackOrder.push('session')
      },
      onPromptDispatched: (event) => {
        callbackOrder.push('prompt')
        dispatchedEvent = event
      },
    })

    await Promise.resolve()
    await Promise.resolve()

    expect(callbackOrder).toEqual(['session', 'prompt'])
    expect(dispatchedEvent).toMatchObject({
      session: { id: 'ses-1' },
      promptText: 'PROM1 body',
      promptNumber: 1,
      model: 'openai/gpt-5-mini',
    })

    deferredResponse.resolve('assistant response')
    await expect(runPromise).resolves.toMatchObject({
      response: 'assistant response',
      session: { id: 'ses-1' },
    })
  })

  it('increments prompt numbers across repeated prompts in the same session', async () => {
    const adapter = new TestOpenCodeAdapter(['first response', 'second response'])
    const promptNumbers: number[] = []

    await runOpenCodeSessionPrompt({
      adapter,
      session: { id: 'shared-session' },
      parts: [{ type: 'text', content: 'first prompt' }],
      onPromptDispatched: (event) => {
        promptNumbers.push(event.promptNumber)
      },
    })

    await runOpenCodeSessionPrompt({
      adapter,
      session: { id: 'shared-session' },
      parts: [{ type: 'text', content: 'second prompt' }],
      onPromptDispatched: (event) => {
        promptNumbers.push(event.promptNumber)
      },
    })

    expect(promptNumbers).toEqual([1, 2])
  })

  it('propagates the initial PROM1 interview draft prompt to callers', async () => {
    const adapter = new TestOpenCodeAdapter([
      [
        'questions:',
        '  - id: Q01',
        '    phase: foundation',
        '    question: "What problem are we solving?"',
      ].join('\n'),
    ])
    const dispatchedEntries: Array<{
      stage: 'draft'
      memberId: string
      event: OpenCodePromptDispatchEvent
    }> = []

    const result = await deliberateInterview(
      adapter,
      [{ modelId: 'openai/gpt-5-mini', name: 'GPT-5 Mini' }],
      [{ type: 'text', source: 'ticket_details', content: 'Build a ticket dashboard.' }],
      '/tmp/project',
      {
        draftTimeoutMs: 1_000,
        minQuorum: 1,
        maxInitialQuestions: 3,
      },
      undefined,
      undefined,
      undefined,
      (entry) => {
        dispatchedEntries.push(entry)
      },
    )

    expect(result.drafts).toHaveLength(1)
    expect(result.drafts[0]).toMatchObject({
      memberId: 'openai/gpt-5-mini',
      outcome: 'completed',
    })
    expect(dispatchedEntries).toHaveLength(1)
    expect(dispatchedEntries[0]).toMatchObject({
      stage: 'draft',
      memberId: 'openai/gpt-5-mini',
    })
    expect(dispatchedEntries[0]!.event.promptText).toContain('## System Role')
    expect(dispatchedEntries[0]!.event.promptText).toContain('Build a ticket dashboard.')
    expect(dispatchedEntries[0]!.event.promptText).toContain('max_initial_questions: 3')
  })

  it('returns snapshot content when stream done arrives before SDK prompt resolves', async () => {
    const deferredPrompt = createDeferred<{ data?: { parts?: Array<{ type: string; text: string }> } }>()
    const fakeClient = {
      session: {
        create: async () => ({ data: { id: 'ses-1', directory: '/tmp/project' } }),
        prompt: async () => deferredPrompt.promise,
        messages: async () => ({
          data: [
            {
              info: { id: 'msg-1', role: 'assistant', time: { created: Date.now() } },
              parts: [
                {
                  id: 'part-1',
                  type: 'text',
                  text: 'stream snapshot response',
                  sessionID: 'ses-1',
                  messageID: 'msg-1',
                  time: { end: Date.now() },
                },
              ],
            },
          ],
        }),
        abort: async () => ({ data: {} }),
      },
      event: {
        subscribe: async () => ({
          stream: (async function* () {
            yield {
              type: 'session.idle',
              properties: { info: { id: 'ses-1' } },
            }
          })(),
        }),
      },
    }
    const adapter = new OpenCodeSDKAdapter('http://localhost:4096', fakeClient as unknown as OpenCodeSDKClient)

    const runPromise = runOpenCodePrompt({
      adapter,
      projectPath: '/tmp/project',
      parts: [{ type: 'text', content: 'Prompt body' }],
    })

    const settled = await Promise.race([
      runPromise.then(() => 'resolved'),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 100)),
    ])
    expect(settled).toBe('resolved')

    const result = await runPromise
    expect(result.response).toBe('stream snapshot response')

    deferredPrompt.resolve({
      data: {
        parts: [
          { type: 'text', text: 'late sdk response' },
        ],
      },
    })
  })

  it('keeps timeout behavior when done would arrive after the timeout window', async () => {
    const fakeClient = {
      session: {
        create: async () => ({ data: { id: 'ses-1', directory: '/tmp/project' } }),
        prompt: async () => new Promise<never>(() => {}),
        messages: async () => ({
          data: [
            {
              info: { id: 'msg-1', role: 'assistant', time: { created: Date.now() } },
              parts: [
                {
                  id: 'part-1',
                  type: 'text',
                  text: 'late stream response',
                  sessionID: 'ses-1',
                  messageID: 'msg-1',
                  time: { end: Date.now() },
                },
              ],
            },
          ],
        }),
        abort: async () => ({ data: {} }),
      },
      event: {
        subscribe: async (_options?: unknown, requestOptions?: { signal?: AbortSignal }) => ({
          stream: (async function* () {
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(resolve, 80)
              requestOptions?.signal?.addEventListener('abort', () => {
                clearTimeout(timer)
                const abortError = new Error('Aborted')
                abortError.name = 'AbortError'
                reject(abortError)
              }, { once: true })
            })
            yield {
              type: 'session.idle',
              properties: { info: { id: 'ses-1' } },
            }
          })(),
        }),
      },
    }
    const adapter = new OpenCodeSDKAdapter('http://localhost:4096', fakeClient as unknown as OpenCodeSDKClient)

    await expect(runOpenCodePrompt({
      adapter,
      projectPath: '/tmp/project',
      parts: [{ type: 'text', content: 'Prompt body' }],
      timeoutMs: 20,
    })).rejects.toThrow('Timeout')
  })
})
