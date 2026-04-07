import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, CheckCircle2, Circle, Play, Eye, FileCode2, List } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { LoadingText } from '@/components/ui/LoadingText'
import { PhaseArtifactsPanel } from './PhaseArtifactsPanel'
import { CollapsiblePhaseLogSection } from './CollapsiblePhaseLogSection'
import { BeadDiffViewer } from './BeadDiffViewer'
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
  tests: string[]
  testCommands: string[]
  contextGuidance: { patterns: string[]; anti_patterns: string[] }
  notes: string[]
}

function normalizeBead(input: {
  id: string
  title: string
  status: string
  iteration: number
  description?: string
  acceptanceCriteria?: string[]
  tests?: string[]
  testCommands?: string[]
  contextGuidance?: { patterns?: string[]; anti_patterns?: string[] }
  notes?: string[]
}): TicketBead {
  const STATUS_MAP: Record<string, TicketBead['status']> = {
    done: 'completed',
    error: 'failed',
  }
  const allowedStatuses: TicketBead['status'][] = ['pending', 'in_progress', 'completed', 'failed', 'skipped']
  const mappedStatus = STATUS_MAP[input.status] ?? input.status
  const status = allowedStatuses.includes(mappedStatus as TicketBead['status'])
    ? mappedStatus as TicketBead['status']
    : 'pending'

  const cg = input.contextGuidance
  const contextGuidance = cg && typeof cg === 'object' && !Array.isArray(cg)
    ? { patterns: Array.isArray(cg.patterns) ? cg.patterns : [], anti_patterns: Array.isArray(cg.anti_patterns) ? cg.anti_patterns : [] }
    : { patterns: [], anti_patterns: [] }

  return {
    id: input.id,
    title: input.title,
    description: input.description ?? '',
    status,
    iteration: input.iteration ?? 0,
    acceptanceCriteria: input.acceptanceCriteria ?? [],
    tests: input.tests ?? [],
    testCommands: input.testCommands ?? [],
    contextGuidance,
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
          tests?: string[]
          testCommands?: string[]
          contextGuidance?: { patterns?: string[]; anti_patterns?: string[] }
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

const COMPACT_THRESHOLD = 15

function BeadProgressSummary({ beads }: { beads: TicketBead[] }) {
  const done = beads.filter((b) => b.status === 'completed' || b.status === 'skipped').length
  const active = beads.find((b) => b.status === 'in_progress')
  const failed = beads.filter((b) => b.status === 'failed').length
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{done}/{beads.length}</span>
      <span>done</span>
      {active && (
        <>
          <span>•</span>
          <span className="text-primary font-medium truncate max-w-[200px]">{active.title}</span>
        </>
      )}
      {failed > 0 && (
        <>
          <span>•</span>
          <span className="text-red-600 dark:text-red-400">{failed} failed</span>
        </>
      )}
    </div>
  )
}

function BeadGrid({
  beads,
  viewingBeadId,
  onSelect,
}: {
  beads: TicketBead[]
  viewingBeadId: string | null
  onSelect: (id: string | null) => void
}) {
  const compact = beads.length > COMPACT_THRESHOLD

  if (compact) {
    return (
      <div className="flex flex-col gap-1.5">
        <BeadProgressSummary beads={beads} />
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(28px, 1fr))` }}
        >
          {beads.map((bead, index) => (
            <button
              key={bead.id}
              onClick={() => onSelect(viewingBeadId === bead.id ? null : bead.id)}
              title={`#${index + 1}: ${bead.title}${bead.iteration > 0 ? ` (${bead.iteration}x)` : ''}`}
              className={cn(
                'h-7 w-full rounded text-[10px] font-mono font-medium transition-colors',
                bead.status === 'completed' || bead.status === 'skipped'
                  ? 'bg-green-500/20 text-green-700 dark:text-green-400 border border-green-600/20'
                  : bead.status === 'in_progress'
                    ? 'bg-primary/20 text-primary border border-primary/40 animate-pulse'
                    : bead.status === 'failed'
                      ? 'bg-red-500/20 text-red-700 dark:text-red-400 border border-red-600/20'
                      : 'bg-muted text-muted-foreground border border-border opacity-60',
                viewingBeadId === bead.id && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
              )}
            >
              {index + 1}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <BeadProgressSummary beads={beads} />
      <div className="flex flex-wrap gap-1.5">
        {beads.map((bead, index) => (
          <button
            key={bead.id}
            onClick={() => onSelect(viewingBeadId === bead.id ? null : bead.id)}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs whitespace-nowrap transition-colors',
              bead.status === 'in_progress' && 'border-primary bg-primary/10 font-medium animate-pulse',
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
  )
}

export function CodingView({ ticket }: CodingViewProps) {
  const [viewingBeadId, setViewingBeadId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<'details' | 'changes'>('details')
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
        <div className="px-4 py-2 border-b border-border shrink-0">
          <BeadGrid beads={beads} viewingBeadId={viewingBeadId} onSelect={setViewingBeadId} />
        </div>
      )}

      <div className="px-3 py-1.5 border-b border-border shrink-0">
        <PhaseArtifactsPanel phase={ticket.status} isCompleted={false} ticketId={ticket.id} />
      </div>

      <div className="flex-1 min-h-0 px-2 py-2 flex flex-col">
        {viewedBead ? (
          <div className="flex-1 min-h-0 flex flex-col rounded-md border border-border bg-muted/30 overflow-hidden">
            <div className="flex items-center border-b border-border shrink-0">
              <button
                onClick={() => setDetailTab('details')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors border-b-2',
                  detailTab === 'details'
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <List className="h-3 w-3" />
                Details
              </button>
              <button
                onClick={() => setDetailTab('changes')}
                disabled={viewedBead.status !== 'completed' && viewedBead.status !== 'skipped'}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors border-b-2',
                  detailTab === 'changes'
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                  (viewedBead.status !== 'completed' && viewedBead.status !== 'skipped') && 'opacity-40 cursor-not-allowed',
                )}
              >
                <FileCode2 className="h-3 w-3" />
                Changes
              </button>
            </div>

            {detailTab === 'changes' && (viewedBead.status === 'completed' || viewedBead.status === 'skipped') ? (
              <div className="flex-1 min-h-0 overflow-auto">
                <BeadDiffViewer ticketId={ticket.id} beadId={viewedBead.id} />
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-auto p-3">
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {viewedBead.title}
                </div>
                <p className="mt-2 text-sm whitespace-pre-wrap">{viewedBead.description || 'No bead description available.'}</p>
                {(viewedBead.contextGuidance.patterns.length > 0 || viewedBead.contextGuidance.anti_patterns.length > 0) && (
                  <div className="mt-3 border-l-2 border-violet-300 dark:border-violet-700 pl-2">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-violet-600 dark:text-violet-400 mb-1">Context Guidance</div>
                    {viewedBead.contextGuidance.patterns.length > 0 && (
                      <div className="mt-1">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Patterns</div>
                        <ul className="text-xs space-y-0.5 pl-3">
                          {viewedBead.contextGuidance.patterns.map((pattern) => (
                            <li key={pattern}>- {pattern}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {viewedBead.contextGuidance.anti_patterns.length > 0 && (
                      <div className="mt-1">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Anti-patterns</div>
                        <ul className="text-xs space-y-0.5 pl-3">
                          {viewedBead.contextGuidance.anti_patterns.map((ap) => (
                            <li key={ap}>- {ap}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                {viewedBead.acceptanceCriteria.length > 0 && (
                  <div className="mt-3 border-l-2 border-green-300 dark:border-green-700 pl-2">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-green-600 dark:text-green-400 mb-1">Acceptance Criteria</div>
                    <ul className="text-xs space-y-1">
                      {viewedBead.acceptanceCriteria.map((criterion) => (
                        <li key={criterion}>- {criterion}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {(viewedBead.tests.length > 0 || viewedBead.testCommands.length > 0) && (
                  <div className="mt-3 border-l-2 border-amber-300 dark:border-amber-700 pl-2 space-y-1.5">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400">Tests</div>
                    {viewedBead.tests.length > 0 && (
                      <ul className="text-xs space-y-1">
                        {viewedBead.tests.map((test) => (
                          <li key={test}>- {test}</li>
                        ))}
                      </ul>
                    )}
                    {viewedBead.testCommands.length > 0 && (
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Test Commands</div>
                        <div className="space-y-1">
                          {viewedBead.testCommands.map((command) => (
                            <code key={command} className="block text-xs rounded bg-background border border-border px-2 py-1 font-mono">{command}</code>
                          ))}
                        </div>
                      </div>
                    )}
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
            )}
          </div>
        ) : (
          <CollapsiblePhaseLogSection phase={ticket.status} ticket={ticket} />
        )}
      </div>
    </div>
  )
}
