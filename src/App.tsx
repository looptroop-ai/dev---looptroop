import { useState, useEffect, useRef } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { KanbanBoard } from '@/components/kanban/KanbanBoard'
import { TicketDashboard } from '@/components/ticket/TicketDashboard'
import { CenteredModal } from '@/components/shared/CenteredModal'
import { ProfileSetup } from '@/components/config/ProfileSetup'
import { ProjectsPanel } from '@/components/project/ProjectsPanel'
import { TicketForm } from '@/components/ticket/TicketForm'
import { KeyboardShortcuts } from '@/components/shared/KeyboardShortcuts'
import { ToastProvider } from '@/components/shared/Toast'
import { WelcomeDisclaimer } from '@/components/shared/WelcomeDisclaimer'
import { useUI } from '@/context/UIContext'
import { useTickets } from '@/hooks/useTickets'
import { useProfile } from '@/hooks/useProfile'

function App() {
  useProfile() // Preload profile for faster Configuration open
  const { state, dispatch } = useUI()
  const { data: tickets } = useTickets()
  const ticketsRef = useRef(tickets)
  ticketsRef.current = tickets
  const initialUrlProcessed = useRef(false)
  const [showProfile, setShowProfile] = useState(false)
  const [showProject, setShowProject] = useState(false)
  const [showTicket, setShowTicket] = useState(false)
  const isModalOpen = showProfile || showProject || showTicket
  const prevPathRef = useRef('/')

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
      <WelcomeDisclaimer />
      <AppShell
        onOpenProfile={openProfile}
        onOpenProject={openProject}
        onOpenTicket={openTicket}
        isModalOpen={isModalOpen}
      >
        {state.activeView === 'ticket' && state.selectedTicketId ? <TicketDashboard /> : <KanbanBoard />}
      </AppShell>

      <CenteredModal open={showProfile} onClose={closeProfile} title="Configuration" maxWidth="max-w-2xl">
        <ProfileSetup onClose={closeProfile} />
      </CenteredModal>

      <CenteredModal open={showProject} onClose={closeProject} title="Projects" maxWidth="max-w-2xl">
        <ProjectsPanel onClose={closeProject} />
      </CenteredModal>

      <CenteredModal open={showTicket} onClose={closeTicket} title="New Ticket" maxWidth="max-w-xl">
        <TicketForm onClose={closeTicket} />
      </CenteredModal>

      <KeyboardShortcuts />
    </ToastProvider>
  )
}

export default App
