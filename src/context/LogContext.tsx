import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'

export interface LogEntry {
  line: string
  source: string   // 'system' | 'opencode' | 'error' | 'debug' | 'model:<id>'
  status: string
  timestamp?: string
}

interface LogContextValue {
  logsByPhase: Record<string, LogEntry[]>
  activePhase: string | null
  addLog: (phase: string, line: string, source?: string, status?: string, timestamp?: string) => void
  getLogsForPhase: (phase: string) => LogEntry[]
  getAllLogs: () => LogEntry[]
  setActivePhase: (phase: string | null) => void
  clearLogs: () => void
}

const LogContext = createContext<LogContextValue | null>(null)

const LOG_TYPE_TAGS: Record<string, string> = {
  state_change: '[SYS]',
  model_output: '[MODEL]',
  test_result: '[TEST]',
  error: '[ERROR]',
  bead_complete: '[BEAD]',
  info: '[SYS]',
  debug: '[DEBUG]',
}

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
  if (nested) {
    const nestedCandidates = [nested.content, nested.message, nested.text]
    for (const candidate of nestedCandidates) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate
    }
  }

  return ''
}

/** Derive a log source from SSE event data when no explicit source is provided. */
function deriveSource(data: Record<string, unknown>): string {
  if (data.source) return String(data.source)
  const nested = data.data && typeof data.data === 'object'
    ? (data.data as Record<string, unknown>)
    : null
  if (nested?.source) return String(nested.source)

  const type = String(data.type || 'info')
  if (type === 'debug') return 'debug'
  if (type === 'error') return 'error'
  if (type === 'model_output') {
    const modelId = data.modelId ?? data.model ?? nested?.modelId ?? nested?.model
    if (modelId) return `model:${String(modelId)}`
    return 'opencode'
  }
  return 'system'
}

export function formatLogLine(data: Record<string, unknown>): { line: string; source: string } {
  const type = String(data.type || 'info')
  const content = extractContent(data)
  const tag = LOG_TYPE_TAGS[type] || '[SYS]'
  const line = content
    ? (/^\[[A-Z_]+\]/.test(content.trim()) ? content : `${tag} ${content}`)
    : `${tag} ${stringifyForLine(data)}`
  return { line, source: deriveSource(data) }
}

function normalizeEntry(entry: Partial<LogEntry>, fallbackStatus: string): LogEntry {
  return {
    line: String(entry.line ?? ''),
    source: String(entry.source ?? 'system'),
    status: String(entry.status ?? fallbackStatus),
    ...(entry.timestamp ? { timestamp: String(entry.timestamp) } : {}),
  }
}

