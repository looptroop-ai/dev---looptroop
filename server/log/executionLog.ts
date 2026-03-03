import type { LogEvent, LogEventType } from './types'
import { safeAtomicAppend } from '../io/atomicAppend'
import { resolve } from 'path'

export function appendLogEvent(
  ticketExternalId: string,
  type: LogEventType,
  phase: string,
  message: string,
  data?: Record<string, unknown>,
) {
  const event: LogEvent = {
    timestamp: new Date().toISOString(),
    type,
    ticketId: ticketExternalId,
    phase,
    message,
    data,
  }

  const logPath = resolve(process.cwd(), '.looptroop/worktrees', ticketExternalId, '.ticket', 'execution-log.jsonl')
  safeAtomicAppend(logPath, JSON.stringify(event))
}

export function createLogEvent(
  ticketId: string,
  type: LogEventType,
  phase: string,
  message: string,
  data?: Record<string, unknown>,
): LogEvent {
  return { timestamp: new Date().toISOString(), type, ticketId, phase, message, data }
}
