import { createOpencodeClient } from '@opencode-ai/sdk/v2'
import type {
  GenericMessagePart,
  HealthStatus,
  Message,
  MessageInfo,
  MessagePart,
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
import { logIfVerbose, warnIfVerbose } from '../runtime'
import { getOpenCodeBaseUrl } from './runtimeConfig'
import type { Bead } from '../phases/beads/types'
import { looksLikePromptEcho } from '../lib/promptEcho'
import {
  ADAPTER_RETRY_DELAY_MS,
  SDK_OPERATION_TIMEOUT_MS,
  SESSION_LIST_LIMIT,
  MESSAGE_LIST_LIMIT,
  MAX_CATALOG_MODEL_IDS,
} from '../lib/constants'
import {
  analyzeAssistantMessages,
  extractTextFromMessageParts,
} from './assistantMessageAnalysis'

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
  subscribeToEvents(sessionId: string, signal?: AbortSignal, stepFinishSafetyMs?: number): AsyncGenerator<StreamEvent>
  abortSession(sessionId: string): Promise<boolean>
  assembleBeadContext(ticketId: string, beadId: string): Promise<PromptPart[]>
  assembleCouncilContext(ticketId: string, phase: string): Promise<PromptPart[]>
  checkHealth(): Promise<HealthStatus>
}

function formatBeadContext(bead: Bead): string {
  return [
    `# Active Bead`,
    `ID: ${bead.id}`,
    `Title: ${bead.title}`,
    '',
    `## Description`,
    bead.description,
    '',
    `## Context Guidance`,
    bead.contextGuidance || 'No additional guidance provided.',
    '',
    `## Acceptance Criteria`,
    ...bead.acceptanceCriteria.map((item) => `- ${item}`),
    '',
    `## Target Files`,
    ...(bead.targetFiles.length > 0 ? bead.targetFiles.map((item) => `- ${item}`) : ['- No target files listed.']),
    '',
    `## Required Tests`,
    ...bead.tests.map((item) => `- ${item}`),
    '',
    `## Test Commands`,
    ...bead.testCommands.map((item) => `- ${item}`),
    '',
    `## Dependencies`,
    ...(bead.dependencies.length > 0 ? bead.dependencies.map((item) => `- ${item}`) : ['- None']),
  ].join('\n')
}

export class OpenCodeSDKAdapter implements OpenCodeAdapter {
  private client: ReturnType<typeof createOpencodeClient>
  private sessionDirectories = new Map<string, string>()

