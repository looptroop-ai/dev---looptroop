import { InterviewApprovalNavigator } from './InterviewApprovalNavigator'
import { PrdApprovalNavigator } from './PrdApprovalNavigator'
import { BeadsApprovalNavigator } from './BeadsApprovalNavigator'

export function ApprovalNavigator({ ticketId, phase }: { ticketId: string; phase: string }) {
  if (phase === 'WAITING_INTERVIEW_APPROVAL') {
    return <InterviewApprovalNavigator ticketId={ticketId} />
  }

  if (phase === 'WAITING_PRD_APPROVAL') {
    return <PrdApprovalNavigator ticketId={ticketId} />
  }

  if (phase === 'WAITING_BEADS_APPROVAL') {
    return <BeadsApprovalNavigator ticketId={ticketId} />
  }

  return null
}
