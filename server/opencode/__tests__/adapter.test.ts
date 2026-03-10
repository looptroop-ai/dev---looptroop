import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MockOpenCodeAdapter, OpenCodeSDKAdapter } from '../adapter'
import type { PromptPart, StreamEvent } from '../types'

describe('MockOpenCodeAdapter', () => {
  let adapter: MockOpenCodeAdapter

  beforeEach(() => {
    adapter = new MockOpenCodeAdapter()
  })

  describe('createSession', () => {
    it('should create a session with unique ID', async () => {
      const session = await adapter.createSession('/tmp/project')
      expect(session.id).toBe('mock-session-1')
      expect(session.projectPath).toBe('/tmp/project')
      expect(session.createdAt).toBeTruthy()
    })

    it('should increment session IDs', async () => {
      const s1 = await adapter.createSession('/tmp/a')
      const s2 = await adapter.createSession('/tmp/b')
      expect(s1.id).toBe('mock-session-1')
      expect(s2.id).toBe('mock-session-2')
    })
  })

  describe('listSessions', () => {
    it('should return empty array initially', async () => {
      const sessions = await adapter.listSessions()
      expect(sessions).toEqual([])
    })

    it('should return created sessions', async () => {
      await adapter.createSession('/tmp/a')
      await adapter.createSession('/tmp/b')
      const sessions = await adapter.listSessions()
      expect(sessions).toHaveLength(2)
      expect(sessions[0]!.projectPath).toBe('/tmp/a')
      expect(sessions[1]!.projectPath).toBe('/tmp/b')
    })
  })

  describe('promptSession', () => {
    it('should return response text', async () => {
      const session = await adapter.createSession('/tmp/test')
      const parts: PromptPart[] = [{ type: 'text', content: 'Hello' }]

      const response = await adapter.promptSession(session.id, parts)

      expect(response).toBe('Mock response')
    })

    it('should use custom mock responses', async () => {
      const session = await adapter.createSession('/tmp/test')
      adapter.mockResponses.set(session.id, 'Custom reply')

      const response = await adapter.promptSession(session.id, [
        { type: 'text', content: 'Q' },
      ])

      expect(response).toBe('Custom reply')
    })

    it('should store messages after prompting', async () => {
      const session = await adapter.createSession('/tmp/test')
      const parts: PromptPart[] = [{ type: 'text', content: 'Hello' }]

      await adapter.promptSession(session.id, parts)

      const messages = await adapter.getSessionMessages(session.id)
      expect(messages).toHaveLength(2)
      expect(messages[0]!.role).toBe('user')
      expect(messages[0]!.content).toBe('Hello')
      expect(messages[1]!.role).toBe('assistant')
      expect(messages[1]!.content).toBe('Mock response')
    })
  })

  describe('getSessionMessages', () => {
    it('should return empty array for unknown session', async () => {
      const messages = await adapter.getSessionMessages('nonexistent')
      expect(messages).toEqual([])
    })
  })

  describe('checkHealth', () => {
    it('should return healthy status', async () => {
      const health = await adapter.checkHealth()
      expect(health.available).toBe(true)
      expect(health.version).toBe('mock-1.0.0')
      expect(health.models).toEqual(['mock-model-1', 'mock-model-2'])
    })
  })

  describe('assembleBeadContext', () => {
    it('should return mock bead context', async () => {
      const parts = await adapter.assembleBeadContext('ticket-1', 'bead-1')
      expect(parts).toHaveLength(1)
      expect(parts[0]!.type).toBe('text')
      expect(parts[0]!.content).toBe('Mock bead context')
    })
  })

  describe('assembleCouncilContext', () => {
    it('should return mock council context', async () => {
      const parts = await adapter.assembleCouncilContext('ticket-1', 'interview_draft')
      expect(parts).toHaveLength(1)
      expect(parts[0]!.type).toBe('text')
      expect(parts[0]!.content).toBe('Mock council context')
    })
  })

  describe('subscribeToEvents', () => {
    it('should yield done event', async () => {
      const events: StreamEvent[] = []
      for await (const event of adapter.subscribeToEvents('session-1')) {
        events.push(event)
      }
      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe('done')
    })
  })
})

