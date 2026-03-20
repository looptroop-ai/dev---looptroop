import { useContext } from 'react'
import { UIContext } from './uiContextDef'

export function useUI() {
  const context = useContext(UIContext)
  if (!context) throw new Error('useUI must be used within UIProvider')
  return context
}
