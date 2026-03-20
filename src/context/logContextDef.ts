import { createContext } from 'react'
import type { LogContextValue } from './logUtils'

export const LogContext = createContext<LogContextValue | null>(null)
