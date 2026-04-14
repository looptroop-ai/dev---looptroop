import type {
  HealthStatus,
  Message,
  MessageInfo,
  OpenCodeSessionCreateOptions,
  PromptPart,
  PromptSessionOptions,
  Session,
  StreamEvent,
} from './types'
import type { OpenCodeAdapter } from './adapter'

export class MockOpenCodeAdapter implements OpenCodeAdapter {
  public sessions: Session[] = []
  public messages: Map<string, Message[]> = new Map()
  public mockResponses: Map<string, string> = new Map()
  public mockStreamEvents: Map<string, StreamEvent[]> = new Map()
  public mockAssistantInfos: Map<string, Partial<MessageInfo>> = new Map()
  public sessionCreateCalls: Array<{
    projectPath: string
    options?: OpenCodeSessionCreateOptions
  }> = []
  public promptCalls: Array<{
    sessionId: string
    parts: PromptPart[]
    options?: PromptSessionOptions
  }> = []
  private sessionCounter = 0

  async createSession(
    projectPath: string,
    _signal?: AbortSignal,
    options?: OpenCodeSessionCreateOptions,
  ): Promise<Session> {
    this.sessionCreateCalls.push({ projectPath, options })
    const session: Session = {
      id: `mock-session-${++this.sessionCounter}`,
      projectPath,
      createdAt: new Date().toISOString(),
    }
    this.sessions.push(session)
    return session
  }

  async promptSession(
    sessionId: string,
    parts: PromptPart[],
    _signal?: AbortSignal,
    options?: PromptSessionOptions,
  ): Promise<string> {
    this.promptCalls.push({ sessionId, parts, options })
    const promptText = parts.map(part => part.content).join('\n')
    const response = this.mockResponses.get(sessionId) ?? this.buildMockResponse(promptText)
    const queuedStreamEvents = this.mockStreamEvents.get(sessionId) ?? []
    const queuedAssistantInfo = this.mockAssistantInfos.get(sessionId)

    const messages = this.messages.get(sessionId) ?? []
    for (const part of parts) {
      messages.push({
        id: `msg-${Date.now()}`,
        role: 'user',
        content: part.content,
        timestamp: new Date().toISOString(),
      })
    }

    for (const event of queuedStreamEvents) {
      options?.onEvent?.(event)
    }

    const assistantMessageId = `msg-${Date.now()}-resp`
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: response,
      timestamp: new Date().toISOString(),
      ...(queuedAssistantInfo
        ? {
            info: {
              id: assistantMessageId,
              sessionID: sessionId,
              role: 'assistant',
              ...queuedAssistantInfo,
            },
          }
        : {}),
    }
    messages.push(assistantMessage)
    this.messages.set(sessionId, messages)

    options?.onEvent?.({
      type: 'text',
      sessionId,
      messageId: assistantMessage.id,
      partId: `part-${assistantMessage.id}`,
      text: response,
      streaming: false,
      complete: true,
    })
    options?.onEvent?.({ type: 'done', sessionId })

    return response
  }

  private buildMockResponse(promptText: string): string {
    if (promptText.includes('Score each draft')) {
      const draftCount = Array.from(promptText.matchAll(/Draft\s+\d+:/g)).length || 3
      const rubricCategories = Array.from(promptText.matchAll(/- ([^\n(]+?) \(\d+pts\):/g))
        .map((match) => match[1]?.trim())
        .filter((category): category is string => Boolean(category))
      const fallbackCategories = [
        'Coverage of requirements',
        'Correctness / feasibility',
        'Testability',
        'Minimal complexity / good decomposition',
        'Risks / edge cases addressed',
      ]
      const categories = rubricCategories.length > 0 ? rubricCategories : fallbackCategories
      const renderDraft = (label: string, scores: number[]) => [
        `  ${label}:`,
        ...categories.map((category, index) => `    ${category}: ${scores[index] ?? 15}`),
        `    total_score: ${categories.reduce((sum, _, index) => sum + (scores[index] ?? 15), 0)}`,
      ]
      const scoreRows = Array.from({ length: draftCount }, (_, index) => {
        const score = Math.max(12, 18 - index)
        return Array.from({ length: categories.length }, () => score)
      })
      return [
        'draft_scores:',
        ...scoreRows.flatMap((scores, index) => renderDraft(`Draft ${index + 1}`, scores)),
      ].join('\n')
    }

    if (promptText.includes('## Winning Draft')) {
      return 'Mock refined response'
    }

    if (promptText.includes('<FINAL_TEST_COMMANDS>') || promptText.includes('FINAL_TEST_COMMANDS')) {
      return '<FINAL_TEST_COMMANDS>{"commands":["echo mock-final-test"],"summary":"mock final test plan"}</FINAL_TEST_COMMANDS>'
    }

    return 'Mock response'
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

  async *subscribeToEvents(sessionId: string, _signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    yield { type: 'done', sessionId }
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
