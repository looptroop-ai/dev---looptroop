export type LogEventType = 'state_change' | 'model_output' | 'test_result' | 'error' | 'bead_complete' | 'info' | 'debug'

export type LogSource = 'system' | 'opencode' | 'error' | 'debug' | `model:${string}`

export interface LogEvent {
  timestamp: string
  type: LogEventType
  ticketId: string
  phase: string
  message: string
  source?: LogSource
  status?: string
  data?: Record<string, unknown>
}
