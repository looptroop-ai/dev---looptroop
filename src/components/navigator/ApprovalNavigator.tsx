import { InterviewApprovalNavigator } from './InterviewApprovalNavigator'
import { PrdApprovalNavigator } from './PrdApprovalNavigator'
import { BeadsApprovalNavigator } from './BeadsApprovalNavigator'
import { ExecutionSetupPlanNavigator } from './ExecutionSetupPlanNavigator'

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

  if (phase === 'WAITING_EXECUTION_SETUP_APPROVAL') {
    return <ExecutionSetupPlanNavigator ticketId={ticketId} />
  }

  return null
}
