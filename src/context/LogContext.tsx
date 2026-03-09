import { createContext, startTransition, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

export interface LogEntry {
  id: string
  entryId: string
  line: string
  source: string
  status: string
  timestamp?: string
  audience: 'all' | 'ai' | 'debug'
  kind: string
  modelId?: string
  sessionId?: string
  streaming: boolean
  op: 'append' | 'upsert' | 'finalize'
}

interface PlainLogOptions {
  source?: string
  status?: string
  timestamp?: string
  audience?: LogEntry['audience']
  kind?: string
  modelId?: string
  sessionId?: string
  entryId?: string
  op?: LogEntry['op']
  streaming?: boolean
}

interface LogContextValue {
  logsByPhase: Record<string, LogEntry[]>
  activePhase: string | null
  addLog: (phase: string, line: string, options?: PlainLogOptions) => void
  addLogRecord: (phase: string, data: Record<string, unknown>) => void
  getLogsForPhase: (phase: string) => LogEntry[]
  getAllLogs: () => LogEntry[]
  setActivePhase: (phase: string | null) => void
  clearLogs: () => void
}

const LogContext = createContext<LogContextValue | null>(null)

const LOG_STORAGE_PREFIX = 'logs-v2-'
const LEGACY_LOG_STORAGE_PREFIX = 'logs-'

const LOG_TYPE_TAGS: Record<string, string> = {
  state_change: '[SYS]',
  model_output: '[MODEL]',
  test_result: '[TEST]',
  error: '[ERROR]',
  bead_complete: '[BEAD]',
  info: '[SYS]',
  debug: '[DEBUG]',
}

const serverLogCache = new Map<string, Array<Record<string, unknown>>>()

function stringifyForLine(value: unknown, maxLen = 2000): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    const raw = JSON.stringify(value)
    return raw.length > maxLen ? `${raw.slice(0, maxLen)}…[truncated]` : raw
  } catch {
    return String(value)
  }
}

function extractContent(data: Record<string, unknown>): string {
  const directCandidates = [data.content, data.message, data.text]
  for (const candidate of directCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate
  }

  const nested = data.data && typeof data.data === 'object'
    ? (data.data as Record<string, unknown>)
    : null
  if (!nested) return ''

  const nestedCandidates = [nested.content, nested.message, nested.text]
  for (const candidate of nestedCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate
  }

  return ''
}

function deriveSource(data: Record<string, unknown>): string {
  if (typeof data.source === 'string' && data.source) return data.source
  if (typeof data.modelId === 'string' && data.modelId) return `model:${data.modelId}`

  const nested = data.data && typeof data.data === 'object'
    ? (data.data as Record<string, unknown>)
    : null
  if (nested) {
    if (typeof nested.source === 'string' && nested.source) return nested.source
    if (typeof nested.modelId === 'string' && nested.modelId) return `model:${nested.modelId}`
  }

  const type = String(data.type ?? 'info')
  if (type === 'debug') return 'debug'
  if (type === 'error') return 'error'
  if (type === 'model_output') return 'opencode'
  return 'system'
}

function deriveAudience(data: Record<string, unknown>, source: string): LogEntry['audience'] {
  if (data.audience === 'all' || data.audience === 'ai' || data.audience === 'debug') return data.audience
  if (source === 'debug') return 'debug'
  if (source === 'opencode' || source.startsWith('model:')) return 'ai'
  return 'all'
}

function deriveKind(data: Record<string, unknown>, type: string, audience: LogEntry['audience']): string {
  if (typeof data.kind === 'string' && data.kind) return data.kind
  if (type === 'error') return 'error'
  if (type === 'test_result') return 'test'
  if (audience === 'ai') return type === 'model_output' ? 'text' : 'session'
  return 'milestone'
}

function deriveModelId(data: Record<string, unknown>, source: string): string | undefined {
  if (typeof data.modelId === 'string' && data.modelId) return data.modelId
  if (source.startsWith('model:')) return source.slice('model:'.length)

  const nested = data.data && typeof data.data === 'object'
    ? (data.data as Record<string, unknown>)
    : null
  if (typeof nested?.modelId === 'string' && nested.modelId) return nested.modelId
  return undefined
}

function deriveOperation(data: Record<string, unknown>): LogEntry['op'] {
  if (data.op === 'append' || data.op === 'upsert' || data.op === 'finalize') return data.op
  return 'append'
}

function formatLine(type: string, content: string, fallback: unknown): string {
  const tag = LOG_TYPE_TAGS[type] || '[SYS]'
  if (content) {
    return /^\[[A-Z_]+\]/.test(content.trim()) ? content : `${tag} ${content}`
  }
  return `${tag} ${stringifyForLine(fallback)}`
}

function fallbackEntryId(status: string, source: string, timestamp: string | undefined, line: string): string {
  return `${status}:${source}:${timestamp ?? 'no-ts'}:${line}`
}

