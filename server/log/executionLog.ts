import type { LogEvent, LogEventType, LogSource } from './types'
import { safeAtomicAppend } from '../io/atomicAppend'
import { getTicketPaths } from '../storage/tickets'
import { bufferUpsert, removeBuffered } from './upsertBuffer'

type StructuredLogFields = Omit<LogEvent, 'timestamp' | 'type' | 'ticketId' | 'phase' | 'message' | 'source' | 'status' | 'data'>

function pickStructuredFields(data?: Record<string, unknown>): Partial<LogEvent> {
  if (!data) return {}
  return {
    ...(typeof data.content === 'string' ? { content: data.content } : {}),
    ...(typeof data.source === 'string' ? { source: data.source as LogSource } : {}),
    ...(typeof data.status === 'string' ? { status: data.status } : {}),
    ...(typeof data.entryId === 'string' ? { entryId: data.entryId } : {}),
    ...(typeof data.op === 'string' ? { op: data.op as LogEvent['op'] } : {}),
    ...(typeof data.audience === 'string' ? { audience: data.audience as LogEvent['audience'] } : {}),
    ...(typeof data.kind === 'string' ? { kind: data.kind as LogEvent['kind'] } : {}),
    ...(typeof data.modelId === 'string' ? { modelId: data.modelId } : {}),
    ...(typeof data.sessionId === 'string' ? { sessionId: data.sessionId } : {}),
    ...(typeof data.streaming === 'boolean' ? { streaming: data.streaming } : {}),
  }
}

export function appendLogEvent(
  ticketId: string,
  type: LogEventType,
  phase: string,
  message: string,
  data?: Record<string, unknown>,
  source?: LogSource,
  status?: string,
  extra?: Partial<StructuredLogFields>,
) {
  const structured = pickStructuredFields(data)
  const timestamp = typeof data?.timestamp === 'string' ? data.timestamp : new Date().toISOString()
  const event: LogEvent = {
    timestamp,
    type,
    ticketId,
    phase,
    message,
    content: typeof data?.content === 'string' ? data.content : message,
    ...(source != null ? { source } : structured.source ? { source: structured.source } : {}),
    ...(status != null ? { status } : structured.status ? { status: structured.status } : {}),
    data,
    ...structured,
    ...extra,
  }

  const paths = getTicketPaths(ticketId)
  if (!paths) {
    throw new Error(`Ticket not found for execution log append: ${ticketId}`)
  }
  const logPath = paths.executionLogPath

  // Buffer streaming upserts instead of writing every token
  if (event.op === 'upsert' && event.streaming && event.entryId) {
    bufferUpsert(event.entryId, event, logPath)
    return
  }

  // Finalize supersedes any buffered upsert for this entryId
  if (event.op === 'finalize' && event.entryId) {
    removeBuffered(event.entryId)
  }

  safeAtomicAppend(logPath, JSON.stringify(event))
}

export function createLogEvent(
  ticketId: string,
  type: LogEventType,
  phase: string,
  message: string,
  data?: Record<string, unknown>,
  source?: LogSource,
  status?: string,
  extra?: Partial<StructuredLogFields>,
): LogEvent {
  const structured = pickStructuredFields(data)
  const timestamp = typeof data?.timestamp === 'string' ? data.timestamp : new Date().toISOString()
  return {
    timestamp,
    type,
    ticketId,
    phase,
    message,
    content: typeof data?.content === 'string' ? data.content : message,
    ...(source != null ? { source } : structured.source ? { source: structured.source } : {}),
    ...(status != null ? { status } : structured.status ? { status: structured.status } : {}),
    data,
    ...structured,
    ...extra,
  }
}
