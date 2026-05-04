import { startTransition, useCallback, useEffect, useState, useRef, type ReactNode } from 'react'
import { LogContext } from './logContextDef'
import {
  type LogEntry,
  type LogChannel,
  type PlainLogOptions,
  type ServerLogScope,
  LOG_STORAGE_PREFIX,
  LEGACY_LOG_STORAGE_PREFIX,
  serverLogCache,
  SERVER_LOG_REFRESH_EVENT,
  getServerLogCacheKey,
  getServerLogsUrl,
  clearServerLogCache,
  normalizeLogRecord,
  normalizeStoredEntry,
  isDebugLogEntry,
  isBrowserCacheLogEntry,
  hasBrowserCacheLogEntries,
  compareTimestamps,
  mergeEntry,
  persistLogs,
  clearPersistedTicketLogs,
} from './logUtils'

export type { LogEntry }

interface LogProviderProps {
  ticketId?: string | null
  currentStatus?: string
  visiblePhase?: string | null
  fullLogOpen?: boolean
  children: ReactNode
}

const LOG_FLUSH_DELAY_MS = 500

function mergeLogBuckets(
  current: Record<string, LogEntry[]>,
  entriesByStatus: Record<string, LogEntry[]>,
): { logsByPhase: Record<string, LogEntry[]>; hasChanges: boolean } {
  let merged = current
  let hasChanges = false

  for (const [status, entries] of Object.entries(entriesByStatus)) {
    if (entries.length === 0) continue

    const currentBucket = merged[status] ?? []
    let nextBucket = currentBucket
    for (const entry of entries) {
      nextBucket = mergeEntry(nextBucket, entry)
    }

    if (nextBucket !== currentBucket) {
      if (!hasChanges) {
        merged = { ...current }
      }
      merged[status] = nextBucket
      hasChanges = true
    }
  }

  return { logsByPhase: merged, hasChanges }
}

function normalizeScope(scope: ServerLogScope = {}): ServerLogScope {
  const normalized: ServerLogScope = {
    channel: scope.channel === 'debug' || scope.channel === 'ai' ? scope.channel : 'normal',
  }

  if (scope.status) {
    normalized.status = scope.status
  } else if (scope.phase) {
    normalized.phase = scope.phase
  } else {
    normalized.lifecycle = true
  }

  if (typeof scope.phaseAttempt === 'number' && Number.isFinite(scope.phaseAttempt)) {
    normalized.phaseAttempt = scope.phaseAttempt
  }

  return normalized
}

function getRawPhaseAttempt(rawEntry: Record<string, unknown>): number | null {
  const phaseAttempt = typeof rawEntry.phaseAttempt === 'number' && Number.isFinite(rawEntry.phaseAttempt)
    ? rawEntry.phaseAttempt
    : Number(rawEntry.phaseAttempt)
  return Number.isFinite(phaseAttempt) ? phaseAttempt : null
}

function entryMatchesScope(rawEntry: Record<string, unknown>, entry: LogEntry, scope: ServerLogScope): boolean {
  if (scope.status && entry.status !== scope.status) return false
  if (scope.phase) {
    const entryPhase = typeof rawEntry.phase === 'string' ? rawEntry.phase : entry.status
    if (entryPhase !== scope.phase) return false
  }
  if (typeof scope.phaseAttempt === 'number' && Number.isFinite(scope.phaseAttempt)) {
    if (getRawPhaseAttempt(rawEntry) !== scope.phaseAttempt) return false
  }
  return true
}

function shouldIncludeEntryForScope(entry: LogEntry, scope: ServerLogScope): boolean {
  const isDebug = isDebugLogEntry(entry)
  if (scope.channel === 'debug') return isDebug
  if (scope.channel === 'ai') return !isDebug && entry.audience === 'ai'
  return !isDebug
}

