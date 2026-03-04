export type SSEEventType = 'state_change' | 'log' | 'progress' | 'error' | 'bead_complete' | 'needs_input'

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
