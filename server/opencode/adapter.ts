import { createOpencodeClient } from '@opencode-ai/sdk/v2'
import type {
  GenericMessagePart,
  HealthStatus,
  Message,
  PromptPart,
  PromptSessionOptions,
  ReasoningMessagePart,
  Session,
  StepFinishMessagePart,
  StreamEvent,
  TextMessagePart,
  ToolMessagePart,
} from './types'
import { parseModelRef } from './types'
import type { TicketState } from './contextBuilder'
import { resolve } from 'path'

interface RawEvent {
  type: string
  properties?: Record<string, unknown>
}

export interface OpenCodeAdapter {
  createSession(projectPath: string, signal?: AbortSignal): Promise<Session>
  promptSession(
    sessionId: string,
    parts: PromptPart[],
    signal?: AbortSignal,
    options?: PromptSessionOptions,
  ): Promise<string>
  listSessions(): Promise<Session[]>
  getSessionMessages(sessionId: string): Promise<Message[]>
  subscribeToEvents(sessionId: string, signal?: AbortSignal): AsyncGenerator<StreamEvent>
  abortSession(sessionId: string): Promise<boolean>
  assembleBeadContext(ticketId: string, beadId: string): Promise<PromptPart[]>
  assembleCouncilContext(ticketId: string, phase: string): Promise<PromptPart[]>
  checkHealth(): Promise<HealthStatus>
}

// Real implementation — connects to opencode serve on port 4096
export class OpenCodeSDKAdapter implements OpenCodeAdapter {
  private client: ReturnType<typeof createOpencodeClient>
  private sessionDirectories = new Map<string, string>()

  constructor(port = 4096, client?: ReturnType<typeof createOpencodeClient>) {
    this.client = client ?? createOpencodeClient({ baseUrl: `http://localhost:${port}` })
  }

