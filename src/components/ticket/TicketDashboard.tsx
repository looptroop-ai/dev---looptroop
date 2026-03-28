import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSaveTicketUIState, useTicket } from '@/hooks/useTickets'
import { useSSE } from '@/hooks/useSSE'
import { useUI } from '@/context/useUI'
import { LogProvider } from '@/context/LogContext'
import { useLogs } from '@/context/useLogContext'
import { DashboardHeader } from './DashboardHeader'
import { NavigatorPanel } from './NavigatorPanel'
import { ActiveWorkspace } from './ActiveWorkspace'
import { ResizeHandle } from './ResizeHandle'
import { Menu, X } from 'lucide-react'
import { clearErrorTicketSeen, getErrorTicketSignature, markErrorTicketSeen } from '@/lib/errorTicketSeen'
import { MAX_RAW_OUTPUT_LENGTH } from '@/lib/constants'
import { WORKFLOW_PHASE_IDS } from '@shared/workflowMeta'
import { getActiveErrorOccurrence, getTicketErrorOccurrences } from '@/lib/errorOccurrences'
import { INTERVIEW_APPROVAL_FOCUS_EVENT } from '@/lib/interviewDocument'
import { PRD_APPROVAL_FOCUS_EVENT } from '@/lib/prdDocument'
import { WORKSPACE_PHASE_NAVIGATE_EVENT, type WorkspacePhaseNavigateDetail } from '@/lib/workspaceNavigation'

