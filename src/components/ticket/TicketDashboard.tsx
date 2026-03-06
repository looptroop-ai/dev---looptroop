import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTicket } from '@/hooks/useTickets'
import { useSSE } from '@/hooks/useSSE'
import { useUI } from '@/context/UIContext'
import { LogProvider, formatLogLine, useLogs } from '@/context/LogContext'
import { DashboardHeader } from './DashboardHeader'
import { NavigatorPanel } from './NavigatorPanel'
import { ActiveWorkspace } from './ActiveWorkspace'
import { ResizeHandle } from './ResizeHandle'
import { Menu, X } from 'lucide-react'

function toDebugJson(data: Record<string, unknown>) {
  try {
    const raw = JSON.stringify(data)
    return raw.length > 4000 ? `${raw.slice(0, 4000)}…[truncated]` : raw
  } catch {
    return '[unserializable]'
  }
}

function SSELogConnector({ ticketId, currentStatus }: { ticketId: number | null; currentStatus: string }) {
  const logCtx = useLogs()

  const handleEvent = useCallback((event: { type: string; data: Record<string, unknown> }) => {
    if (event.type === 'state_change') {
      const from = String(event.data.from ?? '')
      const to = String(event.data.to ?? '')
      if (to) {
        logCtx?.setActivePhase(to)
        logCtx?.addLog(
          to,
          `[DEBUG] sse.state_change ${toDebugJson(event.data)}`,
          'debug',
          to,
          typeof event.data.timestamp === 'string' ? event.data.timestamp : undefined,
        )
        logCtx?.addLog(
          to,
          `[SYS] Transition: ${from || 'unknown'} -> ${to}`,
          'system',
          to,
          typeof event.data.timestamp === 'string' ? event.data.timestamp : undefined,
        )
      }
      return
    }

    if (event.type === 'log') {
      const phase = String(event.data.phase ?? logCtx?.activePhase ?? currentStatus ?? '')
      if (phase) {
        logCtx?.addLog(
          phase,
          `[DEBUG] sse.log ${toDebugJson(event.data)}`,
          'debug',
          phase,
          typeof event.data.timestamp === 'string' ? event.data.timestamp : undefined,
        )
        const { line, source } = formatLogLine(event.data)
        logCtx?.addLog(
          phase,
          line,
          source,
          phase,
          typeof event.data.timestamp === 'string' ? event.data.timestamp : undefined,
        )
      }
      return
    }

    if (event.type === 'error') {
      const phase = String(event.data.phase ?? logCtx?.activePhase ?? currentStatus ?? '')
      if (phase) {
        logCtx?.addLog(
          phase,
          `[DEBUG] sse.error ${toDebugJson(event.data)}`,
          'debug',
          phase,
          typeof event.data.timestamp === 'string' ? event.data.timestamp : undefined,
        )
        logCtx?.addLog(
          phase,
          `[ERROR] ${String(event.data.message ?? 'Unknown error')}`,
          'error',
          phase,
          typeof event.data.timestamp === 'string' ? event.data.timestamp : undefined,
        )
      }
      return
    }

    // Forward interview_batch needs_input events to InterviewQAView via window.postMessage
    if (event.type === 'needs_input' && event.data.type === 'interview_batch') {
      window.postMessage(JSON.stringify({
        type: 'interview_batch',
        ticketId: event.data.ticketId,
        batch: event.data.batch,
      }), '*')
    }

    const phase = String(event.data.phase ?? logCtx?.activePhase ?? currentStatus ?? '')
    if (phase) {
      logCtx?.addLog(
        phase,
        `[DEBUG] sse.${event.type} ${toDebugJson(event.data)}`,
        'debug',
        phase,
        typeof event.data.timestamp === 'string' ? event.data.timestamp : undefined,
      )
    }
  }, [logCtx, currentStatus])

  useSSE({ ticketId, onEvent: handleEvent })

  return null
}

export function TicketDashboard() {
  const { state, dispatch } = useUI()
  const ticketId = state.selectedTicketId
  const { data: ticket } = useTicket(ticketId)
  const [navWidth, setNavWidth] = useState(280)
  const [selectedPhase, setSelectedPhase] = useState<string | null>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const canceledFromStatus = useMemo(() => {
    if (ticket?.status !== 'CANCELED' || !ticket.xstateSnapshot) return undefined
    try {
      const snap = JSON.parse(ticket.xstateSnapshot) as { context?: { previousStatus?: string | null } }
      const prev = snap.context?.previousStatus
      return typeof prev === 'string' ? prev : undefined
    } catch { return undefined }
  }, [ticket?.status, ticket?.xstateSnapshot])

  const closeMobileNav = useCallback(() => setMobileNavOpen(false), [])

  // Reset selected phase when ticket changes
  useEffect(() => {
    setSelectedPhase(null)
  }, [ticketId])

  // Escape key closes dashboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (mobileNavOpen) {
          setMobileNavOpen(false)
        } else {
          dispatch({ type: 'CLOSE_TICKET' })
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [dispatch, mobileNavOpen])

  if (!ticketId || !ticket) return null

  const activePhase = selectedPhase ?? ticket.status

  return (
    <LogProvider ticketId={ticketId} currentStatus={ticket.status}>
    <SSELogConnector ticketId={ticketId} currentStatus={ticket.status} />
    <div className="fixed inset-0 z-[60] bg-background flex flex-col">
      <DashboardHeader ticket={ticket} />

      {/* Mobile nav toggle */}
      <div className="md:hidden flex items-center px-3 py-2 border-b border-border">
        <button
          className="flex items-center justify-center h-8 w-8 rounded-md border border-border text-foreground hover:bg-accent"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open navigation"
        >
          <Menu className="h-4 w-4" />
        </button>
      </div>

      {/* Mobile nav overlay */}
      {mobileNavOpen && (
        <div className="md:hidden fixed inset-0 z-[70]">
          <div className="fixed inset-0 bg-black/50" onClick={closeMobileNav} />
          <div className="fixed left-0 top-0 bottom-0 z-[71] w-72 bg-background border-r border-border shadow-xl flex flex-col">
            <div className="flex items-center justify-end p-2">
              <button
                className="flex items-center justify-center h-8 w-8 rounded-md border border-border text-foreground hover:bg-accent"
                onClick={closeMobileNav}
                aria-label="Close navigation"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <NavigatorPanel
                ticketId={ticket.id}
                currentStatus={ticket.status}
                selectedPhase={activePhase}
                canceledFromStatus={canceledFromStatus}
                onSelectPhase={(phase) => {
                  setSelectedPhase(phase)
                  setMobileNavOpen(false)
                }}
              />
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Navigator Panel — hidden on mobile */}
        <div
          className="hidden md:block flex-shrink-0 border-r border-border overflow-hidden"
          style={{ width: navWidth }}
        >
          <NavigatorPanel
            ticketId={ticket.id}
            currentStatus={ticket.status}
            selectedPhase={activePhase}
            canceledFromStatus={canceledFromStatus}
            onSelectPhase={setSelectedPhase}
          />
        </div>
        <ResizeHandle onResize={setNavWidth} />
        {/* Active Workspace */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <ActiveWorkspace ticket={ticket} selectedPhase={activePhase} canceledFromStatus={canceledFromStatus} />
        </div>
      </div>
    </div>
    </LogProvider>
  )
}
