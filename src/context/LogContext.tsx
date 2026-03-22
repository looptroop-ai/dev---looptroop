import { startTransition, useCallback, useEffect, useState, useRef, type ReactNode } from 'react'
import { LogContext } from './logContextDef'
import {
  type LogEntry,
  type PlainLogOptions,
  LOG_STORAGE_PREFIX,
  LEGACY_LOG_STORAGE_PREFIX,
  serverLogCache,
  normalizeLogRecord,
  normalizeStoredEntry,
  compareTimestamps,
  mergeEntry,
  persistLogs,
  clearPersistedTicketLogs,
} from './logUtils'

export type { LogEntry }

export function LogProvider({ ticketId, currentStatus, children }: { ticketId?: string | null; currentStatus?: string; children: ReactNode }) {
  const [logsByPhase, setLogsByPhase] = useState<Record<string, LogEntry[]>>({})
  const [isLoadingLogs, setIsLoadingLogs] = useState(false)
  const [manualActivePhase, setManualActivePhase] = useState<string | null>(null)
  const activePhase = manualActivePhase ?? currentStatus ?? null
  const currentStatusRef = useRef(currentStatus)

  useEffect(() => {
    currentStatusRef.current = currentStatus
  }, [currentStatus])

  const pendingLogsRef = useRef<Record<string, LogEntry[]>>({})
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current)
        flushTimeoutRef.current = null
      }
      // Flush any pending logs to localStorage before unmounting so they
      // survive navigation away and back (e.g. during SCANNING_RELEVANT_FILES).
      const pending = pendingLogsRef.current
      if (Object.keys(pending).length > 0) {
        pendingLogsRef.current = {}
        // We can't rely on setState after unmount, but we can persist directly
        // to localStorage by reading the latest logsByPhase from a ref-snapshot.
        try {
          const snapshot: Record<string, LogEntry[]> = {}
          for (const [status, entries] of Object.entries(pending)) {
            const storageKey = `${LOG_STORAGE_PREFIX}${ticketId}-${status}`
            let bucket: LogEntry[] = []
            try {
              const stored = localStorage.getItem(storageKey)
              if (stored) bucket = JSON.parse(stored) as LogEntry[]
            } catch { /* use empty */ }
            for (const entry of entries) {
              bucket = mergeEntry(bucket, entry)
            }
            snapshot[status] = bucket
          }
          persistLogs(ticketId, snapshot)
        } catch { /* best-effort */ }
      }
    }
  }, [ticketId])

  const flushPendingLogs = useCallback(() => {
    if (flushTimeoutRef.current) {
      clearTimeout(flushTimeoutRef.current)
      flushTimeoutRef.current = null
    }

    const pending = pendingLogsRef.current
    if (Object.keys(pending).length === 0) return

    pendingLogsRef.current = {}

    startTransition(() => {
      setLogsByPhase(prev => {
        const merged = { ...prev }
        let hasChanges = false
        for (const [status, entries] of Object.entries(pending)) {
          if (entries.length > 0) {
            hasChanges = true
            let bucket = merged[status] ?? []
            for (const entry of entries) {
              bucket = mergeEntry(bucket, entry)
            }
            merged[status] = bucket
          }
        }

        if (hasChanges) {
          persistLogs(ticketId, merged)
          return merged
        }
        return prev
      })
    })
  }, [ticketId])

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

          const status = currentStatusRef.current
          if (status && (merged[status] ?? []).length === 0) {
            const synthetic = normalizeLogRecord({
              type: 'info',
              phase: status,
              status: status,
              source: 'system',
              audience: 'all',
              kind: 'milestone',
              content: `[SYS] Status ${status} is active.`,
              timestamp: new Date().toISOString(),
            }, status)
            merged[status] = [synthetic]
          }

          persistLogs(ticketId, merged)
          return merged
        })
      })
    }

    const cached = serverLogCache.get(ticketId)
    if (cached) {
      applyServerLogs(cached)
    }

    const mergeServerLogs = () => {
      if (!cached) setIsLoadingLogs(true)
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
        .finally(() => {
          setIsLoadingLogs(false)
        })
    }

    mergeServerLogs()
  }, [ticketId])

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

    const bucket = pendingLogsRef.current[entry.status] ?? []
    bucket.push(entry)
    pendingLogsRef.current[entry.status] = bucket

    if (!flushTimeoutRef.current) {
      flushTimeoutRef.current = setTimeout(flushPendingLogs, 200)
    }
  }, [flushPendingLogs])

  const addLogRecord = useCallback((phase: string, data: Record<string, unknown>) => {
    if (!phase) return
    const entry = normalizeLogRecord(data, phase)

    const bucket = pendingLogsRef.current[entry.status] ?? []
    bucket.push(entry)
    pendingLogsRef.current[entry.status] = bucket

    if (!flushTimeoutRef.current) {
      flushTimeoutRef.current = setTimeout(flushPendingLogs, 200)
    }
  }, [flushPendingLogs])

  const getLogsForPhase = useCallback(
    (phase: string) => (logsByPhase[phase] ?? []).slice().sort((a, b) => compareTimestamps(a.timestamp, b.timestamp)),
    [logsByPhase],
  )

  const getAllLogs = useCallback(() => {
    return Object.values(logsByPhase)
      .flatMap(entries => entries)
      .sort((a, b) => compareTimestamps(a.timestamp, b.timestamp))
  }, [logsByPhase])

  const clearLogs = useCallback(() => {
    if (ticketId) clearPersistedTicketLogs(ticketId)
    
    if (flushTimeoutRef.current) {
      clearTimeout(flushTimeoutRef.current)
      flushTimeoutRef.current = null
    }
    pendingLogsRef.current = {}

    startTransition(() => {
      setLogsByPhase({})
      setManualActivePhase(null)
    })
  }, [ticketId])

  return (
    <LogContext.Provider value={{ logsByPhase, activePhase, isLoadingLogs, addLog, addLogRecord, getLogsForPhase, getAllLogs, setActivePhase: setManualActivePhase, clearLogs }}>
      {children}
    </LogContext.Provider>
  )
}
