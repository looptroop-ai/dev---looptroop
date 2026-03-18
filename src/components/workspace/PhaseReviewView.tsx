import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, Eye, CalendarDays, Loader2 } from 'lucide-react'
import { PhaseLogPanel } from './PhaseLogPanel'
import { PhaseArtifactsPanel } from './PhaseArtifactsPanel'
import { useTicketArtifacts } from '@/hooks/useTicketArtifacts'

import type { Ticket } from '@/hooks/useTickets'
import { getStatusUserLabel } from '@/lib/workflowMeta'

const PRIORITY_LABELS: Record<number, string> = { 1: 'Very High', 2: 'High', 3: 'Normal', 4: 'Low', 5: 'Very Low' }

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
  const councilMemberNames = useMemo(
    () => ticket.lockedCouncilMembers.filter((memberId) => memberId.trim().length > 0),
    [ticket.lockedCouncilMembers],
  )
  const councilMemberCount = councilMemberNames.length || 3
  const isDraft = phase === 'DRAFT'
  const { artifacts: preloadedArtifacts, isLoading: isLoadingArtifacts } = useTicketArtifacts(ticket.id)

  if (isLoadingArtifacts) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Loading phase data…</p>
        </div>
      </div>
    )
  }

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

        {!isDraft && (
          <PhaseArtifactsPanel phase={phase} isCompleted={true} ticketId={ticket.id} councilMemberCount={councilMemberCount} councilMemberNames={councilMemberNames.length > 0 ? councilMemberNames : undefined} preloadedArtifacts={preloadedArtifacts} />
        )}
      </div>

      {isDraft ? (
        <div className="flex-1 min-h-0 px-4 pb-4 overflow-auto">
          <div className="max-w-lg mx-auto space-y-4">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <Badge variant="outline">
                P{ticket.priority} — {PRIORITY_LABELS[ticket.priority] ?? 'Normal'}
              </Badge>
              <span className="flex items-center gap-1 text-muted-foreground" title={new Date(ticket.createdAt).toLocaleString()}>
                <CalendarDays className="h-3.5 w-3.5" />
                Created {new Date(ticket.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
              </span>
            </div>
            {ticket.description && (
              <div className="rounded-md border border-border p-3">
                <h4 className="text-xs font-medium mb-1">Description</h4>
                <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{ticket.description}</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 px-4 pb-4 flex flex-col">
          <PhaseLogPanel phase={phase} />
        </div>
      )}
    </div>
  )
}