function normalizeLogRecord(data: Record<string, unknown>, fallbackPhase: string): LogEntry {
  const type = String(data.type ?? 'info')
  const source = deriveSource(data)
  const audience = deriveAudience(data, source)
  const kind = deriveKind(data, type, audience)
  const status = String(data.status ?? data.phase ?? fallbackPhase)
  const timestamp = typeof data.timestamp === 'string' ? data.timestamp : undefined
  const line = formatLine(type, extractContent(data), data)
  const entryId = typeof data.entryId === 'string' && data.entryId
    ? data.entryId
    : fallbackEntryId(status, source, timestamp, line)
  const modelId = deriveModelId(data, source)
  const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
  const op = deriveOperation(data)
  const streaming = typeof data.streaming === 'boolean' ? data.streaming : op !== 'append'

  return {
    id: entryId,
    entryId,
    line,
    source,
    status,
    ...(timestamp ? { timestamp } : {}),
    audience,
    kind,
    ...(modelId ? { modelId } : {}),
    ...(sessionId ? { sessionId } : {}),
    streaming,
    op,
  }
}

function normalizeStoredEntry(entry: Partial<LogEntry>, fallbackStatus: string): LogEntry {
  const source = String(entry.source ?? 'system')
  const status = String(entry.status ?? fallbackStatus)
  const line = String(entry.line ?? '')
  const timestamp = entry.timestamp ? String(entry.timestamp) : undefined
  const audience = entry.audience === 'all' || entry.audience === 'ai' || entry.audience === 'debug'
    ? entry.audience
    : source === 'debug'
      ? 'debug'
      : source === 'opencode' || source.startsWith('model:')
        ? 'ai'
        : 'all'
  const entryId = String(entry.entryId ?? entry.id ?? fallbackEntryId(status, source, timestamp, line))

  return {
    id: entryId,
    entryId,
    line,
    source,
    status,
    ...(timestamp ? { timestamp } : {}),
    audience,
    kind: String(entry.kind ?? (audience === 'ai' ? 'text' : 'milestone')),
    ...(entry.modelId ? { modelId: String(entry.modelId) } : {}),
    ...(entry.sessionId ? { sessionId: String(entry.sessionId) } : {}),
    streaming: Boolean(entry.streaming),
    op: entry.op === 'upsert' || entry.op === 'finalize' ? entry.op : 'append',
  }
}

function compareTimestamps(a?: string, b?: string): number {
  const at = a ? Date.parse(a) : Number.NaN
  const bt = b ? Date.parse(b) : Number.NaN
  if (Number.isNaN(at) && Number.isNaN(bt)) return 0
  if (Number.isNaN(at)) return 1
  if (Number.isNaN(bt)) return -1
  return at - bt
}

function mergeEntry(bucket: LogEntry[], entry: LogEntry): LogEntry[] {
  if (entry.op === 'append') {
    const duplicate = bucket.some(existing =>
      existing.entryId === entry.entryId
      && existing.line === entry.line
      && existing.source === entry.source
      && existing.status === entry.status
      && compareTimestamps(existing.timestamp, entry.timestamp) === 0)
    if (duplicate) return bucket
    return [...bucket, entry]
  }

  const index = bucket.findIndex(existing => existing.entryId === entry.entryId)
  if (index === -1) return [...bucket, entry]

  const next = [...bucket]
  next[index] = {
    ...next[index],
    ...entry,
    streaming: entry.op === 'finalize' ? false : entry.streaming,
  }
  return next
}

function persistLogs(ticketId: string | null | undefined, logsByPhase: Record<string, LogEntry[]>) {
  if (!ticketId || typeof window === 'undefined') return
  for (const [status, entries] of Object.entries(logsByPhase)) {
    try {
      localStorage.setItem(`${LOG_STORAGE_PREFIX}${ticketId}-${status}`, JSON.stringify(entries))
    } catch {
      // Ignore quota failures; in-memory state is still usable.
    }
  }
}

export function formatLogLine(data: Record<string, unknown>): { line: string; source: string } {
  const normalized = normalizeLogRecord(data, String(data.status ?? data.phase ?? 'unknown'))
  return { line: normalized.line, source: normalized.source }
}

export function clearPersistedTicketLogs(ticketId: string) {
  serverLogCache.delete(ticketId)

  if (typeof window === 'undefined') return

  const prefixes = [`${LOG_STORAGE_PREFIX}${ticketId}-`, `${LEGACY_LOG_STORAGE_PREFIX}${ticketId}-`]
  const keysToRemove: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && prefixes.some(prefix => key.startsWith(prefix))) {
      keysToRemove.push(key)
    }
  }
  keysToRemove.forEach(key => localStorage.removeItem(key))
}