  constructor(baseUrlOrPort: string | number = getOpenCodeBaseUrl(), client?: ReturnType<typeof createOpencodeClient>) {
    const baseUrl = typeof baseUrlOrPort === 'number'
      ? `http://localhost:${baseUrlOrPort}`
      : baseUrlOrPort
    this.client = client ?? createOpencodeClient({ baseUrl })
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
    const promptSignal = options?.signal ?? signal
    const promptOptions = {
      ...options,
      signal: promptSignal,
    }
    const sdkPromptAbortController = new AbortController()
    const sdkPromptSignal = promptSignal
      ? AbortSignal.any([promptSignal, sdkPromptAbortController.signal])
      : sdkPromptAbortController.signal
    const model = promptOptions.model ?? parseModelRef(promptOptions.modelRef)

    const directory = await this.resolveSessionDirectory(sessionId)
    const { systemText, promptParts } = this.partitionPromptParts(parts, promptOptions.system)
    const streamAbortController = new AbortController()
    const streamSignal = promptSignal
      ? AbortSignal.any([promptSignal, streamAbortController.signal])
      : streamAbortController.signal
    const streamedTextByMessage = new Map<string, Map<string, string>>()
    const streamedTextMessageOrder: string[] = []
    const streamedTextPartIndex = new Map<string, string>()
    let latestTextMessageId: string | undefined
    const rememberStreamText = (event: StreamEvent) => {
      if (event.type === 'text') {
        const messageId = event.messageId ?? '__stream__'
        const partId = event.partId ?? `${messageId}:text`
        let messageParts = streamedTextByMessage.get(messageId)
        if (!messageParts) {
          messageParts = new Map<string, string>()
          streamedTextByMessage.set(messageId, messageParts)
          streamedTextMessageOrder.push(messageId)
        }
        messageParts.set(partId, event.text)
        streamedTextPartIndex.set(partId, messageId)
        latestTextMessageId = messageId
        return
      }

      if (event.type === 'part_removed' && event.partId) {
        const messageId = streamedTextPartIndex.get(event.partId)
        if (!messageId) return
        const messageParts = streamedTextByMessage.get(messageId)
        if (!messageParts) return
        messageParts.delete(event.partId)
        streamedTextPartIndex.delete(event.partId)
        if (messageParts.size > 0) return
        streamedTextByMessage.delete(messageId)
        const orderIndex = streamedTextMessageOrder.lastIndexOf(messageId)
        if (orderIndex >= 0) streamedTextMessageOrder.splice(orderIndex, 1)
        latestTextMessageId = streamedTextMessageOrder[streamedTextMessageOrder.length - 1]
      }
    }
    const buildStreamedTextResponse = (): string => {
      if (!latestTextMessageId) return ''
      const messageParts = streamedTextByMessage.get(latestTextMessageId)
      if (!messageParts || messageParts.size === 0) return ''
      return Array.from(messageParts.values()).join('').trim()
    }
    let resolveStreamDoneResponse: ((value: string | null) => void) | null = null
    let streamDoneObserved = false
    const streamDoneResponse = new Promise<string | null>((resolve) => {
      resolveStreamDoneResponse = resolve
    })
    const streamDrain = this.consumeStreamEvents(
      sessionId,
      (event) => {
        rememberStreamText(event)
        promptOptions.onEvent?.(event)
        if (event.type !== 'done' || streamDoneObserved) return
        streamDoneObserved = true
        void this.readAssistantSnapshotWithRetry(sessionId)
          .then((snapshot) => {
            resolveStreamDoneResponse?.(snapshot.responseText || buildStreamedTextResponse() || null)
          })
          .catch((err) => {
            warnIfVerbose('[adapter] Snapshot retry failed after stream done, falling back to streamed text', err)
            resolveStreamDoneResponse?.(buildStreamedTextResponse() || null)
          })
      },
      streamSignal,
      promptOptions.stepFinishSafetyMs,
    )

    try {
      const sdkPromptResponse = (async () => {
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
        }, this.requestOptions(sdkPromptSignal))

        let responseText = extractTextFromMessageParts(res.data?.parts)
        if (!responseText) {
          const preferredMessageId = typeof this.getRecord(res.data?.info)?.id === 'string'
            ? String(this.getRecord(res.data?.info)?.id)
            : undefined
          responseText = (await this.readAssistantSnapshotWithRetry(sessionId, preferredMessageId)).responseText
        }
        if (!responseText) {
          responseText = buildStreamedTextResponse()
        }
        return responseText
      })()

      const streamFirstResponse = streamDoneResponse.then((snapshot) => {
        if (snapshot) {
          sdkPromptAbortController.abort()
          // Suppress the rejection from the now-aborted SDK prompt — the stream
          // already provided the response so this rejection is expected.
          void sdkPromptResponse.catch(() => undefined)
          return snapshot
        }
        return sdkPromptResponse
      })

