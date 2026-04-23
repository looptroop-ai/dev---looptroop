import { lazy, Suspense, useState, useEffect, useRef } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { KanbanBoard } from '@/components/kanban/KanbanBoard'
import { TicketDashboard } from '@/components/ticket/TicketDashboard'
import { CenteredModal } from '@/components/shared/CenteredModal'

const ProfileSetup = lazy(() => import('@/components/config/ProfileSetup').then(m => ({ default: m.ProfileSetup })))
const ProjectsPanel = lazy(() => import('@/components/project/ProjectsPanel').then(m => ({ default: m.ProjectsPanel })))
const TicketForm = lazy(() => import('@/components/ticket/TicketForm').then(m => ({ default: m.TicketForm })))
import { KeyboardShortcuts } from '@/components/shared/KeyboardShortcuts'
import { StartupRestorePopup } from '@/components/shared/StartupRestorePopup'
import { ToastProvider } from '@/components/shared/Toast'
import { AIQuestionProvider } from '@/context/AIQuestionContext'
import {
  WelcomeDisclaimer,
  WELCOME_DISCLAIMER_STORAGE_KEY,
} from '@/components/shared/WelcomeDisclaimer'
import { useUI } from '@/context/useUI'
import { useTickets } from '@/hooks/useTickets'
import { useProfile } from '@/hooks/useProfile'
import { useStartupStatus } from '@/hooks/useStartupStatus'
import { useQueryClient } from '@tanstack/react-query'
import { clearOpenCodeModelsQuery } from '@/hooks/useOpenCodeModels'

function getInitialModal(pathname: string): 'profile' | 'project' | 'ticket' | null {
  if (pathname === '/config') return 'profile'
  if (pathname === '/project/new') return 'project'
  if (pathname === '/ticket/new') return 'ticket'
  return null
}

