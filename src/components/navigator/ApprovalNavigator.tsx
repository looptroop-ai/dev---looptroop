import { InterviewApprovalNavigator } from './InterviewApprovalNavigator'
import { PrdApprovalNavigator } from './PrdApprovalNavigator'

export function ApprovalNavigator({ ticketId, phase }: { ticketId: string; phase: string }) {
  if (phase === 'WAITING_INTERVIEW_APPROVAL') {
    return <InterviewApprovalNavigator ticketId={ticketId} />
  }

  if (phase === 'WAITING_PRD_APPROVAL') {
    return <PrdApprovalNavigator ticketId={ticketId} />
  }

  return null
}
