import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, Eye } from 'lucide-react'
import { PhaseLogPanel } from './PhaseLogPanel'
import { PhaseArtifactsPanel } from './PhaseArtifactsPanel'
import { useProfile } from '@/hooks/useProfile'
import type { Ticket } from '@/hooks/useTickets'
import { getStatusUserLabel } from '@/lib/workflowMeta'

interface PhaseReviewViewProps {
  phase: string
  ticket: Ticket
}

export function PhaseReviewView({ phase, ticket }: PhaseReviewViewProps) {
  const label = getStatusUserLabel(phase, {
    currentBead: ticket.currentBead,
    totalBeads: ticket.totalBeads,
    errorMessage: ticket.errorMessage,
  })
  const { data: profile } = useProfile()
  const councilMemberNames = useMemo(() => {
    try { return profile?.councilMembers ? JSON.parse(profile.councilMembers) as string[] : [] }
    catch { return [] }
  }, [profile?.councilMembers])
  const councilMemberCount = councilMemberNames.length || 3

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-4 space-y-3 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Eye className="h-4 w-4 text-muted-foreground" />
            {label}
          </div>
          <Badge variant="secondary" className="text-xs gap-1">
            <CheckCircle2 className="h-3 w-3 text-green-600" />
            Completed
          </Badge>
        </div>

        <PhaseArtifactsPanel phase={phase} isCompleted={true} ticketId={ticket.id} councilMemberCount={councilMemberCount} councilMemberNames={councilMemberNames.length > 0 ? councilMemberNames : undefined} />
      </div>

      <div className="flex-1 min-h-0 px-4 pb-4 flex flex-col">
        <PhaseLogPanel phase={phase} />
      </div>
    </div>
  )
}
