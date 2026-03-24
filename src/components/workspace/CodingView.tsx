import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, CheckCircle2, Circle, Play, Eye } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { LoadingText } from '@/components/ui/LoadingText'
import { PhaseArtifactsPanel } from './PhaseArtifactsPanel'
import { CollapsiblePhaseLogSection } from './CollapsiblePhaseLogSection'
import type { Ticket } from '@/hooks/useTickets'
import { useTicketAction } from '@/hooks/useTickets'
import { cn } from '@/lib/utils'
import { getStatusUserLabel } from '@/lib/workflowMeta'

interface CodingViewProps {
  ticket: Ticket
}

interface TicketBead {
  id: string
  title: string
  description: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped'
  iteration: number
  acceptanceCriteria: string[]
  testCommands: string[]
  notes: string[]
}

function normalizeBead(input: {
  id: string
  title: string
  status: string
  iteration: number
  description?: string
  acceptanceCriteria?: string[]
  testCommands?: string[]
  notes?: string[]
}): TicketBead {
  const allowedStatuses: TicketBead['status'][] = ['pending', 'in_progress', 'completed', 'failed', 'skipped']
  const status = allowedStatuses.includes(input.status as TicketBead['status'])
    ? input.status as TicketBead['status']
    : 'pending'

  return {
    id: input.id,
    title: input.title,
    description: input.description ?? '',
    status,
    iteration: input.iteration ?? 0,
    acceptanceCriteria: input.acceptanceCriteria ?? [],
    testCommands: input.testCommands ?? [],
    notes: input.notes ?? [],
  }
}

