import type { LogEvent } from './types'
import { safeAtomicAppend } from '../io/atomicAppend'

interface BufferedEntry {
  event: LogEvent
  logPath: string
}

const buffer = new Map<string, BufferedEntry>()
let intervalHandle: ReturnType<typeof setInterval> | null = null
const FLUSH_INTERVAL_MS = 3000

function flushAll(): void {
  for (const [, { event, logPath }] of buffer) {
    safeAtomicAppend(logPath, JSON.stringify(event))
  }
  buffer.clear()
}

export function bufferUpsert(entryId: string, event: LogEvent, logPath: string): void {
  buffer.set(entryId, { event, logPath })
}

export function removeBuffered(entryId: string): void {
  buffer.delete(entryId)
}

export function startUpsertBuffer(): void {
  if (intervalHandle) return
  intervalHandle = setInterval(flushAll, FLUSH_INTERVAL_MS)
  intervalHandle.unref()
}

export function stopUpsertBuffer(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
  flushAll()
}