function App() {
  const initialModal = getInitialModal(window.location.pathname)
  useProfile() // Preload profile for faster Configuration open
  const { data: startupStatus } = useStartupStatus()
  const { state, dispatch } = useUI()
  const queryClient = useQueryClient()
  const ticketsQuery = useTickets()
  const tickets = ticketsQuery.data
  const ticketsRef = useRef(tickets)
  useEffect(() => { ticketsRef.current = tickets }, [tickets])
  const initialUrlProcessed = useRef(false)
  const [showProfile, setShowProfile] = useState(() => initialModal === 'profile')
  const [showProject, setShowProject] = useState(() => initialModal === 'project')
  const [showTicket, setShowTicket] = useState(() => initialModal === 'ticket')
  const [showWelcome, setShowWelcome] = useState(() => {
    try {
      return !localStorage.getItem(WELCOME_DISCLAIMER_STORAGE_KEY)
    } catch {
      return true
    }
  })
  const prevPathRef = useRef('/')
  const showRestorePopup = !showWelcome
    && startupStatus?.storage.kind === 'restored'
    && startupStatus.ui.restoreNotice.shouldShow === true
  const isModalOpen = showProfile || showProject || showTicket || showWelcome || showRestorePopup

  useEffect(() => {
    if (initialModal === 'profile') {
      clearOpenCodeModelsQuery(queryClient)
    }
  }, [initialModal, queryClient])

  useEffect(() => {
    if (!state.selectedTicketId || !ticketsQuery.isFetched || !Array.isArray(tickets)) return
    if (tickets.some(ticket => ticket.id === state.selectedTicketId)) return
    dispatch({ type: 'CLOSE_TICKET' })
  }, [dispatch, state.selectedTicketId, tickets, ticketsQuery.isFetched])

  const dismissWelcome = () => {
    try {
      localStorage.setItem(WELCOME_DISCLAIMER_STORAGE_KEY, 'true')
    } catch {
      // ignore storage errors
    }
    setShowWelcome(false)
  }

  // Resolve ticket from URL externalId when tickets load
  useEffect(() => {
    if (!tickets?.length || initialUrlProcessed.current) return
    const path = window.location.pathname
    if (path.startsWith('/ticket/')) {
      const externalId = path.split('/')[2]
      if (externalId && externalId !== 'new') {
        const ticket = tickets.find(t => t.externalId === externalId)
        if (ticket) dispatch({ type: 'SELECT_TICKET', ticketId: ticket.id, externalId: ticket.externalId })
      }
    }
    initialUrlProcessed.current = true
  }, [tickets]) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle back/forward navigation
  useEffect(() => {
    const handlePop = () => {
      const p = window.location.pathname
      if (p === '/' || p === '') dispatch({ type: 'CLOSE_TICKET' })
      else if (p.startsWith('/ticket/')) {
        const externalId = p.split('/')[2] ?? ''
        if (externalId && externalId !== 'new') {
          const ticket = ticketsRef.current?.find(t => t.externalId === externalId)
          if (ticket) dispatch({ type: 'SELECT_TICKET', ticketId: ticket.id, externalId: ticket.externalId })
        }
      }
    }
    window.addEventListener('popstate', handlePop)
    return () => window.removeEventListener('popstate', handlePop)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Modal open/close helpers that sync URL
  const openProfile = () => {
    clearOpenCodeModelsQuery(queryClient)
    prevPathRef.current = window.location.pathname
    window.history.pushState(null, '', '/config')
    setShowProfile(true)
  }
  const closeProfile = () => {
    window.history.pushState(null, '', prevPathRef.current)
    setShowProfile(false)
  }
  const openProject = () => {
    prevPathRef.current = window.location.pathname
    window.history.pushState(null, '', '/project/new')
    setShowProject(true)
  }
  const closeProject = () => {
    window.history.pushState(null, '', prevPathRef.current)
    setShowProject(false)
  }
  const openTicket = () => {
    prevPathRef.current = window.location.pathname
    window.history.pushState(null, '', '/ticket/new')
    setShowTicket(true)
  }
  const closeTicket = () => {
    window.history.pushState(null, '', prevPathRef.current)
    setShowTicket(false)
  }

  return (
    <ToastProvider>
      <AIQuestionProvider tickets={tickets ?? []}>
        <WelcomeDisclaimer
          open={showWelcome}
          onDismiss={dismissWelcome}
          appPathWarning={startupStatus?.runtime.appPathWarning ?? null}
        />
        {startupStatus && (
          <StartupRestorePopup
            open={showRestorePopup}
            startupStatus={startupStatus}
          />
        )}
        <AppShell
          onOpenProfile={openProfile}
          onOpenProject={openProject}
          onOpenTicket={openTicket}
          isModalOpen={isModalOpen}
        >
          {state.activeView === 'ticket' && state.selectedTicketId ? <TicketDashboard /> : <KanbanBoard />}
        </AppShell>

        <CenteredModal open={showProfile} onClose={closeProfile} title="Configuration" maxWidth="max-w-2xl">
          <Suspense fallback={<div className="p-4 text-center text-muted-foreground">Loading…</div>}>
            <ProfileSetup onClose={closeProfile} />
          </Suspense>
        </CenteredModal>

        <CenteredModal open={showProject} onClose={closeProject} title="Projects" maxWidth="max-w-2xl">
          <Suspense fallback={<div className="p-4 text-center text-muted-foreground">Loading…</div>}>
            <ProjectsPanel onClose={closeProject} />
          </Suspense>
        </CenteredModal>

        <CenteredModal open={showTicket} onClose={closeTicket} title="New Ticket" maxWidth="max-w-xl">
          <Suspense fallback={<div className="p-4 text-center text-muted-foreground">Loading…</div>}>
            <TicketForm onClose={closeTicket} />
          </Suspense>
        </CenteredModal>

        <KeyboardShortcuts />
      </AIQuestionProvider>
    </ToastProvider>
  )
}

export default App