export function LogProvider({
  ticketId,
  currentStatus,
  visiblePhase,
  fullLogOpen = false,
  children,
}: LogProviderProps) {
  const [logsByPhase, setLogsByPhase] = useState<Record<string, LogEntry[]>>({})
  const [loadingScopeKeys, setLoadingScopeKeys] = useState<Set<string>>(() => new Set())
  const [manualActivePhase, setManualActivePhase] = useState<string | null>(null)
  const activePhase = manualActivePhase ?? currentStatus ?? null
  const isLoadingLogs = loadingScopeKeys.size > 0
  const currentStatusRef = useRef(currentStatus)
  const loadedScopeKeysRef = useRef<Set<string>>(new Set())
  const loadingScopeKeysRef = useRef<Set<string>>(new Set())
  const scopeByKeyRef = useRef<Map<string, ServerLogScope>>(new Map())
  const logsByPhaseRef = useRef<Record<string, LogEntry[]>>({})

  useEffect(() => {
    currentStatusRef.current = currentStatus
  }, [currentStatus])

  const pendingLogsRef = useRef<Record<string, LogEntry[]>>({})
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const mergeLiveEntry = useCallback((entry: LogEntry) => {
    const { logsByPhase: merged, hasChanges } = mergeLogBuckets(logsByPhaseRef.current, {
      [entry.status]: [entry],
    })
    if (!hasChanges) return

    logsByPhaseRef.current = merged
    setLogsByPhase(merged)
  }, [])

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
            if (!hasBrowserCacheLogEntries(entries)) continue
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
          if (Object.keys(snapshot).length > 0) {
            persistLogs(ticketId, snapshot)
          }
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
    const shouldCache = Object.values(pending).some(hasBrowserCacheLogEntries)
    if (!shouldCache) return

    const { logsByPhase: merged, hasChanges } = mergeLogBuckets(logsByPhaseRef.current, pending)
    if (hasChanges) {
      logsByPhaseRef.current = merged
      setLogsByPhase(merged)
    }

    persistLogs(ticketId, logsByPhaseRef.current)
  }, [ticketId])

  const queueCacheEntry = useCallback((entry: LogEntry) => {
    if (!isBrowserCacheLogEntry(entry)) return

    const bucket = pendingLogsRef.current[entry.status] ?? []
    bucket.push(entry)
    pendingLogsRef.current[entry.status] = bucket

    if (!flushTimeoutRef.current) {
      flushTimeoutRef.current = setTimeout(flushPendingLogs, LOG_FLUSH_DELAY_MS)
    }
  }, [flushPendingLogs])

  const setScopeLoading = useCallback((scopeKey: string, isLoading: boolean) => {
    const loading = loadingScopeKeysRef.current
    const alreadyLoading = loading.has(scopeKey)
    if (isLoading === alreadyLoading) return

    if (isLoading) {
      loading.add(scopeKey)
    } else {
      loading.delete(scopeKey)
    }
    setLoadingScopeKeys(new Set(loading))
  }, [])

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
        loaded[status] = parsed
          .map(entry => normalizeStoredEntry(entry, status))
          .filter(entry => !isDebugLogEntry(entry))
      } catch {
        loaded[status] = []
      }
    }

    startTransition(() => {
      setLogsByPhase(prev => {
        const { logsByPhase: merged, hasChanges } = mergeLogBuckets(prev, loaded)
        if (!hasChanges) return prev
        logsByPhaseRef.current = merged
        return merged
      })
    })
  }, [ticketId])

  const applyServerLogs = useCallback((serverLogs: Array<Record<string, unknown>>, scope: ServerLogScope) => {
    if (!ticketId) return

    startTransition(() => {
      setLogsByPhase(prev => {
        const merged = { ...prev }
        let hasChanges = false
        for (const rawEntry of serverLogs) {
          const phase = String(rawEntry.phase ?? rawEntry.status ?? 'unknown')
          const entry = normalizeLogRecord(rawEntry, phase)
          if (!entryMatchesScope(rawEntry, entry, scope)) continue
          if (!shouldIncludeEntryForScope(entry, scope)) continue

          const bucket = merged[entry.status] ?? []
          const nextBucket = mergeEntry(bucket, entry)
          if (nextBucket !== bucket) {
            merged[entry.status] = nextBucket
            hasChanges = true
          }
        }

        const syntheticStatus = scope.channel === 'normal'
          && (
            scope.lifecycle
              ? currentStatusRef.current
              : scope.status === currentStatusRef.current
                ? scope.status
                : null
          )
        if (syntheticStatus) {
          const bucket = merged[syntheticStatus] ?? []
          const hasNormalEntry = bucket.some(entry => !isDebugLogEntry(entry))
          if (!hasNormalEntry) {
            const synthetic = normalizeLogRecord({
              type: 'info',
              phase: syntheticStatus,
              status: syntheticStatus,
              source: 'system',
              audience: 'all',
              kind: 'milestone',
              content: `[SYS] Status ${syntheticStatus} is active.`,
              timestamp: new Date().toISOString(),
            }, syntheticStatus)
            const nextBucket = mergeEntry(bucket, synthetic)
            if (nextBucket !== bucket) {
              merged[syntheticStatus] = nextBucket
              hasChanges = true
            }
          }
        }

        if (!hasChanges) return prev
        logsByPhaseRef.current = merged
        persistLogs(ticketId, merged)
        return merged
      })
    })
  }, [ticketId])

  const requestServerLogs = useCallback((
    scope: ServerLogScope,
    options: { showLoading?: boolean; force?: boolean } = {},
  ) => {
    if (!ticketId) return

    const normalizedScope = normalizeScope(scope)
    const scopeKey = getServerLogCacheKey(ticketId, normalizedScope)
    scopeByKeyRef.current.set(scopeKey, normalizedScope)

    if (!options.force && loadedScopeKeysRef.current.has(scopeKey)) {
      const cached = serverLogCache.get(scopeKey)
      if (cached) applyServerLogs(cached, normalizedScope)
      return
    }

    if (!options.force && serverLogCache.has(scopeKey)) {
      const cached = serverLogCache.get(scopeKey) ?? []
      loadedScopeKeysRef.current.add(scopeKey)
      applyServerLogs(cached, normalizedScope)
      return
    }

    if (loadingScopeKeysRef.current.has(scopeKey)) return

    if (options.showLoading !== false) setScopeLoading(scopeKey, true)
    fetch(getServerLogsUrl(ticketId, normalizedScope))
      .then(res => res.ok ? res.json() : [])
      .then((raw: unknown) => {
        const serverLogs = Array.isArray(raw) ? raw as Array<Record<string, unknown>> : []
        serverLogCache.set(scopeKey, serverLogs)
        loadedScopeKeysRef.current.add(scopeKey)
        applyServerLogs(serverLogs, normalizedScope)
      })
      .catch(() => {
        // Ignore network failures; cached logs remain available.
      })
      .finally(() => {
        setScopeLoading(scopeKey, false)
      })
  }, [applyServerLogs, setScopeLoading, ticketId])

  const requestedPhase = fullLogOpen ? null : (visiblePhase ?? currentStatus ?? null)
  useEffect(() => {
    if (!requestedPhase) return
    requestServerLogs({ status: requestedPhase })
  }, [requestServerLogs, requestedPhase])

  useEffect(() => {
    if (!ticketId) return

    const handleServerLogRefresh = (event: Event) => {
      const detail = (event as CustomEvent<{ ticketId?: string | null }>).detail
      if (String(detail?.ticketId ?? '') !== String(ticketId)) return
      const scopes = Array.from(scopeByKeyRef.current.entries())
      clearServerLogCache(ticketId)
      for (const [scopeKey, scope] of scopes) {
        loadedScopeKeysRef.current.delete(scopeKey)
        requestServerLogs(scope, { showLoading: false, force: true })
      }
    }

    window.addEventListener(SERVER_LOG_REFRESH_EVENT, handleServerLogRefresh)
    return () => {
      window.removeEventListener(SERVER_LOG_REFRESH_EVENT, handleServerLogRefresh)
    }
  }, [requestServerLogs, ticketId])

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
      ...(options?.fingerprint ? { fingerprint: options.fingerprint } : {}),
      ...(options?.op ? { op: options.op } : {}),
      ...(options?.modelId ? { modelId: options.modelId } : {}),
      ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
      ...(typeof options?.streaming === 'boolean' ? { streaming: options.streaming } : {}),
    }
    const entry = normalizeLogRecord(raw, phase)

    mergeLiveEntry(entry)
    queueCacheEntry(entry)
  }, [mergeLiveEntry, queueCacheEntry])

  const addLogRecord = useCallback((phase: string, data: Record<string, unknown>) => {
    if (!phase) return
    const entry = normalizeLogRecord(data, phase)

    mergeLiveEntry(entry)
    queueCacheEntry(entry)
  }, [mergeLiveEntry, queueCacheEntry])

  const getLogsForPhase = useCallback(
    (phase: string) => (logsByPhase[phase] ?? []).slice().sort((a, b) => compareTimestamps(a.timestamp, b.timestamp)),
    [logsByPhase],
  )

  const getAllLogs = useCallback(() => {
    return Object.values(logsByPhase)
      .flatMap(entries => entries)
      .sort((a, b) => compareTimestamps(a.timestamp, b.timestamp))
  }, [logsByPhase])

  const loadLogsForPhase = useCallback((phase: string, options?: { channel?: LogChannel }) => {
    if (!phase) return
    requestServerLogs({ status: phase, channel: options?.channel })
  }, [requestServerLogs])

  const loadAllLogs = useCallback((options?: { channel?: LogChannel }) => {
    requestServerLogs({ lifecycle: true, channel: options?.channel })
  }, [requestServerLogs])

  const isLoadingLogScope = useCallback((scope: ServerLogScope) => {
    if (!ticketId) return false
    return loadingScopeKeys.has(getServerLogCacheKey(ticketId, normalizeScope(scope)))
  }, [loadingScopeKeys, ticketId])

  const clearLogs = useCallback(() => {
    if (ticketId) clearPersistedTicketLogs(ticketId)

    if (flushTimeoutRef.current) {
      clearTimeout(flushTimeoutRef.current)
      flushTimeoutRef.current = null
    }
    pendingLogsRef.current = {}
    loadedScopeKeysRef.current.clear()
    loadingScopeKeysRef.current.clear()
    scopeByKeyRef.current.clear()
    logsByPhaseRef.current = {}
    setLoadingScopeKeys(new Set())

    startTransition(() => {
      setLogsByPhase({})
      setManualActivePhase(null)
    })
  }, [ticketId])

  return (
    <LogContext.Provider value={{ logsByPhase, activePhase, isLoadingLogs, addLog, addLogRecord, getLogsForPhase, getAllLogs, setActivePhase: setManualActivePhase, loadLogsForPhase, loadAllLogs, isLoadingLogScope, clearLogs }}>
      {children}
    </LogContext.Provider>
  )
}
