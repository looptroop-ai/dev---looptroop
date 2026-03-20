import { createContext } from 'react'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastContextValue {
  addToast: (type: ToastType, message: string, duration?: number) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)
