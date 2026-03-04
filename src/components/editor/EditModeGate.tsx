import { Badge } from '@/components/ui/badge'
import type { Ticket } from '@/hooks/useTickets'

const PRE_EXECUTION_STATUSES = [
  'DRAFT', 'COUNCIL_DELIBERATING', 'COUNCIL_VOTING_INTERVIEW',
  'COMPILING_INTERVIEW', 'WAITING_INTERVIEW_ANSWERS',
  'VERIFYING_INTERVIEW_COVERAGE', 'WAITING_INTERVIEW_APPROVAL',
  'DRAFTING_PRD', 'COUNCIL_VOTING_PRD', 'REFINING_PRD',
  'VERIFYING_PRD_COVERAGE', 'WAITING_PRD_APPROVAL',
  'DRAFTING_BEADS', 'COUNCIL_VOTING_BEADS', 'REFINING_BEADS',
  'VERIFYING_BEADS_COVERAGE', 'WAITING_BEADS_APPROVAL',
  'PRE_FLIGHT_CHECK',
]

interface EditModeGateProps {
  ticket: Ticket
  artifactType: 'interview' | 'prd' | 'beads'
  children: React.ReactNode
  editView: React.ReactNode
}

export function EditModeGate({ ticket, children, editView }: EditModeGateProps) {
  const isEditable = PRE_EXECUTION_STATUSES.includes(ticket.status)

  if (!isEditable) {
    return (
      <div className="relative">
        <Badge variant="secondary" className="absolute top-2 right-2 text-xs z-10">
          Read Only
        </Badge>
        {children}
      </div>
    )
  }

  return <>{editView}</>
}
