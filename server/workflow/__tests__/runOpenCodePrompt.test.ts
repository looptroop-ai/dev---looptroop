import { afterAll, describe, expect, it } from 'vitest'
import { patchTicket } from '../../storage/tickets'
import { createInitializedTestTicket, createTestRepoManager, resetTestDb, TEST } from '../../test/factories'
import { buildFormattedBatchAnswers } from '../phases/interviewPhase'
import { OpenCodeSDKAdapter, type OpenCodeAdapter } from '../../opencode/adapter'
import { OPENCODE_EXECUTION_YOLO_PERMISSIONS } from '../../opencode/permissions'
import type {
  HealthStatus,
  Message,
  MessageInfo,
  OpenCodeSessionCreateOptions,
  PromptPart,
  PromptSessionOptions,
  Session,
  StreamEvent,
} from '../../opencode/types'
import { deliberateInterview } from '../../phases/interview/deliberate'
import { OPENCODE_DISABLED_TOOLS } from '../../opencode/toolPolicy'
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
  private readonly queuedResponses: Array<
    | string
    | Deferred<string>
    | {
        response: string | Deferred<string>
        messageContent?: string
        messageInfo?: Partial<MessageInfo>
        streamEvents?: StreamEvent[]
      }
  >
  private readonly sessionMessages = new Map<string, Message[]>()
  public readonly sessionCreateCalls: Array<{
    projectPath: string
    options?: OpenCodeSessionCreateOptions
  }> = []
  public readonly promptCalls: Array<{
    sessionId: string
    parts: PromptPart[]
    options?: PromptSessionOptions
  }> = []
  private sessionCounter = 0

  constructor(responses: Array<
    | string
    | Deferred<string>
    | {
        response: string | Deferred<string>
        messageContent?: string
        messageInfo?: Partial<MessageInfo>
        streamEvents?: StreamEvent[]
      }
  >) {
    this.queuedResponses = [...responses]
  }

  async createSession(
    projectPath: string,
    _signal?: AbortSignal,
    options?: OpenCodeSessionCreateOptions,
  ): Promise<Session> {
    this.sessionCreateCalls.push({ projectPath, options })
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
    this.promptCalls.push({ sessionId, parts: _parts, options })
    const queued = this.queuedResponses.shift() ?? 'assistant response'
    const queuedResponse = typeof queued === 'object' && 'response' in queued
      ? queued.response
      : queued
    const signal = options?.signal ?? _signal
    const response = typeof queuedResponse === 'string'
      ? queuedResponse
      : signal
        ? await Promise.race([
            queuedResponse.promise,
            new Promise<string>((_, reject) => {
              if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }
              signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
            }),
          ])
        : await queuedResponse.promise
    const messageContent = typeof queued === 'object' && 'response' in queued && typeof queued.messageContent === 'string'
      ? queued.messageContent
      : response
    const streamEvents = typeof queued === 'object' && 'response' in queued && Array.isArray(queued.streamEvents)
      ? queued.streamEvents
      : []
    const messageInfo = typeof queued === 'object' && 'response' in queued
      ? queued.messageInfo
      : undefined
    const assistantMessageId = typeof messageInfo?.id === 'string'
      ? messageInfo.id
      : `msg-${sessionId}-${this.sessionMessages.size + 1}`

    for (const event of streamEvents) {
      options?.onEvent?.(event)
    }

    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: messageContent,
      timestamp: new Date().toISOString(),
      ...(messageInfo
        ? {
            info: {
              id: assistantMessageId,
              sessionID: sessionId,
              role: 'assistant',
              ...messageInfo,
            },
          }
        : {}),
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
  const repoManager = createTestRepoManager('run-opencode-prompt-')

  afterAll(() => {
    resetTestDb()
    repoManager.cleanup()
  })

  function createFakeSdkClient(overrides: {
    create?: (...args: unknown[]) => Promise<unknown>
    prompt?: (...args: unknown[]) => Promise<unknown>
    messages?: () => Promise<unknown>
    subscribe?: (...args: unknown[]) => Promise<{ stream: AsyncIterable<unknown> }>
    get?: () => Promise<unknown>
  } = {}) {
    return {
      session: {
        create: overrides.create ?? (async () => ({ data: { id: 'ses-1', directory: '/tmp/project' } })),
        prompt: overrides.prompt ?? (async () => ({ data: { parts: [] } })),
        messages: overrides.messages ?? (async () => ({ data: [] })),
        abort: async () => ({ data: {} }),
        ...(overrides.get ? { get: overrides.get } : {}),
      },
      event: {
        subscribe: overrides.subscribe ?? (async () => ({
          stream: (async function* () {
            yield { type: 'session.idle', properties: { info: { id: 'ses-1' } } }
          })(),
        })),
      },
    }
  }

  it('passes session-scoped YOLO permissions to the SDK when requested', async () => {
    const sessionCreate = createFakeSdkClient({
      create: async (...args: unknown[]) => {
        expect(args[0]).toMatchObject({
          directory: '/tmp/project',
          permission: OPENCODE_EXECUTION_YOLO_PERMISSIONS,
        })
        return { data: { id: 'ses-1', directory: '/tmp/project' } }
      },
    })
    const adapter = new OpenCodeSDKAdapter('http://localhost:4096', sessionCreate as unknown as OpenCodeSDKClient)

    await adapter.createSession('/tmp/project', undefined, {
      permission: OPENCODE_EXECUTION_YOLO_PERMISSIONS,
    })
  })

  it('omits session-scoped permissions when none are requested', async () => {
    const sessionCreate = createFakeSdkClient({
      create: async (...args: unknown[]) => {
        expect(args[0]).toEqual({ directory: '/tmp/project' })
        return { data: { id: 'ses-1', directory: '/tmp/project' } }
      },
    })
    const adapter = new OpenCodeSDKAdapter('http://localhost:4096', sessionCreate as unknown as OpenCodeSDKClient)

    await adapter.createSession('/tmp/project')
  })

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

  it('creates YOLO sessions for execution-band phases only', async () => {
    resetTestDb()
    const { ticket } = createInitializedTestTicket(repoManager, {
      title: 'Execution-band session permissions',
    })
    patchTicket(ticket.id, { status: 'CODING' })
    const adapter = new TestOpenCodeAdapter(['assistant response'])

    await runOpenCodePrompt({
      adapter,
      projectPath: '/tmp/project',
      parts: [{ type: 'text', content: 'Prompt body' }],
      sessionOwnership: {
        ticketId: ticket.id,
        phase: 'CODING',
      },
    })

    expect(adapter.sessionCreateCalls).toHaveLength(1)
    expect(adapter.sessionCreateCalls[0]?.options?.permission).toEqual(OPENCODE_EXECUTION_YOLO_PERMISSIONS)
  })

  it('keeps non-execution phases on normal sessions', async () => {
    resetTestDb()
    const { ticket } = createInitializedTestTicket(repoManager, {
      title: 'Non execution session permissions',
    })
    patchTicket(ticket.id, { status: 'DRAFTING_PRD' })
    const adapter = new TestOpenCodeAdapter(['assistant response'])

    await runOpenCodePrompt({
      adapter,
      projectPath: '/tmp/project',
      parts: [{ type: 'text', content: 'Prompt body' }],
      sessionOwnership: {
        ticketId: ticket.id,
        phase: 'DRAFTING_PRD',
      },
    })

    expect(adapter.sessionCreateCalls).toHaveLength(1)
    expect(adapter.sessionCreateCalls[0]?.options).toBeUndefined()
  })

  it('fails fast with an upgrade error when execution-band session permissions are rejected', async () => {
    resetTestDb()
    const { ticket } = createInitializedTestTicket(repoManager, {
      title: 'Execution permission rejection',
    })
    patchTicket(ticket.id, { status: 'CODING' })
    const fakeClient = createFakeSdkClient({
      create: async (...args: unknown[]) => {
        expect(args[0]).toMatchObject({
          directory: '/tmp/project',
          permission: OPENCODE_EXECUTION_YOLO_PERMISSIONS,
        })
        throw new Error('400 Bad Request: unknown field "permission"')
      },
    })
    const adapter = new OpenCodeSDKAdapter('http://localhost:4096', fakeClient as unknown as OpenCodeSDKClient)

    await expect(runOpenCodePrompt({
      adapter,
      projectPath: '/tmp/project',
      parts: [{ type: 'text', content: 'Prompt body' }],
      sessionOwnership: {
        ticketId: ticket.id,
        phase: 'CODING',
      },
    })).rejects.toThrow('Upgrade OpenCode and restart `opencode serve`')
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

  it('sends the shared deny-all tools map when toolPolicy is disabled', async () => {
    const adapter = new TestOpenCodeAdapter(['assistant response'])

    await runOpenCodePrompt({
      adapter,
      projectPath: '/tmp/project',
      parts: [{ type: 'text', content: 'Prompt body' }],
      toolPolicy: 'disabled',
    })

    expect(adapter.promptCalls).toHaveLength(1)
    expect(adapter.promptCalls[0]?.options?.tools).toEqual(OPENCODE_DISABLED_TOOLS)
  })

  it('does not send a tools override when toolPolicy is default', async () => {
    const adapter = new TestOpenCodeAdapter(['assistant response'])

    await runOpenCodePrompt({
      adapter,
      projectPath: '/tmp/project',
      parts: [{ type: 'text', content: 'Prompt body' }],
      toolPolicy: 'default',
    })

    expect(adapter.promptCalls).toHaveLength(1)
    expect(adapter.promptCalls[0]?.options?.tools).toBeUndefined()
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
    const fakeClient = createFakeSdkClient({
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
    })
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

  it('falls back to streamed text when the final snapshot text is empty', async () => {
    const fakeClient = createFakeSdkClient({
      prompt: async () => ({
        data: {
          info: { id: 'msg-1' },
          parts: [
            { type: 'text', text: '' },
          ],
        },
      }),
      messages: async () => ({
        data: [
          {
            info: { id: 'msg-1', role: 'assistant', time: { created: Date.now() } },
            parts: [
              {
                id: 'part-1',
                type: 'text',
                text: '',
                sessionID: 'ses-1',
                messageID: 'msg-1',
                time: { end: Date.now() },
              },
            ],
          },
        ],
      }),
      subscribe: async () => ({
        stream: (async function* () {
          yield {
            type: 'message.part.updated',
            properties: {
              part: {
                id: 'part-1',
                type: 'text',
                text: '<RELEVANT_FILES_RESULT>streamed artifact</RELEVANT_FILES_RESULT>',
                sessionID: 'ses-1',
                messageID: 'msg-1',
                time: { end: Date.now() },
              },
            },
          }
          yield {
            type: 'session.idle',
            properties: { info: { id: 'ses-1' } },
          }
        })(),
      }),
    })
    const adapter = new OpenCodeSDKAdapter('http://localhost:4096', fakeClient as unknown as OpenCodeSDKClient)

    const result = await runOpenCodePrompt({
      adapter,
      projectPath: '/tmp/project',
      parts: [{ type: 'text', content: 'Prompt body' }],
    })

    expect(result.response).toBe('<RELEVANT_FILES_RESULT>streamed artifact</RELEVANT_FILES_RESULT>')
  })

  it('does not fall back to older assistant text when the latest assistant snapshot is empty', async () => {
    const fakeClient = createFakeSdkClient({
      prompt: async () => ({
        data: {
          info: { id: 'msg-2' },
          parts: [{ type: 'text', text: '' }],
        },
      }),
      messages: async () => ({
        data: [
          {
            info: { id: 'msg-1', role: 'assistant', time: { created: Date.now() - 10 } },
            parts: [
              {
                id: 'part-1',
                type: 'text',
                text: 'older assistant output',
                sessionID: 'ses-1',
                messageID: 'msg-1',
                time: { end: Date.now() - 10 },
              },
            ],
          },
          {
            info: { id: 'msg-2', role: 'assistant', time: { created: Date.now() } },
            parts: [
              {
                id: 'part-2',
                type: 'text',
                text: '',
                sessionID: 'ses-1',
                messageID: 'msg-2',
                time: { end: Date.now() },
              },
            ],
          },
        ],
      }),
    })
    const adapter = new OpenCodeSDKAdapter('http://localhost:4096', fakeClient as unknown as OpenCodeSDKClient)

    const result = await runOpenCodePrompt({
      adapter,
      projectPath: '/tmp/project',
      parts: [{ type: 'text', content: 'Prompt body' }],
    })

    expect(result.response).toBe('')
    expect(result.responseMeta).toMatchObject({
      hasAssistantMessage: true,
      latestAssistantMessageId: 'msg-2',
      latestAssistantWasEmpty: true,
      latestAssistantHasError: false,
    })
  })

  it('surfaces provider metadata from the latest assistant snapshot instead of reusing stale text', async () => {
    const fakeClient = createFakeSdkClient({
      prompt: async () => ({
        data: {
          info: { id: 'msg-2' },
          parts: [],
        },
      }),
      messages: async () => ({
        data: [
          {
            info: { id: 'msg-1', role: 'assistant', time: { created: Date.now() - 10 } },
            parts: [
              {
                id: 'part-1',
                type: 'text',
                text: 'older assistant output',
                sessionID: 'ses-1',
                messageID: 'msg-1',
                time: { end: Date.now() - 10 },
              },
            ],
          },
          {
            info: {
              id: 'msg-2',
              role: 'assistant',
              error: "Provider returned error: The last message cannot have role 'assistant'",
              time: { created: Date.now() },
            },
            parts: [],
          },
        ],
      }),
    })
    const adapter = new OpenCodeSDKAdapter('http://localhost:4096', fakeClient as unknown as OpenCodeSDKClient)

    const result = await runOpenCodePrompt({
      adapter,
      projectPath: '/tmp/project',
      parts: [{ type: 'text', content: 'Prompt body' }],
    })

    expect(result.response).toBe('')
    expect(result.responseMeta).toMatchObject({
      hasAssistantMessage: true,
      latestAssistantMessageId: 'msg-2',
      latestAssistantWasEmpty: true,
      latestAssistantHasError: true,
      latestAssistantError: "Provider returned error: The last message cannot have role 'assistant'",
    })
  })

  it('discards parseable output when the session stream emitted a provider error and the caller opts in', async () => {
    const adapter = new TestOpenCodeAdapter([{
      response: '<RELEVANT_FILES_RESULT>streamed artifact</RELEVANT_FILES_RESULT>',
      messageContent: '<RELEVANT_FILES_RESULT>streamed artifact</RELEVANT_FILES_RESULT>',
      streamEvents: [{
        type: 'session_error',
        sessionId: 'ses-1',
        error: "Provider returned error: The last message cannot have role 'assistant'",
      }],
    }])

    const result = await runOpenCodePrompt({
      adapter,
      projectPath: '/tmp/project',
      parts: [{ type: 'text', content: 'Prompt body' }],
      erroredSessionPolicy: 'discard_errored_session_output',
    })

    expect(result.response).toBe('')
    expect(result.responseMeta).toMatchObject({
      sessionErrored: true,
      sessionError: "Provider returned error: The last message cannot have role 'assistant'",
      latestAssistantHasError: false,
    })
    expect(result.attemptMeta).toMatchObject({
      outcome: 'errored_session',
      responseAccepted: false,
      discardedResponse: true,
      sessionErrored: true,
      latestAssistantErrored: false,
      errorSource: 'session_error',
      error: "Provider returned error: The last message cannot have role 'assistant'",
    })
  })

  it('discards output when the latest assistant snapshot carries provider error metadata and the caller opts in', async () => {
    const adapter = new TestOpenCodeAdapter([{
      response: '<RELEVANT_FILES_RESULT>provider response</RELEVANT_FILES_RESULT>',
      messageContent: '<RELEVANT_FILES_RESULT>provider response</RELEVANT_FILES_RESULT>',
      messageInfo: {
        error: "Provider returned error: The last message cannot have role 'assistant'",
      },
    }])

    const result = await runOpenCodePrompt({
      adapter,
      projectPath: '/tmp/project',
      parts: [{ type: 'text', content: 'Prompt body' }],
      erroredSessionPolicy: 'discard_errored_session_output',
    })

    expect(result.response).toBe('')
    expect(result.responseMeta).toMatchObject({
      sessionErrored: false,
      latestAssistantHasError: true,
      latestAssistantError: "Provider returned error: The last message cannot have role 'assistant'",
    })
    expect(result.attemptMeta).toMatchObject({
      outcome: 'errored_session',
      responseAccepted: false,
      discardedResponse: true,
      sessionErrored: false,
      latestAssistantErrored: true,
      errorSource: 'assistant_error',
      error: "Provider returned error: The last message cannot have role 'assistant'",
    })
  })

  it('extracts structured provider error details from the latest assistant snapshot', async () => {
    const fakeClient = createFakeSdkClient({
      prompt: async () => ({
        data: {
          info: { id: 'msg-2' },
          parts: [],
        },
      }),
      messages: async () => ({
        data: [
          {
            info: {
              id: 'msg-2',
              role: 'assistant',
              error: {
                name: 'AI_APICallError',
                statusCode: 402,
                requestBodyValues: { model: 'gpt-5-nano' },
                responseBody: JSON.stringify({
                  error: {
                    title: 'Low Credit Warning!',
                    message: 'Add credits to continue, or switch to a free model',
                  },
                }),
                data: {
                  error: {
                    type: 'ModelError',
                    message: 'Add credits to continue, or switch to a free model',
                  },
                },
              },
              time: { created: Date.now() },
            },
            parts: [],
          },
        ],
      }),
    })
    const adapter = new OpenCodeSDKAdapter('http://localhost:4096', fakeClient as unknown as OpenCodeSDKClient)

    const result = await runOpenCodePrompt({
      adapter,
      projectPath: '/tmp/project',
      parts: [{ type: 'text', content: 'Prompt body' }],
    })

    expect(result.responseMeta.latestAssistantErrorInfo).toMatchObject({
      name: 'AI_APICallError',
      statusCode: 402,
      requestModel: 'gpt-5-nano',
      responseErrorType: 'ModelError',
      responseErrorMessage: 'Add credits to continue, or switch to a free model',
      responseErrorTitle: 'Low Credit Warning!',
    })
  })

  it('waits for the terminal snapshot when the immediate SDK response echoes the prompt', async () => {
    let latestAssistantText = [
      'CRITICAL OUTPUT RULE:',
      'Return strict machine-readable output.',
      '',
      'CONTEXT REFRESH:',
      'Use the latest ticket context.',
    ].join('\n')

    const fakeClient = {
      session: {
        create: async () => ({ data: { id: 'ses-1', directory: '/tmp/project' } }),
        prompt: async () => ({
          data: {
            info: { id: 'msg-echo' },
            parts: [
              { type: 'text', text: latestAssistantText },
            ],
          },
        }),
        messages: async () => ({
          data: [
            {
              info: { id: 'msg-final', role: 'assistant', time: { created: Date.now() } },
              parts: [
                {
                  id: 'part-final',
                  type: 'text',
                  text: latestAssistantText,
                  sessionID: 'ses-1',
                  messageID: 'msg-final',
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
            await new Promise((resolve) => setTimeout(resolve, 20))
            latestAssistantText = [
              '<RELEVANT_FILES_RESULT>',
              'file_count: 1',
              'files:',
              '  - path: src/app.ts',
              '    rationale: Entry point.',
              '    relevance: high',
              '    likely_action: modify',
              '</RELEVANT_FILES_RESULT>',
            ].join('\n')
            yield {
              type: 'session.idle',
              properties: { info: { id: 'ses-1' } },
            }
          })(),
        }),
      },
    }
    const adapter = new OpenCodeSDKAdapter('http://localhost:4096', fakeClient as unknown as OpenCodeSDKClient)

    const result = await runOpenCodePrompt({
      adapter,
      projectPath: '/tmp/project',
      parts: [{ type: 'text', content: 'Prompt body' }],
    })

    expect(result.response).toContain('<RELEVANT_FILES_RESULT>')
    expect(result.response).not.toContain('CRITICAL OUTPUT RULE:')
  })

  it('prefers the complete latest assistant message when the immediate response is only a strict prefix', async () => {
    const fullMessage = [
      'schema_version: 1',
      `ticket_id: ${TEST.externalId}`,
      'artifact: interview',
      'status: draft',
      'questions:',
      '  - id: Q01',
      '    phase: Foundation',
      '    prompt: Which workflow guardrails are mandatory?',
      'follow_up_rounds: []',
      'summary:',
      '  goals: []',
      'approval:',
      '  approved_by: ""',
      '  approved_at: ""',
    ].join('\n')
    const adapter = new TestOpenCodeAdapter([{
      response: fullMessage.slice(0, fullMessage.indexOf('follow_up_rounds:')),
      messageContent: fullMessage,
    }])

    const result = await runOpenCodePrompt({
      adapter,
      projectPath: '/tmp/project',
      parts: [{ type: 'text', content: 'Prompt body' }],
    })

    expect(result.response).toBe(fullMessage)
    expect(result.responseMeta).toMatchObject({
      hasAssistantMessage: true,
      latestAssistantWasEmpty: false,
      latestAssistantHasError: false,
    })
  })

  it('keeps the immediate response when the latest assistant message is not a strict extension', async () => {
    const adapter = new TestOpenCodeAdapter([{
      response: 'immediate provider response',
      messageContent: 'different assistant text',
    }])

    const result = await runOpenCodePrompt({
      adapter,
      projectPath: '/tmp/project',
      parts: [{ type: 'text', content: 'Prompt body' }],
    })

    expect(result.response).toBe('immediate provider response')
  })

  it('keeps timeout behavior when done would arrive after the timeout window', async () => {
    const fakeClient = createFakeSdkClient({
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
      subscribe: async (...args: unknown[]) => {
        const requestOptions = (
          args[1] && typeof args[1] === 'object'
            ? args[1] as { signal?: AbortSignal }
            : undefined
        )

        return {
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
        }
      },
    })
    const adapter = new OpenCodeSDKAdapter('http://localhost:4096', fakeClient as unknown as OpenCodeSDKClient)

    await expect(runOpenCodePrompt({
      adapter,
      projectPath: '/tmp/project',
      parts: [{ type: 'text', content: 'Prompt body' }],
      timeoutMs: 20,
    })).rejects.toThrow('Timeout')
  })

  it('subscribeToEvents emits synthetic done after step-finish safety timeout', async () => {
    // Test the safety timeout directly on the adapter level with a small value
    const fakeClient = createFakeSdkClient({
      get: async () => ({ data: { directory: '/tmp/project' } }),
      subscribe: async () => ({
        stream: (async function* () {
          yield {
            type: 'message.part.updated',
            properties: {
              part: {
                id: 'part-step-1',
                type: 'step-finish',
                reason: 'stop',
                sessionID: 'ses-1',
                messageID: 'msg-1',
              },
            },
          }
          // Hang indefinitely — simulating missing session.idle
          await new Promise<void>(() => {})
        })(),
      }),
    })
    const sdkAdapter = new OpenCodeSDKAdapter('http://localhost:4096', fakeClient as unknown as OpenCodeSDKClient)

    const events: StreamEvent[] = []
    for await (const event of sdkAdapter.subscribeToEvents('ses-1', undefined, 50)) {
      events.push(event)
    }

    // Should have: step-finish event + synthetic done from safety timeout
    expect(events.some(e => e.type === 'step' && e.step === 'finish')).toBe(true)
    expect(events[events.length - 1]?.type).toBe('done')
  })

  it('preserves OpenCode tool input, output, and error details in stream events', async () => {
    const fakeClient = createFakeSdkClient({
      get: async () => ({ data: { directory: '/tmp/project' } }),
      subscribe: async () => ({
        stream: (async function* () {
          yield {
            type: 'message.part.updated',
            properties: {
              part: {
                id: 'part-tool-1',
                type: 'tool',
                callID: 'call-1',
                tool: 'bash',
                sessionID: 'ses-1',
                messageID: 'msg-1',
                state: {
                  status: 'error',
                  title: 'Run unit tests',
                  input: {
                    command: 'npm test',
                  },
                  output: 'stdout body',
                  error: 'stderr body',
                },
              },
            },
          }
          yield {
            type: 'session.idle',
            properties: { info: { id: 'ses-1' } },
          }
        })(),
      }),
    })
    const sdkAdapter = new OpenCodeSDKAdapter('http://localhost:4096', fakeClient as unknown as OpenCodeSDKClient)

    const events: StreamEvent[] = []
    for await (const event of sdkAdapter.subscribeToEvents('ses-1')) {
      events.push(event)
    }

    expect(events[0]).toMatchObject({
      type: 'tool',
      tool: 'bash',
      status: 'error',
      title: 'Run unit tests',
      input: { command: 'npm test' },
      output: 'stdout body',
      error: 'stderr body',
      complete: true,
    })
  })

  it('reports Timeout as an ERROR event, not as a CancelledError', async () => {
    const deferredResponse = createDeferred<string>()
    const testAdapter = new TestOpenCodeAdapter([deferredResponse])
    const errors: unknown[] = []

    const runPromise = runOpenCodeSessionPrompt({
      adapter: testAdapter,
      session: { id: 'ses-timeout-test' },
      parts: [{ type: 'text', content: 'test prompt' }],
      timeoutMs: 50,
      onStreamError: (err) => {
        errors.push(err)
      },
    })

    await expect(runPromise).rejects.toThrow('Timeout')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(Error)
    expect((errors[0] as Error).message).toBe('Timeout')
    // Verify it's NOT a CancelledError
    expect((errors[0] as Error).name).not.toBe('CancelledError')
  })
})

describe('buildFormattedBatchAnswers', () => {
  it('formats free_text answers unchanged', () => {
    const result = buildFormattedBatchAnswers(
      [{ id: 'Q01' }],
      { Q01: 'My answer' },
    )
    expect(result.Q01).toBe('My answer')
  })

  it('formats single_choice with selected option labels', () => {
    const result = buildFormattedBatchAnswers(
      [{ id: 'Q01', answerType: 'single_choice', options: [{ id: 'opt1', label: 'PostgreSQL' }, { id: 'opt2', label: 'MySQL' }] }],
      { Q01: '' },
      { Q01: ['opt1'] },
    )
    expect(result.Q01).toBe('Selected: "PostgreSQL"')
  })

  it('formats multiple_choice with notes', () => {
    const result = buildFormattedBatchAnswers(
      [{ id: 'Q01', answerType: 'multiple_choice', options: [{ id: 'a', label: 'Web' }, { id: 'b', label: 'iOS' }] }],
      { Q01: 'Also need desktop' },
      { Q01: ['a', 'b'] },
    )
    expect(result.Q01).toBe('Selected: "Web", "iOS". Notes: Also need desktop')
  })

})
