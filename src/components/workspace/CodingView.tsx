import { useState } from 'react'
import { Loader2, CheckCircle2, Circle, Play, Eye } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { LoadingText } from '@/components/ui/LoadingText'
import { PhaseLogPanel } from './PhaseLogPanel'
import { PhaseArtifactsPanel } from './PhaseArtifactsPanel'
import type { Ticket } from '@/hooks/useTickets'
import { useTicketAction } from '@/hooks/useTickets'
import { cn } from '@/lib/utils'

interface CodingViewProps {
  ticket: Ticket
}

interface BeadInfo {
  index: number
  label: string
  status: 'completed' | 'active' | 'pending'
  iterations?: number
}

function generateBeads(total: number, current: number): BeadInfo[] {
  const beads: BeadInfo[] = []
  for (let i = 1; i <= total; i++) {
    beads.push({
      index: i,
      label: `Bead ${i}`,
      status: i < current ? 'completed' : i === current ? 'active' : 'pending',
      iterations: i < current ? Math.floor(Math.random() * 3) + 1 : i === current ? 1 : undefined,
    })
  }
  return beads
}

export function CodingView({ ticket }: CodingViewProps) {
  const [viewingBead, setViewingBead] = useState<number | null>(null)
  const { mutate: performAction, isPending } = useTicketAction()
  const total = ticket.totalBeads ?? 5
  const current = ticket.currentBead ?? 1
  const percent = ticket.percentComplete ?? (total > 0 ? Math.round((current / total) * 100) : 0)
  const beads = generateBeads(total, current)
  const isAwaitingManualVerification = ticket.status === 'WAITING_MANUAL_VERIFICATION'

  const isViewingOther = viewingBead !== null && viewingBead !== current
  const viewedBead = viewingBead !== null ? beads.find(b => b.index === viewingBead) : null

  const phaseLabel = ticket.status === 'CODING' ? 'Executing Beads' :
    ticket.status === 'RUNNING_FINAL_TEST' ? 'Running Final Tests' :
      ticket.status === 'INTEGRATING_CHANGES' ? 'Integrating Changes' :
        ticket.status === 'CLEANING_ENV' ? 'Cleaning Environment' :
          ticket.status === 'PRE_FLIGHT_CHECK' ? 'Pre-flight Check' :
            ticket.status === 'WAITING_MANUAL_VERIFICATION' ? 'Manual Verification' : 'Processing'

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Compact header with progress */}
      <div className="px-4 py-2 border-b border-border flex items-center gap-3 shrink-0">
        <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
        <span className="text-sm font-medium">{phaseLabel}</span>
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary transition-all duration-500" style={{ width: `${percent}%` }} />
        </div>
        <span className="text-xs font-mono text-muted-foreground shrink-0">{current}/{total}</span>
      </div>

      {isAwaitingManualVerification && (
        <div className="px-4 py-3 border-b border-border bg-amber-50/60 dark:bg-amber-950/20 flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="text-sm font-medium">Manual Verification</div>
            <p className="text-xs text-muted-foreground">
              Review the generated changes and mark the ticket verified to finish cleanup.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => performAction({ id: ticket.id, action: 'verify' })}
            disabled={isPending}
            className="shrink-0"
          >
            {isPending ? <LoadingText text="Verifying" /> : '✅ Mark Verified'}
          </Button>
        </div>
      )}

      {/* Viewing other bead banner */}
      {isViewingOther && viewedBead && (
        <div className="px-4 py-1.5 border-b border-border bg-accent/50 flex items-center gap-2 shrink-0">
          <Eye className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            Viewing <span className="font-medium text-foreground">{viewedBead.label}</span>
            {viewedBead.status === 'completed' ? ' (completed — read-only)' : ' (planned — read-only)'}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setViewingBead(null)}
            className="text-xs h-6 px-2 mx-auto"
          >
            Back to live
          </Button>
        </div>
      )}

      {/* Bead list — scrollable strip with clickable beads */}
      {ticket.status === 'CODING' && (
        <div className="px-4 py-2 border-b border-border shrink-0 overflow-x-auto">
          <div className="flex gap-1.5">
            {beads.map(bead => (
              <button
                key={bead.index}
                onClick={() => setViewingBead(bead.index === current ? null : bead.index)}
                title={
                  bead.status === 'active' ? `${bead.label} — currently executing (live view)` :
                    bead.status === 'completed' ? `${bead.label} — completed, click to view logs` :
                      `${bead.label} — pending, click to view spec`
                }
                className={cn(
                  'flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs whitespace-nowrap transition-colors',
                  bead.status === 'active' && 'border-primary bg-primary/10 font-medium',
                  bead.status === 'completed' && 'border-green-600/30 bg-green-50 dark:bg-green-900/20 cursor-pointer hover:bg-green-100 dark:hover:bg-green-900/40',
                  bead.status === 'pending' && 'border-border opacity-50 cursor-pointer hover:opacity-75',
                  viewingBead === bead.index && 'ring-2 ring-primary',
                )}
              >
                {bead.status === 'completed' && <CheckCircle2 className="h-3 w-3 text-green-600" />}
                {bead.status === 'active' && <Play className="h-3 w-3 text-primary fill-primary" />}
                {bead.status === 'pending' && <Circle className="h-3 w-3 text-muted-foreground" />}
                <span>{bead.label}</span>
                {bead.iterations !== undefined && (
                  <Badge variant="outline" className="text-[10px] h-4 px-1">
                    {bead.status === 'active' ? `iter ${bead.iterations}` : `${bead.iterations}x`}
                  </Badge>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Artifacts strip */}
      <div className="px-3 py-1.5 border-b border-border shrink-0">
        <PhaseArtifactsPanel phase={ticket.status} isCompleted={false} ticketId={ticket.id} />
      </div>

      {/* Log / bead detail area */}
      <div className="flex-1 min-h-0 px-2 py-2 flex flex-col">
        {isViewingOther && viewedBead ? (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="px-1 py-1.5 flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {viewedBead.label} — {viewedBead.status === 'completed' ? 'Completed' : 'Planned'}
              </span>
            </div>
            <div className="flex-1 font-mono text-xs bg-muted rounded-md p-3 min-h-[100px] overflow-auto">
              {viewedBead.status === 'completed' ? (
                <div className="space-y-1">
                  <div className="text-green-600">[BEAD] {viewedBead.label} completed in {viewedBead.iterations}x iteration(s)</div>
                  <div className="text-muted-foreground/50 italic">Execution logs for this bead will stream here once the backend is connected.</div>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="text-purple-500">[BEAD] {viewedBead.label} — pending execution</div>
                  <div className="text-muted-foreground/50 italic">Bead specification and execution plan will load once the backend is connected.</div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <PhaseLogPanel phase={ticket.status} ticket={ticket} />
        )}
      </div>
    </div>
  )
}