export function LogProvider({ ticketId, currentStatus, children }: { ticketId?: string | null; currentStatus?: string; children: ReactNode }) {
  const [logsByPhase, setLogsByPhase] = useState<Record<string, LogEntry[]>>({})
  const [manualActivePhase, setManualActivePhase] = useState<string | null>(null)
  const activePhase = manualActivePhase ?? currentStatus ?? null

  useEffect(() => {
    if (!ticketId) return

    const loaded: Record<string, LogEntry[]> = {}
    const prefixes = [`${LOG_STORAGE_PREFIX}${ticketId}-`, `${LEGACY_LOG_STORAGE_PREFIX}${ticketId}-`]
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue
      const prefix = prefixes.find(candidate => key.startsWith(candidate))
      if (!prefix) continue
      const status = key.slice(prefix.length)
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || '[]') as Array<Partial<LogEntry>>
        loaded[status] = parsed.map(entry => normalizeStoredEntry(entry, status))
      } catch {
        loaded[status] = []
      }
    }

    startTransition(() => {
      setLogsByPhase(loaded)
    })

    const applyServerLogs = (serverLogs: Array<Record<string, unknown>>) => {
      if (!serverLogs.length) return
      startTransition(() => {
        setLogsByPhase(prev => {
          const merged = { ...prev }
          for (const rawEntry of serverLogs) {
            const phase = String(rawEntry.phase ?? rawEntry.status ?? 'unknown')
            const entry = normalizeLogRecord(rawEntry, phase)
            merged[entry.status] = mergeEntry(merged[entry.status] ?? [], entry)
          }

          if (currentStatus && (merged[currentStatus] ?? []).length === 0) {
            const synthetic = normalizeLogRecord({
              type: 'info',
              phase: currentStatus,
              status: currentStatus,
              source: 'system',
              audience: 'all',
              kind: 'milestone',
              content: `[APP] Status ${currentStatus} is active.`,
              timestamp: new Date().toISOString(),
            }, currentStatus)
            merged[currentStatus] = [synthetic]
          }

          persistLogs(ticketId, merged)
          return merged
        })
      })
    }

    const cached = serverLogCache.get(ticketId)
    if (cached) applyServerLogs(cached)

    const mergeServerLogs = () => {
      fetch(`/api/files/${ticketId}/logs`)
        .then(res => res.ok ? res.json() : [])
        .then((raw: unknown) => {
          const serverLogs = Array.isArray(raw) ? raw as Array<Record<string, unknown>> : []
          serverLogCache.set(ticketId, serverLogs)
          applyServerLogs(serverLogs)
        })
        .catch(() => {
          // Ignore network failures; cached logs remain available.
        })
    }

    mergeServerLogs()
    const pollId = window.setInterval(mergeServerLogs, 3000)
    return () => window.clearInterval(pollId)
  }, [ticketId, currentStatus])

  const addLog = useCallback((phase: string, line: string, options?: PlainLogOptions) => {
    if (!phase) return

    const raw: Record<string, unknown> = {
      type: options?.kind === 'error' ? 'error' : options?.audience === 'debug' ? 'debug' : 'info',
      phase,
      status: options?.status ?? phase,
      source: options?.source ?? 'system',
      audience: options?.audience ?? ((options?.source ?? 'system') === 'debug' ? 'debug' : 'all'),
      kind: options?.kind ?? 'milestone',
      content: line,
      ...(options?.timestamp ? { timestamp: options.timestamp } : {}),
      ...(options?.entryId ? { entryId: options.entryId } : {}),
      ...(options?.op ? { op: options.op } : {}),
      ...(options?.modelId ? { modelId: options.modelId } : {}),
      ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
      ...(typeof options?.streaming === 'boolean' ? { streaming: options.streaming } : {}),
    }
    const entry = normalizeLogRecord(raw, phase)

    startTransition(() => {
      setLogsByPhase(prev => {
        const merged = {
          ...prev,
          [entry.status]: mergeEntry(prev[entry.status] ?? [], entry),
        }
        persistLogs(ticketId, merged)
        return merged
      })
    })
  }, [ticketId])

  const addLogRecord = useCallback((phase: string, data: Record<string, unknown>) => {
    if (!phase) return
    const entry = normalizeLogRecord(data, phase)

    startTransition(() => {
      setLogsByPhase(prev => {
        const merged = {
          ...prev,
          [entry.status]: mergeEntry(prev[entry.status] ?? [], entry),
        }
        persistLogs(ticketId, merged)
        return merged
      })
    })
  }, [ticketId])

  const getLogsForPhase = useCallback((phase: string) => logsByPhase[phase] ?? [], [logsByPhase])

  const getAllLogs = useCallback(() => {
    return Object.values(logsByPhase)
      .flatMap(entries => entries)
      .sort((a, b) => compareTimestamps(a.timestamp, b.timestamp))
  }, [logsByPhase])

  const clearLogs = useCallback(() => {
    if (ticketId) clearPersistedTicketLogs(ticketId)
    startTransition(() => {
      setLogsByPhase({})
      setManualActivePhase(null)
    })
  }, [ticketId])

  return (
    <LogContext.Provider value={{ logsByPhase, activePhase, addLog, addLogRecord, getLogsForPhase, getAllLogs, setActivePhase: setManualActivePhase, clearLogs }}>
      {children}
    </LogContext.Provider>
  )
}

export function useLogs(): LogContextValue | null {
  return useContext(LogContext)
}
