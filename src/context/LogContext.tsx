import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'

export interface LogEntry {
  line: string
  source: string   // 'system' | 'opencode' | 'error' | 'model:<id>'
  status: string
}

interface LogContextValue {
  logsByPhase: Record<string, LogEntry[]>
  activePhase: string | null
  addLog: (phase: string, line: string, source?: string, status?: string) => void
  getLogsForPhase: (phase: string) => LogEntry[]
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
}

/** Derive a log source from SSE event data when no explicit source is provided. */
function deriveSource(data: Record<string, unknown>): string {
  if (data.source) return String(data.source)
  const type = String(data.type || 'info')
  if (type === 'error') return 'error'
  if (type === 'model_output') {
    const modelId = data.modelId ?? data.model
    if (modelId) return `model:${String(modelId)}`
    return 'opencode'
  }
  return 'system'
}

export function formatLogLine(data: Record<string, unknown>): { line: string; source: string } {
  const type = String(data.type || 'info')
  const content = String(data.content || data.message || '')
  const tag = LOG_TYPE_TAGS[type] || '[SYS]'
  return { line: `${tag} ${content}`, source: deriveSource(data) }
}

export function LogProvider({ ticketId, currentStatus, children }: { ticketId?: number | null; currentStatus?: string; children: ReactNode }) {
  const [logsByPhase, setLogsByPhase] = useState<Record<string, LogEntry[]>>({})
  const [activePhase, setActivePhase] = useState<string | null>(null)

  // Load logs from localStorage when ticketId changes
  useEffect(() => {
    if (!ticketId) { setLogsByPhase({}); setActivePhase(null); return }
    const loaded: Record<string, LogEntry[]> = {}
    const prefix = `logs-${ticketId}-`
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(prefix)) {
        const status = key.slice(prefix.length)
        try { loaded[status] = JSON.parse(localStorage.getItem(key) || '[]') } catch { loaded[status] = [] }
      }
    }
    setLogsByPhase(loaded)
  }, [ticketId])

  // Sync activePhase with currentStatus
  useEffect(() => {
    if (currentStatus) setActivePhase(currentStatus)
  }, [currentStatus])

  const addLog = useCallback((phase: string, line: string, source?: string, status?: string) => {
    if (!phase) return
    const entry: LogEntry = { line, source: source ?? 'system', status: status ?? phase }
    setLogsByPhase(prev => {
      const updated = [...(prev[phase] ?? []), entry]
      if (ticketId) {
        try { localStorage.setItem(`logs-${ticketId}-${phase}`, JSON.stringify(updated)) } catch { /* quota exceeded */ }
      }
      return { ...prev, [phase]: updated }
    })
  }, [ticketId])

  const getLogsForPhase = useCallback((phase: string) => {
    return logsByPhase[phase] ?? []
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
    <LogContext.Provider value={{ logsByPhase, activePhase, addLog, getLogsForPhase, setActivePhase, clearLogs }}>
      {children}
    </LogContext.Provider>
  )
}

export function useLogs(): LogContextValue | null {
  return useContext(LogContext)
}