      // If the caller's signal fires (e.g. deadline timeout), break the race
      // so promptSession doesn't hang when the SDK client ignores the signal.
      const signalAbort = promptSignal
        ? new Promise<string>((_, reject) => {
            if (promptSignal.aborted) {
              reject(new DOMException('The operation was aborted', 'AbortError'))
              return
            }
            promptSignal.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted', 'AbortError'))
            }, { once: true })
          })
        : null

      let responseText = await Promise.race([
        sdkPromptResponse,
        streamFirstResponse,
        ...(signalAbort ? [signalAbort] : []),
      ])
      if (responseText && looksLikePromptEcho(responseText) && !streamDoneObserved) {
        const terminalResponse = await Promise.race([
          streamDoneResponse.then((snapshot) => snapshot?.trim() ?? ''),
          ...(signalAbort ? [signalAbort] : []),
        ])
        if (terminalResponse) {
          responseText = terminalResponse
        }
      }
      if (!responseText) {
        responseText = buildStreamedTextResponse()
      }
      if (!responseText) {
        warnIfVerbose(`[adapter] promptSession: OpenCode returned empty response for session=${sessionId}`)
      }
      return responseText
    } catch (err) {
      if (err instanceof Error && (err.name === 'AbortError' || promptOptions.signal?.aborted)) throw err
      throw new Error(
        `Failed to prompt OpenCode session: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      streamAbortController.abort()
      await this.waitForStreamDrain(streamDrain)
    }
  }

  async listSessions(): Promise<Session[]> {
    const res = await this.client.session.list({ limit: SESSION_LIST_LIMIT })
    return Array.isArray(res.data)
      ? res.data.map(session => this.mapSession(session as Record<string, unknown>))
      : []
  }

  async getSessionMessages(sessionId: string): Promise<Message[]> {
    try {
      const directory = await this.resolveSessionDirectory(sessionId)
      const res = await this.client.session.messages({
        sessionID: sessionId,
        ...(directory ? { directory } : {}),
        limit: MESSAGE_LIST_LIMIT,
      })
      return Array.isArray(res.data)
        ? res.data.map((entry) => this.mapMessageRecord(entry))
        : []
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
      }, this.requestOptions(AbortSignal.timeout(SDK_OPERATION_TIMEOUT_MS)))
      return true
    } catch {
      return false
    }
  }

  async *subscribeToEvents(sessionId: string, signal?: AbortSignal, stepFinishSafetyMs?: number): AsyncGenerator<StreamEvent> {
    const directory = await this.resolveSessionDirectory(sessionId)
    const eventStream = await this.client.event.subscribe(
      directory ? { directory } : undefined,
      this.requestOptions(signal),
    )

    const partCache = new Map<string, GenericMessagePart>()
    const finalizedPartIds = new Set<string>()
    let emittedDone = false
    let lastStatus: string | undefined
    let safetyActive = false

    const rawIterator = (eventStream.stream as AsyncIterable<RawEvent>)[Symbol.asyncIterator]()

    while (true) {
      if (signal?.aborted) break

      let result: IteratorResult<RawEvent>

      if (safetyActive && stepFinishSafetyMs) {
        const nextPromise = rawIterator.next()
        const expired = Symbol('expired')
        const winner = await Promise.race([
          nextPromise,
          new Promise<typeof expired>((resolve) =>
            setTimeout(() => resolve(expired), stepFinishSafetyMs),
          ),
        ])
        if (winner === expired) {
          // Stream hung after step-finish — suppress pending iterator rejection
          void nextPromise.catch(() => undefined)
          break
        }
        result = winner
      } else {
        result = await rawIterator.next()
      }

      if (result.done) break

      const rawEvent = result.value

      if (!this.eventBelongsToSession(rawEvent, sessionId)) continue

      const normalized = this.normalizeStreamEvent(rawEvent, sessionId, partCache, finalizedPartIds)
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

      // Activate safety deadline after step-finish with terminal reason
      if (
        normalized.type === 'step' &&
        normalized.step === 'finish' &&
        (normalized.reason === 'stop' || normalized.reason === 'end_turn')
      ) {
        safetyActive = true
      }
    }

    if (!emittedDone && !signal?.aborted) {
      yield { type: 'done', sessionId }
    }
  }

  async assembleBeadContext(ticketId: string, beadId: string): Promise<PromptPart[]> {
    const { buildMinimalContext } = await import('./contextBuilder')
    const ticketState = await this.loadTicketState(ticketId, beadId)
    logIfVerbose(`[adapter] assembleBeadContext ticket=${ticketId} bead=${beadId} hasDescription=${!!ticketState.description}`)
    return buildMinimalContext('coding', ticketState, beadId)
  }

  async assembleCouncilContext(ticketId: string, phase: string): Promise<PromptPart[]> {
    const { buildMinimalContext } = await import('./contextBuilder')
    const ticketState = await this.loadTicketState(ticketId)
    logIfVerbose(`[adapter] assembleCouncilContext ticket=${ticketId} phase=${phase} hasDescription=${!!ticketState.description} hasRelevantFiles=${!!ticketState.relevantFiles}`)
    return buildMinimalContext(phase, ticketState)
  }

  private async loadTicketState(ticketId: string, beadId?: string): Promise<TicketState> {
    const { existsSync, readFileSync } = await import('fs')
    const { getTicketContext, getTicketPaths } = await import('../storage/tickets')

    const state: TicketState = { ticketId }

    const ticket = getTicketContext(ticketId)
    if (ticket) {
      state.title = ticket.localTicket.title
      state.description = ticket.localTicket.description ?? undefined
    } else {
      warnIfVerbose(`[adapter] loadTicketState: ticket not found in DB for id=${ticketId}`)
    }

    const paths = getTicketPaths(ticketId)
    if (!paths) return state
    const ticketDir = paths.ticketDir

    const artifactLoaders: { file: string; field: 'interview' | 'prd' }[] = [
      { file: 'interview.yaml', field: 'interview' },
      { file: 'prd.yaml', field: 'prd' },
    ]

    for (const { file, field } of artifactLoaders) {
      const filePath = resolve(ticketDir, file)
      if (!existsSync(filePath)) continue
      try {
        state[field] = readFileSync(filePath, 'utf-8')
      } catch (err) {
        warnIfVerbose(`[adapter] Failed to read ${file}:`, err)
      }
    }

    const beadsPath = paths.beadsPath
    if (existsSync(beadsPath)) {
      try {
        const beadFile = readFileSync(beadsPath, 'utf-8')
        state.beads = beadFile

        if (beadId) {
          const bead = beadFile
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => JSON.parse(line) as Bead)
            .find((entry) => entry.id === beadId)

          if (bead) {
            state.beadData = formatBeadContext(bead)
            state.beadNotes = bead.notes.filter((note) => note.trim().length > 0)
          }
        }
      } catch (err) {
        warnIfVerbose(`[adapter] Failed to read issues.jsonl:`, err)
      }
    }

    return state
  }

  async checkHealth(): Promise<HealthStatus> {
    try {
      const health = await this.client.global.health(this.requestOptions(AbortSignal.timeout(SDK_OPERATION_TIMEOUT_MS)))
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
      await this.client.session.status(undefined, this.requestOptions(AbortSignal.timeout(SDK_OPERATION_TIMEOUT_MS)))
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

  private async readAssistantSnapshotWithRetry(
    sessionId: string,
    preferredMessageId?: string,
    maxAttempts = 4,
    delayMs = 75,
  ): Promise<ReturnType<typeof analyzeAssistantMessages>> {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const messages = await this.getSessionMessages(sessionId)
      const analysis = analyzeAssistantMessages(messages, preferredMessageId)
      if (analysis.responseText || analysis.responseMeta.latestAssistantHasError || analysis.responseMeta.latestAssistantWasStale) {
        return analysis
      }
      if (attempt >= maxAttempts) break
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
    }

    return {
      responseText: '',
      responseMeta: {
        hasAssistantMessage: false,
        latestAssistantWasEmpty: true,
        latestAssistantHasError: false,
        latestAssistantWasStale: false,
      },
    }
  }

  private mapMessageRecord(entry: unknown): Message {
    const record = this.getRecord(entry)
    const info = this.getRecord(record?.info) as MessageInfo | null
    const parts = Array.isArray(record?.parts) ? record.parts as MessagePart[] : []
    const createdAt = typeof info?.time?.created === 'number'
      ? new Date(info.time.created).toISOString()
      : typeof info?.timestamp === 'string'
        ? info.timestamp
        : undefined
    const content = extractTextFromMessageParts(parts)

    return {
      id: typeof info?.id === 'string' ? info.id : '',
      role: typeof info?.role === 'string' ? info.role : undefined,
      content: content || undefined,
      timestamp: createdAt,
      info: info ?? undefined,
      parts,
    }
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
    stepFinishSafetyMs?: number,
  ) {
    try {
      for await (const event of this.subscribeToEvents(sessionId, signal, stepFinishSafetyMs)) {
        onEvent(event)
        if (event.type === 'done') break
      }
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return
      }
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
      new Promise<void>(resolve => setTimeout(resolve, ADAPTER_RETRY_DELAY_MS)),
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
    finalizedPartIds: Set<string>,
  ): StreamEvent | null {
    const props = event.properties ?? {}

    switch (event.type) {
      case 'message.part.updated': {
        const part = this.getRecord(props.part) as GenericMessagePart | null
        if (!part?.id) return null
        const partId = String(part.id)
        if (finalizedPartIds.has(partId)) return null

        const nextPart = this.clonePart(part)
        const previousPart = partCache.get(partId)
        if (previousPart && !this.hasMeaningfulPartUpdate(previousPart, nextPart)) {
          return null
        }

        partCache.set(partId, nextPart)
        const normalized = this.mapPartUpdate(nextPart)
        if (normalized && 'complete' in normalized && normalized.complete) {
          finalizedPartIds.add(partId)
        }
        return normalized
      }

      case 'message.part.delta': {
        const partId = typeof props.partID === 'string' ? props.partID : undefined
        const delta = typeof props.delta === 'string' ? props.delta : ''
        if (!partId || !delta) return null
        if (finalizedPartIds.has(partId)) return null
        const part = partCache.get(partId)
        if (!part) return null
        return this.mapPartDelta(part, delta)
      }

      case 'message.part.removed': {
        const partId = typeof props.partID === 'string' ? props.partID : undefined
        if (partId) {
          partCache.delete(partId)
          finalizedPartIds.delete(partId)
        }
        return {
          type: 'part_removed',
          sessionId,
          partId,
        }
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

  private isToolPart(part: GenericMessagePart): part is GenericMessagePart & ToolMessagePart {
    return part.type === 'tool'
  }

  private isStepFinishPart(part: GenericMessagePart): part is GenericMessagePart & StepFinishMessagePart {
    return part.type === 'step-finish'
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

    if (this.isToolPart(part)) {
      return {
        type: 'tool',
        sessionId,
        messageId,
        partId,
        tool: part.tool,
        callId: part.callID,
        status: part.state.status,
        title: part.state.title,
        output: typeof part.state.output === 'string' ? part.state.output : undefined,
        error: typeof part.state.error === 'string' ? part.state.error : undefined,
        metadata: part.metadata,
        complete: part.state.status === 'completed' || part.state.status === 'error',
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

    if (this.isStepFinishPart(part)) {
      return {
        type: 'step',
        sessionId,
        messageId,
        partId,
        step: 'finish',
        reason: part.reason,
        snapshot: typeof part.snapshot === 'string' ? part.snapshot : undefined,
        cost: typeof part.cost === 'number' ? part.cost : undefined,
        tokens: part.tokens,
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

  private clonePart(part: GenericMessagePart): GenericMessagePart {
    return typeof structuredClone === 'function'
      ? structuredClone(part)
      : JSON.parse(JSON.stringify(part)) as GenericMessagePart
  }

  private hasMeaningfulPartUpdate(previous: GenericMessagePart, next: GenericMessagePart) {
    return this.buildPartStreamKey(previous) !== this.buildPartStreamKey(next)
  }

  private buildPartStreamKey(part: GenericMessagePart): string {
    if (part.type === 'text' || part.type === 'reasoning') {
      return JSON.stringify({
        type: part.type,
        text: typeof part.text === 'string' ? part.text : '',
        end: this.getRecord(part.time)?.end ?? null,
      })
    }

    if (this.isToolPart(part)) {
      return JSON.stringify({
        type: part.type,
        callId: part.callID,
        tool: part.tool,
        status: part.state?.status ?? null,
        title: part.state?.title ?? null,
        output: part.state?.output ?? null,
        error: part.state?.error ?? null,
      })
    }

    if (part.type === 'step-start') {
      return JSON.stringify({
        type: part.type,
        snapshot: typeof part.snapshot === 'string' ? part.snapshot : null,
      })
    }

    if (this.isStepFinishPart(part)) {
      return JSON.stringify({
        type: part.type,
        reason: part.reason,
        snapshot: typeof part.snapshot === 'string' ? part.snapshot : null,
        cost: typeof part.cost === 'number' ? part.cost : null,
        tokens: part.tokens ?? null,
      })
    }

    return JSON.stringify(part)
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

    return modelIds.slice(0, MAX_CATALOG_MODEL_IDS)
  }

  private getRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? value as Record<string, unknown> : null
  }
}

export { MockOpenCodeAdapter } from './mockAdapter'
