import type { SessionStatusStreamEvent } from '../opencode/types'

export interface SessionStatusLogEntry {
  entryId: string
  type: 'info' | 'error'
  kind: 'session' | 'error'
  op: 'append' | 'upsert' | 'finalize'
  content: string
}

function normalizeStatusMessage(message?: string): string | null {
  if (!message) return null
  const normalized = message.replace(/\s+/g, ' ').trim()
  return normalized.length > 0 ? normalized : null
}

export function buildSessionStatusLogEntries(
  sessionId: string,
  event: SessionStatusStreamEvent,
): SessionStatusLogEntry[] {
  const entries: SessionStatusLogEntry[] = []

  if (event.status === 'retry') {
    const retryLabel = typeof event.attempt === 'number'
      ? `Session retry #${event.attempt}`
      : 'Session retry'
    const retryMessage = normalizeStatusMessage(event.message)

    entries.push({
      entryId: `${sessionId}:retry:${event.attempt}`,
      type: 'error',
      kind: 'error',
      op: 'append',
      content: retryMessage ? `${retryLabel}: ${retryMessage}` : `${retryLabel}.`,
    })
  }

  const attemptSuffix = event.status === 'retry' && typeof event.attempt === 'number'
    ? ` (attempt ${event.attempt})`
    : ''

  entries.push({
    entryId: `${sessionId}:status`,
    type: 'info',
    kind: 'session',
    op: event.status === 'idle' ? 'finalize' : 'upsert',
    content: `Session status: ${event.status}${attemptSuffix}.`,
  })

  return entries
}
