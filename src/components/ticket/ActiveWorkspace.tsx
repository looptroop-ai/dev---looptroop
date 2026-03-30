import { useMemo } from 'react'
import { DraftView } from '@/components/workspace/DraftView'
import { CouncilView } from '@/components/workspace/CouncilView'
import { InterviewQAView } from '@/components/workspace/InterviewQAView'
import { ApprovalView } from '@/components/workspace/ApprovalView'
import { CodingView } from '@/components/workspace/CodingView'
import { ErrorView } from '@/components/workspace/ErrorView'
import { DoneView } from '@/components/workspace/DoneView'
import { CanceledView } from '@/components/workspace/CanceledView'
import { PhaseReviewView } from '@/components/workspace/PhaseReviewView'
import type { Ticket } from '@/hooks/useTickets'
import { useWorkflowMeta } from '@/hooks/useWorkflowMeta'
import { getActiveErrorOccurrence, getTicketErrorOccurrences } from '@/lib/errorOccurrences'

interface ActiveWorkspaceProps {
  ticket: Ticket
  selectedPhase: string
  selectedErrorOccurrenceId?: string | null
  previousStatus?: string
  reviewCutoffStatus?: string
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

export function ActiveWorkspace({ ticket, selectedPhase, selectedErrorOccurrenceId, previousStatus: _previousStatus, reviewCutoffStatus }: ActiveWorkspaceProps) {
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

  if (activeErrorOccurrence) {
    return <ErrorView ticket={ticket} occurrence={activeErrorOccurrence} readOnly={!isLiveErrorOccurrence} />
  }

  // If viewing a past/completed phase, show the review view with logs + artifacts
  if (isViewingPast) {
    return <PhaseReviewView phase={selectedPhase} ticket={ticket} />
  }

  switch (phaseMeta?.uiView) {
    case 'draft':
      return <DraftView ticket={ticket} />
    case 'interview_qa':
      return <InterviewQAView ticket={ticket} />
    case 'approval':
      return phaseMeta.reviewArtifactType
        ? <ApprovalView ticket={ticket} artifactType={phaseMeta.reviewArtifactType} />
        : <PhaseReviewView phase={selectedPhase} ticket={ticket} />
    case 'coding':
      return <CodingView ticket={ticket} />
    case 'error':
      return <ErrorView ticket={ticket} />
    case 'done':
      return <DoneView />
    case 'canceled':
      return <CanceledView />
    case 'council':
    default:
      return <CouncilView phase={selectedPhase} ticket={ticket} />
  }
}