describe('OpenCodeSDKAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('forwards the working path when creating a session', async () => {
    const createSession = vi.fn().mockResolvedValue({
      data: { id: 'session-1', createdAt: '2026-03-09T00:00:00.000Z' },
    })
    const client = {
      session: {
        create: createSession,
      },
    } as unknown as ReturnType<typeof import('@opencode-ai/sdk/v2').createOpencodeClient>
    const adapter = new OpenCodeSDKAdapter(9999, client)

    await adapter.createSession('/tmp/worktree')

    expect(createSession).toHaveBeenCalledTimes(1)
    expect(createSession).toHaveBeenCalledWith({ directory: '/tmp/worktree' }, undefined)
  })

  it('stops the per-prompt event stream when the prompt resolves', async () => {
    let streamSignal: AbortSignal | undefined
    let streamClosed = false

    const client = {
      session: {
        get: vi.fn().mockResolvedValue({ data: { directory: '/tmp/worktree' } }),
        prompt: vi.fn().mockResolvedValue({
          data: { parts: [{ type: 'text', text: 'final answer' }] },
        }),
      },
      event: {
        subscribe: vi.fn().mockImplementation((_args, options?: { signal?: AbortSignal }) => {
          streamSignal = options?.signal
          return {
            stream: (async function *streamEvents() {
              if (options?.signal?.aborted && streamClosed) {
                yield { type: 'session_error', sessionId: 'unused', error: 'unused' } as StreamEvent
              }
              try {
                while (!options?.signal?.aborted) {
                  await new Promise(resolve => setTimeout(resolve, 10))
                }
              } finally {
                streamClosed = true
              }
            })(),
          }
        }),
      },
    } as unknown as ReturnType<typeof import('@opencode-ai/sdk/v2').createOpencodeClient>

    const adapter = new OpenCodeSDKAdapter(9999, client)
    const events: StreamEvent[] = []

    const response = await adapter.promptSession(
      'session-1',
      [{ type: 'text', content: 'hello' }],
      undefined,
      { onEvent: event => events.push(event) },
    )

    expect(response).toBe('final answer')
    expect(streamSignal?.aborted).toBe(true)
    expect(streamClosed).toBe(true)
    expect(events.find(event => event.type === 'session_error')).toBeUndefined()
  })

  it('suppresses duplicate completed part updates from the event stream', async () => {
    const client = {
      session: {
        get: vi.fn().mockResolvedValue({ data: { directory: '/tmp/worktree' } }),
      },
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: (async function *streamEvents() {
            yield {
              type: 'message.part.updated',
              properties: {
                part: {
                  id: 'part-1',
                  sessionID: 'session-1',
                  messageID: 'msg-1',
                  type: 'text',
                  text: 'hello',
                  time: { end: 1 },
                },
              },
            }
            yield {
              type: 'message.part.updated',
              properties: {
                part: {
                  id: 'part-1',
                  sessionID: 'session-1',
                  messageID: 'msg-1',
                  type: 'text',
                  text: 'hello',
                  time: { end: 1 },
                },
              },
            }
            yield {
              type: 'session.idle',
              properties: {
                info: { id: 'session-1' },
              },
            }
          })(),
        }),
      },
    } as unknown as ReturnType<typeof import('@opencode-ai/sdk/v2').createOpencodeClient>

    const adapter = new OpenCodeSDKAdapter(9999, client)
    const events: StreamEvent[] = []

    for await (const event of adapter.subscribeToEvents('session-1')) {
      events.push(event)
    }

    expect(events.filter(event => event.type === 'text')).toHaveLength(1)
    expect(events.filter(event => event.type === 'done')).toHaveLength(1)
  })
})
