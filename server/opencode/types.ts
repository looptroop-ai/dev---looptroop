export interface Session {
  id: string
  slug?: string
  projectPath?: string
  directory?: string
  createdAt?: string
  updatedAt?: string
  title?: string
  version?: string
}

export interface PromptPart {
  type: 'text' | 'system'
  content: string
  source?: string
}

export interface ModelSelection {
  providerID: string
  modelID: string
}

export type OpenCodePermissionAction = 'allow' | 'deny' | 'ask'

export interface OpenCodePermissionRule {
  permission: string
  pattern: string
  action: OpenCodePermissionAction
}

export interface OpenCodeSessionCreateOptions {
  permission?: ReadonlyArray<OpenCodePermissionRule>
}

export interface PromptSessionOptions {
  signal?: AbortSignal
  model?: ModelSelection
  modelRef?: string
  agent?: string
  variant?: string
  system?: string
  noReply?: boolean
  tools?: Record<string, boolean>
  onEvent?: (event: StreamEvent) => void
  stepFinishSafetyMs?: number
}

interface MessagePartBase {
  id: string
  sessionID: string
  messageID: string
}

export interface TextMessagePart extends MessagePartBase {
  type: 'text'
  text: string
  synthetic?: boolean
  ignored?: boolean
  time?: {
    start?: number
    end?: number
  }
  metadata?: Record<string, unknown>
}

export interface ReasoningMessagePart extends MessagePartBase {
  type: 'reasoning'
  text: string
  metadata?: Record<string, unknown>
  time?: {
    start?: number
    end?: number
  }
}

export interface ToolMessagePart extends MessagePartBase {
  type: 'tool'
  callID: string
  tool: string
  state: {
    status: 'pending' | 'running' | 'completed' | 'error'
    input?: Record<string, unknown>
    title?: string
    output?: string
    error?: string
    metadata?: Record<string, unknown>
    time?: {
      start?: number
      end?: number
      compacted?: number
    }
    attachments?: Array<Record<string, unknown>>
    raw?: string
  }
  metadata?: Record<string, unknown>
}

export interface StepStartMessagePart extends MessagePartBase {
  type: 'step-start'
  snapshot?: string
}

export interface StepFinishMessagePart extends MessagePartBase {
  type: 'step-finish'
  reason: string
  snapshot?: string
  cost?: number
  tokens?: {
    input?: number
    output?: number
    reasoning?: number
    cache?: {
      read?: number
      write?: number
    }
  }
}

export interface GenericMessagePart extends MessagePartBase {
  type: string
  text?: string
  [key: string]: unknown
}

export type MessagePart =
  | TextMessagePart
  | ReasoningMessagePart
  | ToolMessagePart
  | StepStartMessagePart
  | StepFinishMessagePart
  | GenericMessagePart

export interface MessageInfo {
  id: string
  sessionID: string
  role?: 'user' | 'assistant' | 'system' | string
  sender?: string
  author?: string
  providerID?: string
  modelID?: string
  timestamp?: string
  time?: {
    created?: number
    completed?: number
  }
  error?: unknown
  [key: string]: unknown
}

export interface Message {
  id: string
  role?: 'user' | 'assistant' | 'system' | string
  content?: string
  timestamp?: string
  info?: MessageInfo
  parts?: MessagePart[]
}

export function parseModelRef(modelRef?: string | null): ModelSelection | undefined {
  if (!modelRef) return undefined
  const slashIndex = modelRef.indexOf('/')
  if (slashIndex <= 0 || slashIndex === modelRef.length - 1) return undefined
  return {
    providerID: modelRef.slice(0, slashIndex),
    modelID: modelRef.slice(slashIndex + 1),
  }
}

interface StreamEventBase {
  sessionId: string
  messageId?: string
  partId?: string
}

export interface TextStreamEvent extends StreamEventBase {
  type: 'text'
  text: string
  delta?: string
  streaming: boolean
  complete: boolean
}

export interface ReasoningStreamEvent extends StreamEventBase {
  type: 'reasoning'
  text: string
  delta?: string
  streaming: boolean
  complete: boolean
}

export interface ToolStreamEvent extends StreamEventBase {
  type: 'tool'
  tool: string
  callId: string
  status: 'pending' | 'running' | 'completed' | 'error'
  title?: string
  input?: Record<string, unknown>
  output?: string
  error?: string
  metadata?: Record<string, unknown>
  complete: boolean
}

export interface StepStreamEvent extends StreamEventBase {
  type: 'step'
  step: 'start' | 'finish'
  reason?: string
  snapshot?: string
  cost?: number
  tokens?: StepFinishMessagePart['tokens']
  complete: boolean
}

export interface SessionStatusStreamEvent extends StreamEventBase {
  type: 'session_status'
  status: 'busy' | 'idle' | 'retry'
  attempt?: number
  message?: string
  next?: number
}

export interface SessionErrorStreamEvent extends StreamEventBase {
  type: 'session_error'
  error: string
  details?: unknown
}

export interface PermissionStreamEvent extends StreamEventBase {
  type: 'permission'
  permissionId: string
  permission?: string
  title?: string
  patterns?: string[]
  details?: Record<string, unknown>
}

export interface PartRemovedStreamEvent extends StreamEventBase {
  type: 'part_removed'
}

export interface DoneStreamEvent extends StreamEventBase {
  type: 'done'
}

export type StreamEvent =
  | TextStreamEvent
  | ReasoningStreamEvent
  | ToolStreamEvent
  | StepStreamEvent
  | SessionStatusStreamEvent
  | SessionErrorStreamEvent
  | PermissionStreamEvent
  | PartRemovedStreamEvent
  | DoneStreamEvent

export interface HealthStatus {
  available: boolean
  version?: string
  models?: string[]
  error?: string
}
