import { useContext } from 'react'
import { LogContext } from './logContextDef'
import type { LogContextValue } from './logUtils'

export function useLogs(): LogContextValue | null {
  return useContext(LogContext)
}
