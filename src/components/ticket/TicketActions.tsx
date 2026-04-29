import { X, Ban, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Ticket } from '@/hooks/useTickets'
import { TerminalTicketDelete } from '@/components/workspace/TerminalTicketDelete'

export interface TicketActionsProps {
  ticket: Ticket
  canCancel: boolean
  canDelete: boolean
  isPending: boolean
  cancelLabel?: string
  onShowDetails: () => void
  onCancelConfirm: () => void
  onClose: () => void
}

export function TicketActions({ ticket, canCancel, canDelete, isPending, cancelLabel = 'Cancel…', onShowDetails, onCancelConfirm, onClose }: TicketActionsProps) {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {ticket.status !== 'DRAFT' && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onShowDetails}
          className="gap-1 text-muted-foreground h-8 px-2"
          title="Ticket details"
        >
          <Info className="h-4 w-4" />
          <span className="text-xs">Details</span>
        </Button>
      )}
      {canDelete && (
        <TerminalTicketDelete
          ticket={ticket}
          statusLabel={ticket.status === 'COMPLETED' ? 'completed' : 'canceled'}
          buttonLabel="Delete"
          buttonTitle="Delete this ticket permanently"
          buttonVariant="ghost"
          buttonSize="sm"
          buttonClassName="gap-1 text-destructive hover:text-destructive hover:bg-destructive/10 h-8 px-2"
        />
      )}
      {canCancel && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancelConfirm}
          disabled={isPending}
          className="gap-1 text-destructive hover:text-destructive hover:bg-destructive/10 h-8 px-2"
          title="Cancel this ticket"
        >
          <Ban className="h-3.5 w-3.5" />
          <span className="text-xs">{cancelLabel}</span>
        </Button>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close dashboard"
        title="Close ticket view (Esc)"
        className="flex items-center justify-center h-8 w-8 rounded-md border border-border bg-muted text-foreground hover:bg-destructive hover:text-white hover:border-destructive transition-colors"
      >
        <X className="h-4 w-4" strokeWidth={2.5} />
      </button>
    </div>
  )
}
