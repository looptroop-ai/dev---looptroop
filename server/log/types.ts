export type LogEventType = 'state_change' | 'model_output' | 'test_result' | 'error' | 'bead_complete' | 'info'

export interface LogEvent {
  timestamp: string
  type: LogEventType
  ticketId: string
  phase: string
  message: string
  data?: Record<string, unknown>
}
