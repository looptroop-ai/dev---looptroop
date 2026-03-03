import { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react'

interface UIState {
  selectedTicketId: number | null
  selectedTicketExternalId: string | null
  sidebarOpen: boolean
  activeView: 'kanban' | 'ticket' | 'project' | 'config'
  logPanelHeight: number
  filters: {
    projectId: number | null
    status: string | null
    search: string
  }
  theme: 'light' | 'dark' | 'system'
}

type UIAction =
  | { type: 'SELECT_TICKET'; ticketId: number | null; externalId?: string | null }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_VIEW'; view: UIState['activeView'] }
  | { type: 'SET_LOG_PANEL_HEIGHT'; height: number }
  | { type: 'SET_FILTER'; filter: Partial<UIState['filters']> }
  | { type: 'SET_THEME'; theme: UIState['theme'] }
  | { type: 'CLOSE_TICKET' }

const STORAGE_KEY = 'looptroop-ui-state'

const defaultState: UIState = {
  selectedTicketId: null,
  selectedTicketExternalId: null,
  sidebarOpen: true,
  activeView: 'kanban',
  logPanelHeight: 300,
  filters: {
    projectId: null,
    status: null,
    search: '',
  },
  theme: 'system',
}

const VALID_VIEWS: UIState['activeView'][] = ['kanban', 'ticket', 'project', 'config']

function getInitialState(): UIState {
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<UIState>
        // Validate activeView — fall back to kanban if stale/invalid
        const activeView = VALID_VIEWS.includes(parsed.activeView as UIState['activeView'])
          ? parsed.activeView
          : 'kanban'
        return { ...defaultState, ...parsed, activeView: activeView ?? 'kanban' }
      }
    } catch {
      // ignore parse errors
    }
  }
  return defaultState
}

function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case 'SELECT_TICKET':
      return { ...state, selectedTicketId: action.ticketId, selectedTicketExternalId: action.externalId ?? null, activeView: action.ticketId ? 'ticket' : 'kanban' }
    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarOpen: !state.sidebarOpen }
    case 'SET_VIEW':
      return { ...state, activeView: action.view }
    case 'SET_LOG_PANEL_HEIGHT':
      return { ...state, logPanelHeight: action.height }
    case 'SET_FILTER':
      return { ...state, filters: { ...state.filters, ...action.filter } }
    case 'SET_THEME':
      return { ...state, theme: action.theme }
    case 'CLOSE_TICKET':
      return { ...state, selectedTicketId: null, selectedTicketExternalId: null, activeView: 'kanban' }
    default:
      return state
  }
}

interface UIContextValue {
  state: UIState
  dispatch: React.Dispatch<UIAction>
}

const UIContext = createContext<UIContextValue | null>(null)

export function UIProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(uiReducer, undefined, getInitialState)

  // Persist to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // ignore storage errors
    }
  }, [state])

  // Sync URL with state
  useEffect(() => {
    const currentPath = window.location.pathname
    let targetPath = '/'

    if (state.activeView === 'ticket' && state.selectedTicketId) {
      targetPath = `/ticket/${state.selectedTicketExternalId ?? state.selectedTicketId}`
    } else if (state.activeView === 'config') {
      targetPath = '/config'
    } else if (state.activeView === 'project') {
      targetPath = '/project'
    }

    if (currentPath !== targetPath) {
      window.history.pushState(null, '', targetPath)
    }
  }, [state.activeView, state.selectedTicketId, state.selectedTicketExternalId])

  // Apply theme
  useEffect(() => {
    const isDark = state.theme === 'dark' ||
      (state.theme === 'system' && typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.classList.toggle('dark', isDark)
  }, [state.theme])

  return (
    <UIContext.Provider value={{ state, dispatch }}>
      {children}
    </UIContext.Provider>
  )
}

export function useUI() {
  const context = useContext(UIContext)
  if (!context) throw new Error('useUI must be used within UIProvider')
  return context
}

export type { UIState, UIAction }
