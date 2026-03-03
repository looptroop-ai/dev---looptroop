import type { Session, Message, PromptPart, StreamEvent, HealthStatus } from './types'

export interface OpenCodeAdapter {
  createSession(projectPath: string): Promise<Session>
  promptSession(sessionId: string, parts: PromptPart[]): Promise<string>
  listSessions(): Promise<Session[]>
  getSessionMessages(sessionId: string): Promise<Message[]>
  subscribeToEvents(sessionId: string): AsyncGenerator<StreamEvent>
  assembleBeadContext(ticketId: string, beadId: string): Promise<PromptPart[]>
  assembleCouncilContext(ticketId: string, phase: string): Promise<PromptPart[]>
  checkHealth(): Promise<HealthStatus>
}

// Real implementation — connects to opencode serve on port 4096
export class OpenCodeSDKAdapter implements OpenCodeAdapter {
  private baseUrl: string

  constructor(port = 4096) {
    this.baseUrl = `http://localhost:${port}`
  }

  async createSession(_projectPath: string): Promise<Session> {
    try {
      const res = await fetch(`${this.baseUrl}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error(`OpenCode API error: ${res.status}`)
      return (await res.json()) as Session
    } catch (err) {
      throw new Error(
        `Failed to create OpenCode session: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  async promptSession(sessionId: string, parts: PromptPart[]): Promise<string> {
    try {
      const res = await fetch(`${this.baseUrl}/session/${sessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parts: parts.map(p => ({ type: 'text', text: p.content })),
        }),
      })
      if (!res.ok) throw new Error(`OpenCode API error: ${res.status}`)
      const data = (await res.json()) as { parts?: Array<{ type: string; text?: string }> }
      return (data.parts ?? [])
        .filter(p => p.type === 'text')
        .map(p => p.text ?? '')
        .join('')
    } catch (err) {
      throw new Error(
        `Failed to prompt OpenCode session: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  async listSessions(): Promise<Session[]> {
    try {
      const res = await fetch(`${this.baseUrl}/session`)
      if (!res.ok) return []
      return (await res.json()) as Session[]
    } catch {
      return []
    }
  }

  async getSessionMessages(sessionId: string): Promise<Message[]> {
    try {
      const res = await fetch(`${this.baseUrl}/session/${sessionId}/message`)
      if (!res.ok) return []
      return (await res.json()) as Message[]
    } catch {
      return []
    }
  }

  async *subscribeToEvents(sessionId: string): AsyncGenerator<StreamEvent> {
    yield { type: 'done', data: `Subscribed to ${sessionId}` }
  }

  async assembleBeadContext(ticketId: string, beadId: string): Promise<PromptPart[]> {
    const { buildMinimalContext } = await import('./contextBuilder')
    return buildMinimalContext('coding', { ticketId }, beadId)
  }

  async assembleCouncilContext(ticketId: string, phase: string): Promise<PromptPart[]> {
    const { buildMinimalContext } = await import('./contextBuilder')
    return buildMinimalContext(phase, { ticketId })
  }

  async checkHealth(): Promise<HealthStatus> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>
        return { available: true, version: String(data.version ?? 'unknown'), models: [] }
      }
    } catch {
      // fall through to session fallback
    }
    try {
      const res = await fetch(`${this.baseUrl}/session`, {
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) return { available: false, error: `HTTP ${res.status}` }
      return { available: true, version: 'unknown', models: [] }
    } catch (err) {
      return {
        available: false,
        error: err instanceof Error ? err.message : 'Connection failed',
      }
    }
  }
}

// Mock adapter for testing
export class MockOpenCodeAdapter implements OpenCodeAdapter {
  public sessions: Session[] = []
  public messages: Map<string, Message[]> = new Map()
  public mockResponses: Map<string, string> = new Map()
  private sessionCounter = 0

  async createSession(projectPath: string): Promise<Session> {
    const session: Session = {
      id: `mock-session-${++this.sessionCounter}`,
      projectPath,
      createdAt: new Date().toISOString(),
    }
    this.sessions.push(session)
    return session
  }

  async promptSession(sessionId: string, parts: PromptPart[]): Promise<string> {
    const response = this.mockResponses.get(sessionId) ?? 'Mock response'

    // Store as message
    const messages = this.messages.get(sessionId) ?? []
    for (const part of parts) {
      messages.push({
        id: `msg-${Date.now()}`,
        role: 'user',
        content: part.content,
        timestamp: new Date().toISOString(),
      })
    }
    messages.push({
      id: `msg-${Date.now()}-resp`,
      role: 'assistant',
      content: response,
      timestamp: new Date().toISOString(),
    })
    this.messages.set(sessionId, messages)

    return response
  }

  async listSessions(): Promise<Session[]> {
    return this.sessions
  }

  async getSessionMessages(sessionId: string): Promise<Message[]> {
    return this.messages.get(sessionId) ?? []
  }

  async *subscribeToEvents(_sessionId: string): AsyncGenerator<StreamEvent> {
    yield { type: 'done', data: '' }
  }

  async assembleBeadContext(_ticketId: string, _beadId: string): Promise<PromptPart[]> {
    return [{ type: 'text', content: 'Mock bead context' }]
  }

  async assembleCouncilContext(_ticketId: string, _phase: string): Promise<PromptPart[]> {
    return [{ type: 'text', content: 'Mock council context' }]
  }

  async checkHealth(): Promise<HealthStatus> {
    return { available: true, version: 'mock-1.0.0', models: ['mock-model-1', 'mock-model-2'] }
  }
}

