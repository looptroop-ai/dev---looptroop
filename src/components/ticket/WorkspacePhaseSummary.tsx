import { useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getStatusUserLabel } from '@/lib/workflowMeta'
import type { Ticket } from '@/hooks/useTickets'
import { getWorkflowPhaseMeta } from '@shared/workflowMeta'

interface WorkspacePhaseSummaryProps {
  phase: string
  ticket: Ticket
  errorMessage?: string | null
}

function DetailsList({ items }: { items: readonly string[] }) {
  return (
    <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

export function WorkspacePhaseSummary({ phase, ticket, errorMessage }: WorkspacePhaseSummaryProps) {
  const [open, setOpen] = useState(false)
  const phaseMeta = getWorkflowPhaseMeta(phase)

  const phaseLabel = useMemo(() => getStatusUserLabel(phase, {
    currentBead: ticket.runtime.currentBead,
    totalBeads: ticket.runtime.totalBeads,
    errorMessage,
  }), [errorMessage, phase, ticket.runtime.currentBead, ticket.runtime.totalBeads])

  if (!phaseMeta) return null

  return (
    <>
      <div className="shrink-0 border-b border-border bg-muted/20 px-4 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Status
        </div>
        <div className="mt-1 text-sm font-medium text-foreground">{phaseLabel}</div>
        <p className="mt-1 text-sm text-muted-foreground">
          {phaseMeta.description}
          {' '}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="underline underline-offset-2 transition-colors hover:text-foreground"
                aria-label={`Show detailed explanation for ${phaseLabel}`}
              >
                (details)
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">See a full breakdown of what happens in this status.</TooltipContent>
          </Tooltip>
        </p>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{phaseLabel}</DialogTitle>
            <DialogDescription>{phaseMeta.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-5 overflow-y-auto pr-2">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Overview</h3>
              <p className="text-sm leading-6 text-muted-foreground">{phaseMeta.details.overview}</p>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Step by Step</h3>
              <DetailsList items={phaseMeta.details.steps} />
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Outputs</h3>
              <DetailsList items={phaseMeta.details.outputs} />
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Transitions</h3>
              <DetailsList items={phaseMeta.details.transitions} />
            </section>

            {phaseMeta.details.notes && phaseMeta.details.notes.length > 0 ? (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">Notes</h3>
                <DetailsList items={phaseMeta.details.notes} />
              </section>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
