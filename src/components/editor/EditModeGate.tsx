import { Badge } from '@/components/ui/badge'
import type { Ticket } from '@/hooks/useTickets'
import { getWorkflowPhaseMeta } from '@shared/workflowMeta'

interface EditModeGateProps {
  ticket: Ticket
  artifactType: 'interview' | 'prd' | 'beads'
  children: React.ReactNode
  editView: React.ReactNode
}

export function EditModeGate({ ticket, children, editView }: EditModeGateProps) {
  const isEditable = getWorkflowPhaseMeta(ticket.status)?.editable ?? false

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
