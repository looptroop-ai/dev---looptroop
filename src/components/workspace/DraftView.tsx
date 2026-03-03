import { Button } from '@/components/ui/button'
import { useTicketAction } from '@/hooks/useTickets'
import { PhaseLogPanel } from './PhaseLogPanel'
import type { Ticket } from '@/hooks/useTickets'

interface DraftViewProps {
  ticket: Ticket
}

export function DraftView({ ticket }: DraftViewProps) {
  const { mutate: performAction, isPending } = useTicketAction()

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-4 shrink-0">
        <div className="flex flex-col items-center gap-4 max-w-lg mx-auto">
          <div className="text-center">
            <h3 className="text-lg font-semibold">Ready to Start</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Click Start to begin the AI-driven interview process. This may take hours — LoopTroop optimizes for correctness.
            </p>
          </div>

          {ticket.description && (
            <div className="w-full rounded-md border border-border p-3">
              <h4 className="text-xs font-medium mb-1">Description</h4>
              <p className="text-xs text-muted-foreground whitespace-pre-wrap">{ticket.description}</p>
            </div>
          )}

          <Button
            size="lg"
            onClick={() => performAction({ id: ticket.id, action: 'start' })}
            disabled={isPending}
          >
            {isPending ? 'Starting…' : '🚀 Start Ticket'}
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 px-4 pb-4 flex flex-col">
        <PhaseLogPanel phase="DRAFT" />
      </div>
    </div>
  )
}