function toDebugJson(data: Record<string, unknown>) {
  if (import.meta.env.PROD) return '[debug]'
  try {
    const raw = JSON.stringify(data)
    return raw.length > MAX_RAW_OUTPUT_LENGTH ? `${raw.slice(0, MAX_RAW_OUTPUT_LENGTH)}…[truncated]` : raw
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
  onStateChange?: (payload: { status: string; previousStatus?: string }) => void
}) {
  const logCtx = useLogs()

  const handleEvent = useCallback((event: { type: string; data: Record<string, unknown> }) => {
    if (event.type === 'state_change') {
      const from = String(event.data.from ?? '')
      const to = String(event.data.to ?? '')
      if (to) {
        onStateChange?.({
          status: to,
          ...(from ? { previousStatus: from } : {}),
        })
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
  const [errorSelection, setErrorSelection] = useState<{ ticketId: string | null; occurrenceId: string | null }>({
    ticketId: null,
    occurrenceId: null,
  })
  const [pendingWorkspaceNavigation, setPendingWorkspaceNavigation] = useState<{
    ticketId: string
    phase: string
    anchorId?: string
  } | null>(null)
  const [livePhase, setLivePhase] = useState<{
    ticketId: string | null
    phase: string | null
    previousStatus: string | null
    reviewCutoffStatus: string | null
  }>({
    ticketId: null,
    phase: null,
    previousStatus: null,
    reviewCutoffStatus: null,
  })
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const snapshotPreviousStatus = useMemo(
    () => ticket?.previousStatus ?? undefined,
    [ticket?.previousStatus],
  )
  const snapshotReviewCutoffStatus = useMemo(
    () => ticket?.reviewCutoffStatus ?? undefined,
    [ticket?.reviewCutoffStatus],
  )

  const closeMobileNav = useCallback(() => setMobileNavOpen(false), [])
  // When a React Query refetch returns a status that is further along in the
  // workflow than the SSE-delivered livePhase, advance livePhase so the UI
  // doesn't stay pinned to a stale earlier status.  This fixes a race where
  // fast phase transitions (e.g. SCANNING_RELEVANT_FILES completing quickly)
  // cause the refetch to leapfrog the SSE event delivery.
  const dbStatus = ticket?.status
  if (dbStatus && livePhase.ticketId === ticketId && livePhase.phase && livePhase.phase !== dbStatus) {
    const liveIdx = WORKFLOW_PHASE_IDS.indexOf(livePhase.phase)
    const dbIdx = WORKFLOW_PHASE_IDS.indexOf(dbStatus)
    if (liveIdx >= 0 && dbIdx >= 0 && dbIdx > liveIdx) {
      setLivePhase({
        ticketId,
        phase: dbStatus,
        previousStatus: null,
        reviewCutoffStatus: null,
      })
    }
  }

  const liveStatus = livePhase.ticketId === ticketId && livePhase.phase && livePhase.phase !== ticket?.status
    ? livePhase.phase
    : null
  const currentStatus = liveStatus ?? ticket?.status ?? ''
  const livePhaseMeta = livePhase.ticketId === ticketId && livePhase.phase === currentStatus
    ? livePhase
    : null
  const previousStatus = livePhaseMeta?.previousStatus ?? snapshotPreviousStatus
  const reviewCutoffStatus = livePhaseMeta?.reviewCutoffStatus ?? snapshotReviewCutoffStatus
  const effectiveTicket = useMemo(() => {
    if (!ticket) return null
    if (currentStatus === ticket.status) return ticket
    return {
      ...ticket,
      status: currentStatus,
      previousStatus: previousStatus ?? ticket.previousStatus,
      reviewCutoffStatus: reviewCutoffStatus ?? ticket.reviewCutoffStatus,
    }
  }, [currentStatus, previousStatus, reviewCutoffStatus, ticket])
  const errorSignature = effectiveTicket ? getErrorTicketSignature(effectiveTicket) : null
  const ticketErrorOccurrences = useMemo(() => (effectiveTicket ? getTicketErrorOccurrences(effectiveTicket) : []), [effectiveTicket])
  const selectedErrorOccurrenceId = errorSelection.ticketId === ticketId ? errorSelection.occurrenceId : null
  const selectedErrorOccurrence = useMemo(
    () => selectedErrorOccurrenceId != null
      ? ticketErrorOccurrences.find((occurrence) => occurrence.id === selectedErrorOccurrenceId) ?? null
      : null,
    [selectedErrorOccurrenceId, ticketErrorOccurrences],
  )
  const selectedPhase = phaseSelection.ticketId === ticketId && phaseSelection.phase !== currentStatus
    ? phaseSelection.phase
    : null
  const selectedPhaseForWorkspace = selectedPhase ?? currentStatus
  const liveErrorOccurrence = useMemo(() => {
    if (!effectiveTicket) return null
    if (selectedPhase && selectedPhase !== currentStatus) return null
    if (selectedErrorOccurrence) return selectedErrorOccurrence
    return currentStatus === 'BLOCKED_ERROR' ? getActiveErrorOccurrence(effectiveTicket) : null
  }, [currentStatus, effectiveTicket, selectedErrorOccurrence, selectedPhase])
  const contextPhase = selectedErrorOccurrence?.blockedFromStatus
    ?? liveErrorOccurrence?.blockedFromStatus
    ?? selectedPhaseForWorkspace
  const handleSelectPhase = useCallback((phase: string | null) => {
    setPhaseSelection({ ticketId, phase })
    setErrorSelection({ ticketId: null, occurrenceId: null })
  }, [ticketId])
  const handleSelectErrorOccurrence = useCallback((occurrenceId: string | null) => {
    setErrorSelection({ ticketId, occurrenceId })
    if (occurrenceId != null) {
      setPhaseSelection({ ticketId: null, phase: null })
    }
  }, [ticketId])
  const handleLiveStatusChange = useCallback(({ status, previousStatus }: { status: string; previousStatus?: string }) => {
    setLivePhase((current) => {
      const nextPreviousStatus = previousStatus ?? null
      let nextReviewCutoffStatus: string | null = null

      if (status === 'BLOCKED_ERROR') {
        nextReviewCutoffStatus = nextPreviousStatus
          ?? current.reviewCutoffStatus
          ?? snapshotReviewCutoffStatus
          ?? snapshotPreviousStatus
          ?? null
      } else if (status === 'CANCELED') {
        if (nextPreviousStatus === 'BLOCKED_ERROR') {
          nextReviewCutoffStatus = current.phase === 'BLOCKED_ERROR'
            ? current.reviewCutoffStatus
            : snapshotReviewCutoffStatus
              ?? (ticket?.status === 'BLOCKED_ERROR' ? snapshotPreviousStatus ?? null : null)
        } else {
          nextReviewCutoffStatus = nextPreviousStatus ?? snapshotReviewCutoffStatus ?? null
        }
      }

      if (
        current.ticketId === ticketId
        && current.phase === status
        && current.previousStatus === nextPreviousStatus
        && current.reviewCutoffStatus === nextReviewCutoffStatus
      ) {
        return current
      }

      return {
        ticketId,
        phase: status,
        previousStatus: nextPreviousStatus,
        reviewCutoffStatus: nextReviewCutoffStatus,
      }
    })
    setPhaseSelection((current) => {
      if (current.ticketId === ticketId && current.phase === status) {
        return { ticketId, phase: null }
      }
      if (status !== 'BLOCKED_ERROR' && current.ticketId === ticketId && current.phase === 'BLOCKED_ERROR') {
        return { ticketId, phase: null }
      }
      return current
    })
  }, [ticket?.status, ticketId, snapshotPreviousStatus, snapshotReviewCutoffStatus])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<WorkspacePhaseNavigateDetail>).detail
      if (!detail?.ticketId || detail.ticketId !== ticketId || !detail.phase) return

      setPhaseSelection({
        ticketId,
        phase: detail.phase === currentStatus ? null : detail.phase,
      })
      setErrorSelection({ ticketId: null, occurrenceId: null })
      if (detail.phase === 'WAITING_INTERVIEW_APPROVAL' || detail.phase === 'WAITING_PRD_APPROVAL') {
        setPendingWorkspaceNavigation(detail)
      } else {
        setPendingWorkspaceNavigation(null)
      }
      closeMobileNav()
    }

    window.addEventListener(WORKSPACE_PHASE_NAVIGATE_EVENT, handler as EventListener)
    return () => window.removeEventListener(WORKSPACE_PHASE_NAVIGATE_EVENT, handler as EventListener)
  }, [closeMobileNav, currentStatus, ticketId])

  useEffect(() => {
    if (!pendingWorkspaceNavigation?.anchorId || pendingWorkspaceNavigation.ticketId !== ticketId) return
    if (selectedPhaseForWorkspace !== pendingWorkspaceNavigation.phase) return

    const focusEventType = pendingWorkspaceNavigation.phase === 'WAITING_INTERVIEW_APPROVAL'
      ? INTERVIEW_APPROVAL_FOCUS_EVENT
      : pendingWorkspaceNavigation.phase === 'WAITING_PRD_APPROVAL'
        ? PRD_APPROVAL_FOCUS_EVENT
        : null

    if (!focusEventType) return

    const frame = window.requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent(focusEventType, {
        detail: {
          ticketId,
          anchorId: pendingWorkspaceNavigation.anchorId,
        },
      }))
      setPendingWorkspaceNavigation(null)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [pendingWorkspaceNavigation, selectedPhaseForWorkspace, ticketId])

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
  }, [ticket, errorSignature, saveTicketUiState])

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

  if (!effectiveTicket) return null

  const activePhase = selectedPhase ?? currentStatus
  const activeErrorOccurrenceId = liveErrorOccurrence?.id ?? selectedErrorOccurrenceId

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
                  ticket={effectiveTicket}
                  currentStatus={currentStatus}
                  selectedPhase={activePhase}
                  selectedErrorOccurrenceId={selectedErrorOccurrenceId}
                  reviewCutoffStatus={reviewCutoffStatus}
                  previousStatus={previousStatus}
                  onSelectPhase={(phase) => {
                    handleSelectPhase(phase)
                    setMobileNavOpen(false)
                  }}
                  onSelectErrorOccurrence={(occurrenceId) => {
                    handleSelectErrorOccurrence(occurrenceId)
                    setMobileNavOpen(false)
                  }}
                  contextPhase={contextPhase}
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
              ticket={effectiveTicket}
              currentStatus={currentStatus}
              selectedPhase={activePhase}
              selectedErrorOccurrenceId={selectedErrorOccurrenceId}
              reviewCutoffStatus={reviewCutoffStatus}
              previousStatus={previousStatus}
              onSelectPhase={handleSelectPhase}
              onSelectErrorOccurrence={handleSelectErrorOccurrence}
              contextPhase={contextPhase}
            />
          </div>
          <ResizeHandle onResize={setNavWidth} />
          {/* Active Workspace */}
          <div className="flex flex-col flex-1 overflow-hidden">
            <ActiveWorkspace
              ticket={effectiveTicket}
              selectedPhase={activePhase}
              selectedErrorOccurrenceId={activeErrorOccurrenceId}
              previousStatus={previousStatus}
              reviewCutoffStatus={reviewCutoffStatus}
            />
          </div>
        </div>
      </div>
    </LogProvider>
  )
}
