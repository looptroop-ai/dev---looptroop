export type SSEEventType = 'state_change' | 'log' | 'progress' | 'error' | 'bead_complete' | 'needs_input' | 'artifact_change'

export interface SSEEvent {
  id: string
  event: SSEEventType
  data: Record<string, unknown>
  ticketId: string
  timestamp: string
}

export interface StateChangeEvent {
  ticketId: string
  from: string
  to: string
}

export interface LogEvent {
  ticketId: string
  type: string
  content: string
  phase?: string
  status?: string
  source?: string
  entryId?: string
  op?: 'append' | 'upsert' | 'finalize'
  audience?: 'all' | 'ai' | 'debug'
  kind?: 'milestone' | 'reasoning' | 'text' | 'tool' | 'step' | 'session' | 'prompt' | 'error' | 'test'
  modelId?: string
  sessionId?: string
  streaming?: boolean
  message?: string
  data?: Record<string, unknown>
}

export interface ProgressEvent {
  ticketId: string
  bead: number
  total: number
  percent: number
}

export interface ErrorEvent {
  ticketId: string
  message: string
  recoverable: boolean
}

export interface BeadCompleteEvent {
  ticketId: string
  beadId: string
  attempts: number
}

export interface NeedsInputEvent {
  ticketId: string
  type: string
  questionIndex?: number
  context?: Record<string, unknown>
}

export interface ArtifactSnapshot {
  id: number
  ticketId: string
  phase: string
  artifactType: string
  filePath: string | null
  content: string | null
  createdAt: string
}

export interface ArtifactChangeEvent {
  ticketId: string
  phase: string
  artifactType: string
  artifact?: ArtifactSnapshot
}