async function fetchTicketBeads(ticketId: string): Promise<TicketBead[]> {
  const response = await fetch(`/api/tickets/${ticketId}/beads`)
  if (!response.ok) return []
  const payload = await response.json()
  return Array.isArray(payload)
    ? payload
        .filter((item): item is {
          id: string
          title: string
          status: string
          iteration: number
          description?: string
          acceptanceCriteria?: string[]
          testCommands?: string[]
          notes?: string[]
        } =>
          Boolean(item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string' && typeof (item as { title?: unknown }).title === 'string'),
        )
        .map((item) => normalizeBead(item))
    : []
}

function statusIcon(status: TicketBead['status']) {
  switch (status) {
    case 'completed':
    case 'skipped':
      return <CheckCircle2 className="h-3 w-3 text-green-600" />
    case 'in_progress':
      return <Play className="h-3 w-3 text-primary fill-primary" />
    default:
      return <Circle className="h-3 w-3 text-muted-foreground" />
  }
}

export function CodingView({ ticket }: CodingViewProps) {
  const [viewingBeadId, setViewingBeadId] = useState<string | null>(null)
  const { mutate: performAction, isPending } = useTicketAction()
  const { data: beads = [] } = useQuery({
    queryKey: ['ticket-beads', ticket.id],
    queryFn: () => fetchTicketBeads(ticket.id),
    enabled: ticket.runtime.beads === undefined && ticket.runtime.totalBeads > 0,
    initialData: (ticket.runtime.beads ?? []).map((bead) => normalizeBead(bead)),
    staleTime: 5000,
    refetchOnMount: false,
  })

  const total = ticket.runtime.totalBeads || beads.length
  const current = ticket.runtime.currentBead
  const percent = ticket.runtime.percentComplete
  const phaseLabel = getStatusUserLabel(ticket.status, {
    currentBead: current,
    totalBeads: total,
    errorMessage: ticket.errorMessage,
  })
  const isAwaitingManualVerification = ticket.status === 'WAITING_MANUAL_VERIFICATION'
  const viewedBead = useMemo(
    () => beads.find((bead) => bead.id === viewingBeadId) ?? null,
    [beads, viewingBeadId],
  )
  const isViewingOther = viewedBead !== null

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 py-2 border-b border-border flex items-center gap-3 shrink-0">
        <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
        <span className="text-sm font-medium">{phaseLabel}</span>
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary transition-all duration-500" style={{ width: `${percent}%` }} />
        </div>
        <span className="text-xs font-mono text-muted-foreground shrink-0">{current}/{Math.max(total, 0)}</span>
      </div>

      {isAwaitingManualVerification && (
        <div className="px-4 py-3 border-b border-border bg-amber-50/60 dark:bg-amber-950/20 flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="text-sm font-medium">Manual Verification</div>
            <p className="text-xs text-muted-foreground">
              Review the candidate commit on branch <code>{ticket.branchName ?? ticket.externalId}</code>.
              {ticket.runtime.candidateCommitSha ? ` Candidate: ${ticket.runtime.candidateCommitSha}.` : ''}
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => performAction({ id: ticket.id, action: 'verify' })}
            disabled={isPending}
            className="shrink-0"
          >
            {isPending ? <LoadingText text="Verifying" /> : 'Mark Verified'}
          </Button>
        </div>
      )}

      {isViewingOther && viewedBead && (
        <div className="px-4 py-1.5 border-b border-border bg-accent/50 flex items-center gap-2 shrink-0">
          <Eye className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            Viewing <span className="font-medium text-foreground">{viewedBead.title}</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setViewingBeadId(null)}
            className="text-xs h-6 px-2 mx-auto"
          >
            Back to live
          </Button>
        </div>
      )}

      {beads.length > 0 && (
        <div className="px-4 py-2 border-b border-border shrink-0 overflow-x-auto">
          <div className="flex gap-1.5">
            {beads.map((bead, index) => (
              <button
                key={bead.id}
                onClick={() => setViewingBeadId(viewingBeadId === bead.id ? null : bead.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs whitespace-nowrap transition-colors',
                  bead.status === 'in_progress' && 'border-primary bg-primary/10 font-medium',
                  (bead.status === 'completed' || bead.status === 'skipped') && 'border-green-600/30 bg-green-50 dark:bg-green-900/20',
                  bead.status === 'failed' && 'border-red-600/30 bg-red-50 dark:bg-red-900/20',
                  bead.status === 'pending' && 'border-border opacity-70',
                  viewingBeadId === bead.id && 'ring-2 ring-primary',
                )}
                title={bead.title}
              >
                {statusIcon(bead.status)}
                <span>{bead.title || `Bead ${index + 1}`}</span>
                {bead.iteration > 0 && (
                  <Badge variant="outline" className="text-[10px] h-4 px-1">
                    {bead.iteration}x
                  </Badge>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="px-3 py-1.5 border-b border-border shrink-0">
        <PhaseArtifactsPanel phase={ticket.status} isCompleted={false} ticketId={ticket.id} />
      </div>

      <div className="flex-1 min-h-0 px-2 py-2 flex flex-col">
        {viewedBead ? (
          <div className="flex-1 min-h-0 flex flex-col rounded-md border border-border bg-muted/30 p-3 overflow-auto">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {viewedBead.title}
            </div>
            <p className="mt-2 text-sm whitespace-pre-wrap">{viewedBead.description || 'No bead description available.'}</p>
            {viewedBead.acceptanceCriteria.length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-medium text-muted-foreground mb-1">Acceptance Criteria</div>
                <ul className="text-xs space-y-1">
                  {viewedBead.acceptanceCriteria.map((criterion) => (
                    <li key={criterion}>- {criterion}</li>
                  ))}
                </ul>
              </div>
            )}
            {viewedBead.testCommands.length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-medium text-muted-foreground mb-1">Test Commands</div>
                <div className="space-y-1">
                  {viewedBead.testCommands.map((command) => (
                    <code key={command} className="block text-xs rounded bg-background px-2 py-1">{command}</code>
                  ))}
                </div>
              </div>
            )}
            {viewedBead.notes.length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-medium text-muted-foreground mb-1">Notes</div>
                <ul className="text-xs space-y-1">
                  {viewedBead.notes.map((note) => (
                    <li key={note}>- {note}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <CollapsiblePhaseLogSection phase={ticket.status} ticket={ticket} />
        )}
      </div>
    </div>
  )
}
