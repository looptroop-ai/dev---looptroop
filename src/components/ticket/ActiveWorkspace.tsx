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

interface ActiveWorkspaceProps {
  ticket: Ticket
  selectedPhase: string
  canceledFromStatus?: string
}

const COUNCIL_STATES = [
  'COUNCIL_DELIBERATING', 'COUNCIL_VOTING_INTERVIEW', 'COMPILING_INTERVIEW',
  'VERIFYING_INTERVIEW_COVERAGE', 'DRAFTING_PRD', 'COUNCIL_VOTING_PRD',
  'REFINING_PRD', 'VERIFYING_PRD_COVERAGE', 'DRAFTING_BEADS',
  'COUNCIL_VOTING_BEADS', 'REFINING_BEADS', 'VERIFYING_BEADS_COVERAGE',
]

const ALL_PHASE_IDS = [
  'DRAFT', 'COUNCIL_DELIBERATING', 'COUNCIL_VOTING_INTERVIEW', 'COMPILING_INTERVIEW',
  'WAITING_INTERVIEW_ANSWERS', 'VERIFYING_INTERVIEW_COVERAGE', 'WAITING_INTERVIEW_APPROVAL',
  'DRAFTING_PRD', 'COUNCIL_VOTING_PRD', 'REFINING_PRD', 'VERIFYING_PRD_COVERAGE', 'WAITING_PRD_APPROVAL',
  'DRAFTING_BEADS', 'COUNCIL_VOTING_BEADS', 'REFINING_BEADS', 'VERIFYING_BEADS_COVERAGE', 'WAITING_BEADS_APPROVAL',
  'PRE_FLIGHT_CHECK', 'CODING', 'RUNNING_FINAL_TEST', 'INTEGRATING_CHANGES',
  'WAITING_MANUAL_VERIFICATION', 'CLEANING_ENV', 'COMPLETED',
]

function isPastPhase(phase: string, currentStatus: string, canceledFromStatus?: string): boolean {
  const phaseIndex = ALL_PHASE_IDS.indexOf(phase)
  if (currentStatus === 'CANCELED') {
    if (!canceledFromStatus || canceledFromStatus === 'BLOCKED_ERROR') return false
    const cutoffIndex = ALL_PHASE_IDS.indexOf(canceledFromStatus)
    return phaseIndex >= 0 && cutoffIndex >= 0 && phaseIndex <= cutoffIndex
  }
  const currentIndex = ALL_PHASE_IDS.indexOf(currentStatus)
  return phaseIndex >= 0 && currentIndex >= 0 && phaseIndex < currentIndex
}

export function ActiveWorkspace({ ticket, selectedPhase, canceledFromStatus }: ActiveWorkspaceProps) {
  const isViewingPast = isPastPhase(selectedPhase, ticket.status, canceledFromStatus)

  // If viewing a past/completed phase, show the review view with logs + artifacts
  if (isViewingPast) {
    return <PhaseReviewView phase={selectedPhase} ticket={ticket} />
  }

  // Current phase — show the live/interactive view
  switch (selectedPhase) {
    case 'DRAFT':
      return <DraftView ticket={ticket} />

    case 'WAITING_INTERVIEW_ANSWERS':
      return <InterviewQAView ticket={ticket} />

    case 'WAITING_INTERVIEW_APPROVAL':
      return <ApprovalView ticket={ticket} artifactType="interview" />
    case 'WAITING_PRD_APPROVAL':
      return <ApprovalView ticket={ticket} artifactType="prd" />
    case 'WAITING_BEADS_APPROVAL':
      return <ApprovalView ticket={ticket} artifactType="beads" />

    case 'WAITING_MANUAL_VERIFICATION':
      return <CodingView ticket={ticket} />

    case 'PRE_FLIGHT_CHECK':
    case 'CODING':
    case 'RUNNING_FINAL_TEST':
    case 'INTEGRATING_CHANGES':
    case 'CLEANING_ENV':
      return <CodingView ticket={ticket} />

    case 'BLOCKED_ERROR':
      return <ErrorView ticket={ticket} />

    case 'COMPLETED':
      return <DoneView />

    case 'CANCELED':
      return <CanceledView />

    default:
      if (COUNCIL_STATES.includes(selectedPhase)) {
        return <CouncilView phase={selectedPhase} ticket={ticket} />
      }
      return <CouncilView phase={selectedPhase} ticket={ticket} />
  }
}
