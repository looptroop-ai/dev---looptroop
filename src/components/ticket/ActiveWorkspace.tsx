import { lazy, Suspense, useMemo } from 'react'
import type { Ticket } from '@/hooks/useTickets'
import { useWorkflowMeta } from '@/hooks/useWorkflowMeta'
import { getActiveErrorOccurrence, getTicketErrorOccurrences } from '@/lib/errorOccurrences'
import { isBeforeExecution } from '@shared/workflowMeta'

const DraftView = lazy(() => import('@/components/workspace/DraftView').then(m => ({ default: m.DraftView })))
const CouncilView = lazy(() => import('@/components/workspace/CouncilView').then(m => ({ default: m.CouncilView })))
const InterviewQAView = lazy(() => import('@/components/workspace/InterviewQAView').then(m => ({ default: m.InterviewQAView })))
const ApprovalView = lazy(() => import('@/components/workspace/ApprovalView').then(m => ({ default: m.ApprovalView })))
const CodingView = lazy(() => import('@/components/workspace/CodingView').then(m => ({ default: m.CodingView })))
const ErrorView = lazy(() => import('@/components/workspace/ErrorView').then(m => ({ default: m.ErrorView })))
const CanceledView = lazy(() => import('@/components/workspace/CanceledView').then(m => ({ default: m.CanceledView })))
const PhaseReviewView = lazy(() => import('@/components/workspace/PhaseReviewView').then(m => ({ default: m.PhaseReviewView })))
const FullLogView = lazy(() => import('@/components/workspace/FullLogView').then(m => ({ default: m.FullLogView })))

interface ActiveWorkspaceProps {
  ticket: Ticket
  selectedPhase: string
  selectedErrorOccurrenceId?: string | null
  previousStatus?: string
  reviewCutoffStatus?: string
  fullLogOpen?: boolean
}

function isReviewablePhase(
  phase: string,
  currentStatus: string,
  phaseOrder: string[],
  reviewCutoffStatus?: string,
): boolean {
  const phaseIndex = phaseOrder.indexOf(phase)
  if (currentStatus === 'CANCELED') {
    if (!reviewCutoffStatus) return false
    const cutoffIndex = phaseOrder.indexOf(reviewCutoffStatus)
    return phaseIndex >= 0 && cutoffIndex >= 0 && phaseIndex <= cutoffIndex
  }
  const currentIndex = phaseOrder.indexOf(currentStatus)
  return phaseIndex >= 0 && currentIndex >= 0 && phaseIndex < currentIndex
}

export function ActiveWorkspace({ ticket, selectedPhase, selectedErrorOccurrenceId, previousStatus, reviewCutoffStatus, fullLogOpen }: ActiveWorkspaceProps) {
  const { phases, phaseMap } = useWorkflowMeta()
  const phaseOrder = phases.map((phase) => phase.id)
  const phaseMeta = phaseMap[selectedPhase]
  const errorOccurrences = useMemo(() => getTicketErrorOccurrences(ticket), [ticket])
  const explicitErrorOccurrence = selectedErrorOccurrenceId != null
    ? errorOccurrences.find((occurrence) => occurrence.id === selectedErrorOccurrenceId) ?? null
    : null
  const liveErrorOccurrence = ticket.status === 'BLOCKED_ERROR' && selectedPhase === ticket.status
    ? getActiveErrorOccurrence(ticket)
    : null
  const activeErrorOccurrence = explicitErrorOccurrence ?? liveErrorOccurrence
  const isViewingPast = isReviewablePhase(selectedPhase, ticket.status, phaseOrder, reviewCutoffStatus)
  const isLiveErrorOccurrence = Boolean(
    activeErrorOccurrence
    && liveErrorOccurrence
    && activeErrorOccurrence.id === liveErrorOccurrence.id
    && activeErrorOccurrence.resolvedAt === null,
  )
  let content: React.ReactNode

  if (fullLogOpen) {
    content = <FullLogView ticket={ticket} />
  } else if (activeErrorOccurrence) {
    content = <ErrorView ticket={ticket} occurrence={activeErrorOccurrence} readOnly={!isLiveErrorOccurrence} />
  } else if (isViewingPast) {
    const pastPhaseMeta = phaseMap[selectedPhase]
    if (selectedPhase === 'CODING') {
      content = <CodingView ticket={ticket} readOnly />
    } else if (
      pastPhaseMeta?.uiView === 'approval'
      && pastPhaseMeta.reviewArtifactType
      && isBeforeExecution(ticket.status, previousStatus)
    ) {
      content = <ApprovalView ticket={ticket} artifactType={pastPhaseMeta.reviewArtifactType} />
    } else {
      content = <PhaseReviewView phase={selectedPhase} ticket={ticket} />
    }
  } else {
    switch (phaseMeta?.uiView) {
      case 'draft':
        content = <DraftView ticket={ticket} />
        break
      case 'interview_qa':
        content = <InterviewQAView ticket={ticket} />
        break
      case 'approval':
        content = phaseMeta.reviewArtifactType
          ? <ApprovalView ticket={ticket} artifactType={phaseMeta.reviewArtifactType} />
          : <PhaseReviewView phase={selectedPhase} ticket={ticket} />
        break
      case 'coding':
        content = <CodingView ticket={ticket} />
        break
      case 'error':
        content = <ErrorView ticket={ticket} />
        break
      case 'done':
        content = <CodingView ticket={ticket} />
        break
      case 'canceled':
        content = <CanceledView />
        break
      case 'council':
      default:
        content = <CouncilView phase={selectedPhase} ticket={ticket} />
        break
    }
  }

  return (
    <div className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden">
      <Suspense fallback={<div className="flex flex-1 items-center justify-center text-muted-foreground">Loading…</div>}>
        {content}
      </Suspense>
    </div>
  )
}