  async createSession(projectPath: string, signal?: AbortSignal): Promise<Session> {
    try {
      const res = await this.client.session.create(
        { directory: projectPath },
        this.requestOptions(signal),
      )
      if (!res.data) throw new Error('OpenCode returned no session payload')
      const session = this.mapSession(res.data as Record<string, unknown>)
      this.sessionDirectories.set(session.id, projectPath)
      return session
    } catch (err) {
      if (err instanceof Error && (err.name === 'AbortError' || signal?.aborted)) throw err
      throw new Error(
        `Failed to create OpenCode session: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  async promptSession(
    sessionId: string,
    parts: PromptPart[],
    signal?: AbortSignal,
    options?: PromptSessionOptions,
  ): Promise<string> {
    const promptOptions = {
      ...options,
      signal: options?.signal ?? signal,
    }
    const model = promptOptions.model ?? parseModelRef(promptOptions.modelRef)

    const directory = await this.resolveSessionDirectory(sessionId)
    const { systemText, promptParts } = this.partitionPromptParts(parts, promptOptions.system)
    const streamDrain = promptOptions.onEvent
      ? this.consumeStreamEvents(sessionId, promptOptions.onEvent, promptOptions.signal)
      : null

    try {
      const res = await this.client.session.prompt({
        sessionID: sessionId,
        ...(directory ? { directory } : {}),
        ...(model ? { model } : {}),
        ...(promptOptions.agent ? { agent: promptOptions.agent } : {}),
        ...(promptOptions.variant ? { variant: promptOptions.variant } : {}),
        ...(systemText ? { system: systemText } : {}),
        ...(typeof promptOptions.noReply === 'boolean' ? { noReply: promptOptions.noReply } : {}),
        ...(promptOptions.tools ? { tools: promptOptions.tools } : {}),
        parts: promptParts,
      }, this.requestOptions(promptOptions.signal))

      const responseText = this.extractResponseText(res.data?.parts)
      if (!responseText) {
        console.warn(`[adapter] promptSession: OpenCode returned empty response for session=${sessionId}`)
      }
      await this.waitForStreamDrain(streamDrain)
      return responseText
    } catch (err) {
      await this.waitForStreamDrain(streamDrain)
      if (err instanceof Error && (err.name === 'AbortError' || promptOptions.signal?.aborted)) throw err
      throw new Error(
        `Failed to prompt OpenCode session: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  async listSessions(): Promise<Session[]> {
    try {
      const res = await this.client.session.list({ limit: 1000 })
      return Array.isArray(res.data)
        ? res.data.map(session => this.mapSession(session as Record<string, unknown>))
        : []
    } catch {
      return []
    }
  }

  async getSessionMessages(sessionId: string): Promise<Message[]> {
    try {
      const directory = await this.resolveSessionDirectory(sessionId)
      const res = await this.client.session.messages({
        sessionID: sessionId,
        ...(directory ? { directory } : {}),
        limit: 10000,
      })
      return Array.isArray(res.data) ? res.data as unknown as Message[] : []
    } catch {
      return []
    }
  }

  async abortSession(sessionId: string): Promise<boolean> {
    try {
      const directory = await this.resolveSessionDirectory(sessionId)
      await this.client.session.abort({
        sessionID: sessionId,
        ...(directory ? { directory } : {}),
      }, this.requestOptions(AbortSignal.timeout(5000)))
      return true
    } catch {
      return false
    }
  }

  async *subscribeToEvents(sessionId: string, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const directory = await this.resolveSessionDirectory(sessionId)
    const eventStream = await this.client.event.subscribe(
      directory ? { directory } : undefined,
      this.requestOptions(signal),
    )

    const partCache = new Map<string, GenericMessagePart>()
    let emittedDone = false
    let lastStatus: string | undefined

    for await (const rawEvent of eventStream.stream as AsyncIterable<RawEvent>) {
      if (signal?.aborted) break
      if (!this.eventBelongsToSession(rawEvent, sessionId)) continue

      const normalized = this.normalizeStreamEvent(rawEvent, sessionId, partCache)
      if (!normalized) continue

      if (normalized.type === 'session_status') {
        if (normalized.status === lastStatus) continue
        lastStatus = normalized.status
      }

      yield normalized

      if (normalized.type === 'done') {
        emittedDone = true
        break
      }
    }

    if (!emittedDone) {
      yield { type: 'done', sessionId }
    }
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
    const { existsSync, readFileSync } = await import('fs')
    const { getTicketContext, getTicketPaths } = await import('../storage/tickets')

    const state: TicketState = { ticketId }

    const ticket = getTicketContext(ticketId)
    if (ticket) {
      state.title = ticket.localTicket.title
      state.description = ticket.localTicket.description ?? undefined
    } else {
      console.warn(`[adapter] loadTicketState: ticket not found in DB for id=${ticketId}`)
    }

    const paths = getTicketPaths(ticketId)
    if (!paths) return state
    const ticketDir = paths.ticketDir

    const artifactLoaders: { file: string; field: keyof TicketState }[] = [
      { file: 'codebase-map.yaml', field: 'codebaseMap' },
      { file: 'interview.yaml', field: 'interview' },
      { file: 'prd.yaml', field: 'prd' },
    ]

    for (const { file, field } of artifactLoaders) {
      const filePath = resolve(ticketDir, file)
      if (!existsSync(filePath)) continue
      try {
        ;(state as unknown as Record<string, unknown>)[field] = readFileSync(filePath, 'utf-8')
      } catch (err) {
        console.warn(`[adapter] Failed to read ${file}:`, err)
      }
    }

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
      const health = await this.client.global.health(this.requestOptions(AbortSignal.timeout(5000)))
      const version = health.data?.version ? String(health.data.version) : 'unknown'
      const providers = await this.client.config.providers()
      return {
        available: true,
        version,
        models: this.extractConnectedModelIds(providers.data),
      }
    } catch {
      // fall through to session fallback
    }
    try {
      await this.client.session.status(undefined, this.requestOptions(AbortSignal.timeout(5000)))
      return { available: true, version: 'unknown', models: [] }
    } catch (err) {
      return {
        available: false,
        error: err instanceof Error ? err.message : 'Connection failed',
      }
    }
  }

  private requestOptions(signal?: AbortSignal) {
    return signal ? { signal } : undefined
  }

  private mapSession(session: Record<string, unknown>): Session {
    const time = this.getRecord(session.time)
    return {
      id: String(session.id),
      slug: typeof session.slug === 'string' ? session.slug : undefined,
      projectPath: typeof session.directory === 'string' ? session.directory : undefined,
      directory: typeof session.directory === 'string' ? session.directory : undefined,
      createdAt: typeof time?.created === 'number' ? new Date(time.created).toISOString() : undefined,
      updatedAt: typeof time?.updated === 'number' ? new Date(time.updated).toISOString() : undefined,
      title: typeof session.title === 'string' ? session.title : undefined,
      version: typeof session.version === 'string' ? session.version : undefined,
    }
  }

  private partitionPromptParts(parts: PromptPart[], fallbackSystem?: string) {
    const systemParts = parts
      .filter(part => part.type === 'system')
      .map(part => part.content.trim())
      .filter(Boolean)

    const promptParts = parts
      .filter(part => part.type !== 'system')
      .map(part => ({ type: 'text' as const, text: part.content }))

    return {
      systemText: [fallbackSystem?.trim(), ...systemParts].filter(Boolean).join('\n\n'),
      promptParts: promptParts.length > 0 ? promptParts : [{ type: 'text' as const, text: '' }],
    }
  }

  private extractResponseText(parts: unknown): string {
    if (!Array.isArray(parts)) return ''
    return parts
      .filter((part): part is { type?: string; text?: string } => Boolean(part && typeof part === 'object'))
      .filter(part => part.type === 'text')
      .map(part => part.text ?? '')
      .join('')
  }

  private async resolveSessionDirectory(sessionId: string): Promise<string | undefined> {
    const cached = this.sessionDirectories.get(sessionId)
    if (cached) return cached

    try {
      const res = await this.client.session.get({ sessionID: sessionId })
      const directory = typeof res.data?.directory === 'string' ? res.data.directory : undefined
      if (directory) this.sessionDirectories.set(sessionId, directory)
      return directory
    } catch {
      return undefined
    }
  }

  private async consumeStreamEvents(
    sessionId: string,
    onEvent: (event: StreamEvent) => void,
    signal?: AbortSignal,
  ) {
    try {
      for await (const event of this.subscribeToEvents(sessionId, signal)) {
        onEvent(event)
        if (event.type === 'done') break
      }
    } catch (error) {
      onEvent({
        type: 'session_error',
        sessionId,
        error: error instanceof Error ? error.message : String(error),
        details: error,
      })
    }
  }

  private async waitForStreamDrain(streamDrain: Promise<void> | null) {
    if (!streamDrain) return
    await Promise.race([
      streamDrain,
      new Promise<void>(resolve => setTimeout(resolve, 2000)),
    ])
  }

  private eventBelongsToSession(event: RawEvent, sessionId: string): boolean {
    const props = event.properties ?? {}
    const part = this.getRecord(props.part)
    const info = this.getRecord(props.info)

    const eventSessionId = typeof props.sessionID === 'string'
      ? props.sessionID
      : typeof info?.sessionID === 'string'
        ? info.sessionID
        : typeof part?.sessionID === 'string'
          ? part.sessionID
          : event.type.startsWith('session.') && typeof info?.id === 'string'
            ? info.id
            : undefined

    return eventSessionId === sessionId
  }

  private normalizeStreamEvent(
    event: RawEvent,
    sessionId: string,
    partCache: Map<string, GenericMessagePart>,
  ): StreamEvent | null {
    const props = event.properties ?? {}

    switch (event.type) {
      case 'message.part.updated': {
        const part = this.getRecord(props.part) as GenericMessagePart | null
        if (!part?.id) return null
        partCache.set(String(part.id), part)
        return this.mapPartUpdate(part)
      }

      case 'message.part.delta': {
        const partId = typeof props.partID === 'string' ? props.partID : undefined
        const delta = typeof props.delta === 'string' ? props.delta : ''
        if (!partId || !delta) return null
        const part = partCache.get(partId)
        if (!part) return null
        return this.mapPartDelta(part, delta)
      }

      case 'message.part.removed':
        return {
          type: 'part_removed',
          sessionId,
          partId: typeof props.partID === 'string' ? props.partID : undefined,
        }

      case 'session.status': {
        const status = this.getRecord(props.status)
        const statusType = typeof status?.type === 'string' ? status.type : 'busy'
        return {
          type: 'session_status',
          sessionId,
          status: statusType === 'retry' ? 'retry' : (statusType === 'idle' ? 'idle' : 'busy'),
          attempt: typeof status?.attempt === 'number' ? status.attempt : undefined,
          message: typeof status?.message === 'string' ? status.message : undefined,
          next: typeof status?.next === 'number' ? status.next : undefined,
        }
      }

      case 'session.error':
        return {
          type: 'session_error',
          sessionId,
          error: this.describeError(props.error ?? props),
          details: props.error ?? props,
        }

      case 'permission.asked':
      case 'permission.updated': {
        const details = this.getRecord(props)
        return {
          type: 'permission',
          sessionId,
          permissionId: typeof details?.id === 'string' ? details.id : '',
          permission: typeof details?.permission === 'string' ? details.permission : undefined,
          title: typeof details?.title === 'string' ? details.title : undefined,
          patterns: Array.isArray(details?.patterns)
            ? details.patterns.filter((pattern): pattern is string => typeof pattern === 'string')
            : undefined,
          details: details ?? undefined,
        }
      }

      case 'session.idle':
        return { type: 'done', sessionId }

      default:
        return null
    }
  }

  private mapPartUpdate(part: GenericMessagePart): StreamEvent | null {
    const sessionId = String(part.sessionID)
    const messageId = String(part.messageID)
    const partId = String(part.id)

    if (part.type === 'text') {
      const textPart = part as TextMessagePart
      if (!textPart.text && !textPart.time?.end) return null
      return {
        type: 'text',
        sessionId,
        messageId,
        partId,
        text: textPart.text ?? '',
        streaming: !textPart.time?.end,
        complete: Boolean(textPart.time?.end),
      }
    }

    if (part.type === 'reasoning') {
      const reasoningPart = part as ReasoningMessagePart
      if (!reasoningPart.text && !reasoningPart.time?.end) return null
      return {
        type: 'reasoning',
        sessionId,
        messageId,
        partId,
        text: reasoningPart.text ?? '',
        streaming: !reasoningPart.time?.end,
        complete: Boolean(reasoningPart.time?.end),
      }
    }

    if (part.type === 'tool') {
      const toolPart = part as unknown as ToolMessagePart
      return {
        type: 'tool',
        sessionId,
        messageId,
        partId,
        tool: toolPart.tool,
        callId: toolPart.callID,
        status: toolPart.state.status,
        title: toolPart.state.title,
        output: typeof toolPart.state.output === 'string' ? toolPart.state.output : undefined,
        error: typeof toolPart.state.error === 'string' ? toolPart.state.error : undefined,
        metadata: toolPart.metadata,
        complete: toolPart.state.status === 'completed' || toolPart.state.status === 'error',
      }
    }

    if (part.type === 'step-start') {
      return {
        type: 'step',
        sessionId,
        messageId,
        partId,
        step: 'start',
        snapshot: typeof part.snapshot === 'string' ? part.snapshot : undefined,
        complete: true,
      }
    }

    if (part.type === 'step-finish') {
      const finishPart = part as unknown as StepFinishMessagePart
      return {
        type: 'step',
        sessionId,
        messageId,
        partId,
        step: 'finish',
        reason: finishPart.reason,
        snapshot: typeof finishPart.snapshot === 'string' ? finishPart.snapshot : undefined,
        cost: typeof finishPart.cost === 'number' ? finishPart.cost : undefined,
        tokens: finishPart.tokens,
        complete: true,
      }
    }

    return null
  }

  private mapPartDelta(part: GenericMessagePart, delta: string): StreamEvent | null {
    const sessionId = String(part.sessionID)
    const messageId = String(part.messageID)
    const partId = String(part.id)
    const nextText = `${typeof part.text === 'string' ? part.text : ''}${delta}`
    part.text = nextText

    if (part.type === 'reasoning') {
      return {
        type: 'reasoning',
        sessionId,
        messageId,
        partId,
        text: nextText,
        delta,
        streaming: true,
        complete: false,
      }
    }

    if (part.type === 'text') {
      return {
        type: 'text',
        sessionId,
        messageId,
        partId,
        text: nextText,
        delta,
        streaming: true,
        complete: false,
      }
    }

    return null
  }

  private describeError(error: unknown): string {
    if (!error) return 'Unknown OpenCode error'
    if (typeof error === 'string') return error
    if (typeof error === 'object') {
      const record = error as Record<string, unknown>
      if (typeof record.message === 'string') return record.message
      const data = this.getRecord(record.data)
      if (typeof data?.message === 'string') return data.message
      try {
        return JSON.stringify(error)
      } catch {
        return String(error)
      }
    }
    return String(error)
  }

  private extractConnectedModelIds(data: unknown): string[] {
    const record = this.getRecord(data)
    const providers = Array.isArray(record?.providers) ? record.providers : []
    const modelIds: string[] = []

    for (const provider of providers) {
      const providerRecord = this.getRecord(provider)
      const providerId = typeof providerRecord?.id === 'string' ? providerRecord.id : undefined
      const models = this.getRecord(providerRecord?.models)
      if (!providerId || !models) continue
      for (const modelId of Object.keys(models)) {
        modelIds.push(`${providerId}/${modelId}`)
      }
    }

    return modelIds.slice(0, 50)
  }

  private getRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? value as Record<string, unknown> : null
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

  async promptSession(
    sessionId: string,
    parts: PromptPart[],
    _signal?: AbortSignal,
    options?: PromptSessionOptions,
  ): Promise<string> {
    const response = this.mockResponses.get(sessionId) ?? 'Mock response'

    const messages = this.messages.get(sessionId) ?? []
    for (const part of parts) {
      messages.push({
        id: `msg-${Date.now()}`,
        role: 'user',
        content: part.content,
        timestamp: new Date().toISOString(),
      })
    }

    const assistantMessage: Message = {
      id: `msg-${Date.now()}-resp`,
      role: 'assistant',
      content: response,
      timestamp: new Date().toISOString(),
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
