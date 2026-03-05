import type { Session, Message, PromptPart, StreamEvent, HealthStatus } from './types'
import type { TicketState } from './contextBuilder'

export interface OpenCodeAdapter {
  createSession(projectPath: string, signal?: AbortSignal): Promise<Session>
  promptSession(sessionId: string, parts: PromptPart[], signal?: AbortSignal): Promise<string>
  listSessions(): Promise<Session[]>
  getSessionMessages(sessionId: string): Promise<Message[]>
  subscribeToEvents(sessionId: string): AsyncGenerator<StreamEvent>
  abortSession(sessionId: string): Promise<boolean>
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

  async createSession(_projectPath: string, signal?: AbortSignal): Promise<Session> {
    try {
      const res = await fetch(`${this.baseUrl}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal,
      })
      if (!res.ok) throw new Error(`OpenCode API error: ${res.status}`)
      return (await res.json()) as Session
    } catch (err) {
      throw new Error(
        `Failed to create OpenCode session: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  async promptSession(sessionId: string, parts: PromptPart[], signal?: AbortSignal): Promise<string> {
    try {
      const res = await fetch(`${this.baseUrl}/session/${sessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parts: parts.map(p => ({ type: 'text', text: p.content })),
        }),
        signal,
      })
      if (!res.ok) throw new Error(`OpenCode API error: ${res.status}`)
      const data = (await res.json()) as { parts?: Array<{ type: string; text?: string }> }
      const responseText = (data.parts ?? [])
        .filter(p => p.type === 'text')
        .map(p => p.text ?? '')
        .join('')
      if (!responseText) {
        console.warn(`[adapter] promptSession: OpenCode returned empty response for session=${sessionId}`)
      }
      return responseText
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

  async abortSession(sessionId: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/session/${sessionId}/abort`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) return false
      return (await res.json()) as boolean
    } catch {
      return false
    }
  }

  async *subscribeToEvents(sessionId: string): AsyncGenerator<StreamEvent> {
    yield { type: 'done', data: `Subscribed to ${sessionId}` }
  }

  async assembleBeadContext(ticketId: string, beadId: string): Promise<PromptPart[]> {
    const { buildMinimalContext } = await import('./contextBuilder')
    const ticketState = await this.loadTicketState(ticketId)
    console.log(`[adapter] assembleBeadContext ticket=${ticketId} bead=${beadId} hasDescription=${!!ticketState.description}`)
    return buildMinimalContext('coding', ticketState, beadId)
  }

  async assembleCouncilContext(ticketId: string, phase: string): Promise<PromptPart[]> {
    const { buildMinimalContext } = await import('./contextBuilder')
    const ticketState = await this.loadTicketState(ticketId)
    console.log(`[adapter] assembleCouncilContext ticket=${ticketId} phase=${phase} hasDescription=${!!ticketState.description} hasCodebaseMap=${!!ticketState.codebaseMap}`)
    return buildMinimalContext(phase, ticketState)
  }

  private async loadTicketState(ticketId: string): Promise<TicketState> {
    const { db } = await import('../db/index')
    const { tickets } = await import('../db/schema')
    const { existsSync, readFileSync } = await import('fs')
    const { resolve } = await import('path')

    const state: TicketState = { ticketId }

    // Try to load ticket from DB (ticketId may be externalId or numeric id)
    const allTickets = db.select().from(tickets).all()
    const ticket = allTickets.find(t => t.externalId === ticketId || String(t.id) === ticketId)
    if (ticket) {
      state.title = ticket.title
      state.description = ticket.description ?? undefined
    } else {
      console.warn(`[adapter] loadTicketState: ticket not found in DB for id=${ticketId}`)
    }

    const externalId = ticket?.externalId ?? ticketId
    const ticketDir = resolve(process.cwd(), '.looptroop/worktrees', externalId, '.ticket')

    // Load all available artifacts from disk so later phases get full context
    const artifactLoaders: { file: string; field: keyof TicketState }[] = [
      { file: 'codebase-map.yaml', field: 'codebaseMap' },
      { file: 'interview.yaml', field: 'interview' },
      { file: 'prd.yaml', field: 'prd' },
    ]

    for (const { file, field } of artifactLoaders) {
      const filePath = resolve(ticketDir, file)
      if (existsSync(filePath)) {
        try {
          ;(state as unknown as Record<string, unknown>)[field] = readFileSync(filePath, 'utf-8')
        } catch (err) {
          console.warn(`[adapter] Failed to read ${file}:`, err)
        }
      }
    }

    // Load beads from issues.jsonl
    const beadsPath = resolve(ticketDir, 'beads', 'main', '.beads', 'issues.jsonl')
    if (existsSync(beadsPath)) {
      try {
        state.beads = readFileSync(beadsPath, 'utf-8')
      } catch (err) {
        console.warn(`[adapter] Failed to read issues.jsonl:`, err)
      }
    }

    return state
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

  async createSession(projectPath: string, _signal?: AbortSignal): Promise<Session> {
    const session: Session = {
      id: `mock-session-${++this.sessionCounter}`,
      projectPath,
      createdAt: new Date().toISOString(),
    }
    this.sessions.push(session)
    return session
  }

  async promptSession(sessionId: string, parts: PromptPart[], _signal?: AbortSignal): Promise<string> {
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

  async abortSession(_sessionId: string): Promise<boolean> {
    return true
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

