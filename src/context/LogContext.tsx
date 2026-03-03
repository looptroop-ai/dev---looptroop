import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface LogContextValue {
  logsByPhase: Record<string, string[]>
  activePhase: string | null
  addLog: (phase: string, line: string) => void
  getLogsForPhase: (phase: string) => string[]
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

export function formatLogLine(data: Record<string, unknown>): string {
  const type = String(data.type || 'info')
  const content = String(data.content || data.message || '')
  const tag = LOG_TYPE_TAGS[type] || '[SYS]'
  return `${tag} ${content}`
}

export function LogProvider({ children }: { children: ReactNode }) {
  const [logsByPhase, setLogsByPhase] = useState<Record<string, string[]>>({})
  const [activePhase, setActivePhase] = useState<string | null>(null)

  const addLog = useCallback((phase: string, line: string) => {
    if (!phase) return
    setLogsByPhase(prev => ({
      ...prev,
      [phase]: [...(prev[phase] ?? []), line],
    }))
  }, [])

  const getLogsForPhase = useCallback((phase: string) => {
    return logsByPhase[phase] ?? []
  }, [logsByPhase])

  const clearLogs = useCallback(() => {
    setLogsByPhase({})
    setActivePhase(null)
  }, [])

  return (
    <LogContext.Provider value={{ logsByPhase, activePhase, addLog, getLogsForPhase, setActivePhase, clearLogs }}>
      {children}
    </LogContext.Provider>
  )
}

export function useLogs(): LogContextValue | null {
  return useContext(LogContext)
}
