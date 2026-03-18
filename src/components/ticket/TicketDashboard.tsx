import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSaveTicketUIState, useTicket } from '@/hooks/useTickets'
import { useSSE } from '@/hooks/useSSE'
import { useUI } from '@/context/UIContext'
import { LogProvider, useLogs } from '@/context/LogContext'
import { DashboardHeader } from './DashboardHeader'
import { NavigatorPanel } from './NavigatorPanel'
import { ActiveWorkspace } from './ActiveWorkspace'
import { ResizeHandle } from './ResizeHandle'
import { Menu, X } from 'lucide-react'
import { clearErrorTicketSeen, getErrorTicketSignature, markErrorTicketSeen } from '@/lib/errorTicketSeen'

function toDebugJson(data: Record<string, unknown>) {
  if (import.meta.env.PROD) return '[debug]'
  try {
    const raw = JSON.stringify(data)
    return raw.length > 4000 ? `${raw.slice(0, 4000)}…[truncated]` : raw
  } catch {
    return '[unserializable]'
  }
}

function SSELogConnector({
  ticketId,
  currentStatus,
  onStateChange,
}: {
  ticketId: string | null
  currentStatus: string
  onStateChange?: (status: string) => void
}) {
  const logCtx = useLogs()

  const handleEvent = useCallback((event: { type: string; data: Record<string, unknown> }) => {
    if (event.type === 'state_change') {
      const from = String(event.data.from ?? '')
      const to = String(event.data.to ?? '')
      if (to) {
        onStateChange?.(to)
        logCtx?.setActivePhase(to)
        logCtx?.addLog(
          to,
          `[DEBUG] sse.state_change ${toDebugJson(event.data)}`,
          {
            source: 'debug',
            status: to,
            timestamp: typeof event.data.timestamp === 'string' ? event.data.timestamp : undefined,
            audience: 'debug',
            kind: 'session',
          },
        )
        logCtx?.addLog(
          to,
          `[SYS] Transition: ${from || 'unknown'} -> ${to}`,
          {
            source: 'system',
            status: to,
            timestamp: typeof event.data.timestamp === 'string' ? event.data.timestamp : undefined,
            audience: 'all',
            kind: 'milestone',
          },
        )
      }
      return
    }

    if (event.type === 'log') {
      const phase = String(event.data.phase ?? logCtx?.activePhase ?? currentStatus ?? '')
      if (phase) {
        logCtx?.addLogRecord(phase, event.data)
      }
      return
    }

    if (event.type === 'error') {
      const phase = String(event.data.phase ?? logCtx?.activePhase ?? currentStatus ?? '')
      if (phase) {
        logCtx?.addLog(
          phase,
          `[DEBUG] sse.error ${toDebugJson(event.data)}`,
          {
            source: 'debug',
            status: phase,
            timestamp: typeof event.data.timestamp === 'string' ? event.data.timestamp : undefined,
            audience: 'debug',
            kind: 'error',
          },
        )
        logCtx?.addLogRecord(phase, {
          type: 'error',
          phase,
          status: phase,
          source: 'error',
          audience: 'all',
          kind: 'error',
          content: String(event.data.message ?? 'Unknown error'),
          timestamp: typeof event.data.timestamp === 'string' ? event.data.timestamp : undefined,
        })
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

    // Forward interview_error events so InterviewQAView can show the error
    if (event.type === 'needs_input' && event.data.type === 'interview_error') {
      window.postMessage(JSON.stringify({
        type: 'interview_error',
        ticketId: event.data.ticketId,
        error: event.data.error,
      }), '*')
    }

    const phase = String(event.data.phase ?? logCtx?.activePhase ?? currentStatus ?? '')
    if (phase) {
      logCtx?.addLog(
        phase,
        `[DEBUG] sse.${event.type} ${toDebugJson(event.data)}`,
        {
          source: 'debug',
          status: phase,
          timestamp: typeof event.data.timestamp === 'string' ? event.data.timestamp : undefined,
          audience: 'debug',
          kind: 'session',
        },
      )
    }
  }, [currentStatus, logCtx, onStateChange])

  useSSE({ ticketId, onEvent: handleEvent })

  return null
}

export function TicketDashboard() {
  const { state, dispatch } = useUI()
  const ticketId = state.selectedTicketId
  const { data: ticket } = useTicket(ticketId)
  const { mutate: saveTicketUiState } = useSaveTicketUIState()
  const [navWidth, setNavWidth] = useState(280)
  const [phaseSelection, setPhaseSelection] = useState<{ ticketId: string | null; phase: string | null }>({
    ticketId: null,
    phase: null,
  })
  const [livePhase, setLivePhase] = useState<{ ticketId: string | null; phase: string | null }>({
    ticketId: null,
    phase: null,
  })
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const snapshotPreviousStatus = useMemo(
    () => ticket?.previousStatus ?? undefined,
    [ticket?.previousStatus],
  )

  const errorSignature = ticket ? getErrorTicketSignature(ticket) : null

  const closeMobileNav = useCallback(() => setMobileNavOpen(false), [])
  const selectedPhase = phaseSelection.ticketId === ticketId && phaseSelection.phase !== (livePhase.ticketId === ticketId ? (livePhase.phase ?? ticket?.status ?? '') : ticket?.status ?? '')
    ? phaseSelection.phase
    : null
  const liveStatus = livePhase.ticketId === ticketId && livePhase.phase !== ticket?.status
    ? livePhase.phase
    : null
  const currentStatus = liveStatus ?? ticket?.status ?? ''
  const handleSelectPhase = useCallback((phase: string | null) => {
    setPhaseSelection({ ticketId, phase })
  }, [ticketId])
  const handleLiveStatusChange = useCallback((phase: string) => {
    setLivePhase((current) => {
      if (current.ticketId === ticketId && current.phase === phase) return current
      return { ticketId, phase }
    })
    setPhaseSelection((current) => {
      if (current.ticketId === ticketId && current.phase === phase) {
        return { ticketId, phase: null }
      }
      return current
    })
  }, [ticketId])

  useEffect(() => {
    if (!ticket) return
    if (errorSignature) {
      markErrorTicketSeen(ticket.id, errorSignature)
      if (ticket.errorSeenSignature !== errorSignature) {
        saveTicketUiState({
          ticketId: ticket.id,
          scope: 'error_attention',
          data: { seenSignature: errorSignature },
        })
      }
      return
    }
    clearErrorTicketSeen(ticket.id)
    if (ticket.errorSeenSignature !== null) {
      saveTicketUiState({
        ticketId: ticket.id,
        scope: 'error_attention',
        data: { seenSignature: null },
      })
    }
  }, [ticket?.id, errorSignature, ticket?.errorSeenSignature, saveTicketUiState])

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

  if (!ticketId) return null

  if (!ticket) return (
    <div className="fixed inset-0 z-[60] bg-background flex flex-col">
      {/* Skeleton header */}
      <div className="h-12 border-b border-border flex items-center px-4 gap-3">
        <div className="h-4 w-16 bg-muted animate-pulse rounded" />
        <div className="h-4 w-48 bg-muted animate-pulse rounded" />
        <div className="h-5 w-20 bg-muted animate-pulse rounded-full ml-auto" />
        <div className="h-8 w-8 bg-muted animate-pulse rounded" />
      </div>
      <div className="flex flex-1 overflow-hidden">
        {/* Skeleton sidebar */}
        <div className="w-[280px] border-r border-border p-4 space-y-4 hidden md:block">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="h-6 w-6 bg-muted animate-pulse rounded-full" />
              <div className="h-3 bg-muted animate-pulse rounded flex-1" />
            </div>
          ))}
        </div>
        {/* Skeleton workspace */}
        <div className="flex-1 p-6 space-y-4">
          <div className="h-5 w-40 bg-muted animate-pulse rounded" />
          <div className="h-3 w-72 bg-muted animate-pulse rounded" />
          <div className="h-32 bg-muted animate-pulse rounded-md mt-4" />
        </div>
      </div>
    </div>
  )

  const effectiveTicket = currentStatus === ticket.status
    ? ticket
    : { ...ticket, status: currentStatus }
  const canceledFromStatus = currentStatus === 'CANCELED' ? snapshotPreviousStatus : undefined
  const previousStatus = currentStatus === 'BLOCKED_ERROR' ? snapshotPreviousStatus : undefined
  const activePhase = selectedPhase ?? currentStatus

  return (
    <LogProvider key={ticketId} ticketId={ticketId} currentStatus={currentStatus}>
      <SSELogConnector ticketId={ticketId} currentStatus={currentStatus} onStateChange={handleLiveStatusChange} />
      <div className="fixed inset-0 z-[60] bg-background flex flex-col">
        <DashboardHeader ticket={effectiveTicket} />

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
                  currentStatus={currentStatus}
                  selectedPhase={activePhase}
                  canceledFromStatus={canceledFromStatus}
                  previousStatus={previousStatus}
                  onSelectPhase={(phase) => {
                    handleSelectPhase(phase)
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
              currentStatus={currentStatus}
              selectedPhase={activePhase}
              canceledFromStatus={canceledFromStatus}
              previousStatus={previousStatus}
              onSelectPhase={handleSelectPhase}
            />
          </div>
          <ResizeHandle onResize={setNavWidth} />
          {/* Active Workspace */}
          <div className="flex flex-col flex-1 overflow-hidden">
            <ActiveWorkspace ticket={effectiveTicket} selectedPhase={activePhase} canceledFromStatus={canceledFromStatus} />
          </div>
        </div>
      </div>
    </LogProvider>
  )
}