function dedupeEntries(entries: LogEntry[]): LogEntry[] {
  const seen = new Set<string>()
  const deduped: LogEntry[] = []
  for (const [index, entry] of entries.entries()) {
    const key = entry.timestamp
      ? `${entry.timestamp}|${entry.status}|${entry.source}|${entry.line}`
      : `no-ts:${index}|${entry.status}|${entry.source}|${entry.line}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(entry)
  }
  return deduped
}

function sortByTimestamp(entries: LogEntry[]): LogEntry[] {
  return [...entries].sort((a, b) => {
    const at = a.timestamp ? Date.parse(a.timestamp) : Number.NaN
    const bt = b.timestamp ? Date.parse(b.timestamp) : Number.NaN
    if (Number.isNaN(at) && Number.isNaN(bt)) return 0
    if (Number.isNaN(at)) return 1
    if (Number.isNaN(bt)) return -1
    return at - bt
  })
}

function isLikelyDuplicate(a: LogEntry, b: LogEntry): boolean {
  if (a.status !== b.status) return false
  if (a.source !== b.source) return false
  if (a.line !== b.line) return false

  const at = a.timestamp ? Date.parse(a.timestamp) : Number.NaN
  const bt = b.timestamp ? Date.parse(b.timestamp) : Number.NaN

  if (Number.isNaN(at) || Number.isNaN(bt)) return true
  return Math.abs(at - bt) <= 2000
}

export function LogProvider({ ticketId, currentStatus, children }: { ticketId?: number | null; currentStatus?: string; children: ReactNode }) {
  const [logsByPhase, setLogsByPhase] = useState<Record<string, LogEntry[]>>({})
  const [activePhase, setActivePhase] = useState<string | null>(null)

  // Load logs from server (historical) + localStorage when ticketId changes
  useEffect(() => {
    if (!ticketId) { setLogsByPhase({}); setActivePhase(null); return }

    // Start with localStorage entries
    const loaded: Record<string, LogEntry[]> = {}
    const prefix = `logs-${ticketId}-`
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(prefix)) {
        const status = key.slice(prefix.length)
        try {
          const parsed = JSON.parse(localStorage.getItem(key) || '[]') as Array<Partial<LogEntry>>
          loaded[status] = dedupeEntries(parsed.map(entry => normalizeEntry(entry, status)))
        } catch {
          loaded[status] = []
        }
      }
    }
    setLogsByPhase(loaded)

    const mergeServerLogs = () => {
      fetch(`/api/files/${ticketId}/logs`)
        .then(res => res.ok ? res.json() : [])
        .then((raw: unknown) => {
          const serverLogs = Array.isArray(raw) ? raw as Array<Record<string, unknown>> : []
          if (!serverLogs.length) return
          setLogsByPhase(prev => {
            const merged = { ...prev }
            for (const entry of serverLogs) {
              const { line, source } = formatLogLine(entry)
              const phase = String(entry.phase || entry.status || 'unknown')
              const status = String(entry.status || phase)
              const bucketKey = status
              const logEntry: LogEntry = normalizeEntry({
                line,
                source,
                status,
                timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : undefined,
              }, status)
              const bucket = merged[bucketKey] ?? []
              if (!bucket.some(existing => isLikelyDuplicate(existing, logEntry))) {
                merged[bucketKey] = sortByTimestamp([...bucket, logEntry])
              }
            }

            if (currentStatus) {
              const statusBucket = merged[currentStatus] ?? []
              if (statusBucket.length === 0) {
                const synthetic: LogEntry = normalizeEntry({
                  line: `[SYS] [APP] Status ${currentStatus} is active.`,
                  source: 'system',
                  status: currentStatus,
                  timestamp: new Date().toISOString(),
                }, currentStatus)
                merged[currentStatus] = [synthetic]
              }
            }

            // Persist merged logs to localStorage
            for (const [status, entries] of Object.entries(merged)) {
              try { localStorage.setItem(`logs-${ticketId}-${status}`, JSON.stringify(entries)) } catch { /* quota */ }
            }
            return merged
          })
        })
        .catch(() => { /* network error – localStorage entries still available */ })
    }

    // Initial pull + periodic fallback sync (covers SSE disconnects)
    mergeServerLogs()
    const pollId = window.setInterval(mergeServerLogs, 3000)

    return () => window.clearInterval(pollId)
  }, [ticketId, currentStatus])

  // Sync activePhase with currentStatus
  useEffect(() => {
    if (currentStatus) setActivePhase(currentStatus)
  }, [currentStatus])

  const addLog = useCallback((phase: string, line: string, source?: string, status?: string, timestamp?: string) => {
    if (!phase) return
    const entry: LogEntry = normalizeEntry({
      line,
      source: source ?? 'system',
      status: status ?? phase,
      timestamp,
    }, status ?? phase)
    const bucketKey = entry.status || phase
    setLogsByPhase(prev => {
      const updated = dedupeEntries([...(prev[bucketKey] ?? []), entry])
      if (ticketId) {
        try { localStorage.setItem(`logs-${ticketId}-${bucketKey}`, JSON.stringify(updated)) } catch { /* quota exceeded */ }
      }
      return { ...prev, [bucketKey]: updated }
    })
  }, [ticketId])

  const getLogsForPhase = useCallback((phase: string) => {
    return logsByPhase[phase] ?? []
  }, [logsByPhase])

  const getAllLogs = useCallback(() => {
    return sortByTimestamp(
      dedupeEntries(
        Object.values(logsByPhase).flatMap(entries => entries),
      ),
    )
  }, [logsByPhase])

  const clearLogs = useCallback(() => {
    if (ticketId) {
      const prefix = `logs-${ticketId}-`
      const keysToRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key?.startsWith(prefix)) keysToRemove.push(key)
      }
      keysToRemove.forEach(k => localStorage.removeItem(k))
    }
    setLogsByPhase({})
    setActivePhase(null)
  }, [ticketId])

  return (
    <LogContext.Provider value={{ logsByPhase, activePhase, addLog, getLogsForPhase, getAllLogs, setActivePhase, clearLogs }}>
      {children}
    </LogContext.Provider>
  )
}

export function useLogs(): LogContextValue | null {
  return useContext(LogContext)
}
