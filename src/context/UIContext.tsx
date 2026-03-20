import { useReducer, useEffect, type ReactNode } from 'react'
import { UIContext, type UIState, type UIAction } from './uiContextDef'

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

  // Apply theme and listen for system changes
  useEffect(() => {
    const applyTheme = () => {
      const isDark = state.theme === 'dark' ||
        (state.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.classList.toggle('dark', isDark)
    }
    applyTheme()

    if (state.theme === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)')
      mql.addEventListener('change', applyTheme)
      return () => mql.removeEventListener('change', applyTheme)
    }
  }, [state.theme])

  return (
    <UIContext.Provider value={{ state, dispatch }}>
      {children}
    </UIContext.Provider>
  )
}
