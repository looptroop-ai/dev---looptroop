import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface LogContextValue {
  logs: string[]
  addLog: (line: string) => void
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
  const [logs, setLogs] = useState<string[]>([])

  const addLog = useCallback((line: string) => {
    setLogs(prev => [...prev, line])
  }, [])

  const clearLogs = useCallback(() => {
    setLogs([])
  }, [])

  return (
    <LogContext.Provider value={{ logs, addLog, clearLogs }}>
      {children}
    </LogContext.Provider>
  )
}

export function useLogs(): LogContextValue | null {
  return useContext(LogContext)
}
