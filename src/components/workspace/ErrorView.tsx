import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTicketAction } from '@/hooks/useTickets'
import { PhaseLogPanel } from './PhaseLogPanel'
import type { Ticket } from '@/hooks/useTickets'

interface ErrorViewProps {
  ticket: Ticket
}

export function ErrorView({ ticket }: ErrorViewProps) {
  const { mutate: performAction, isPending } = useTicketAction()

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-4 shrink-0">
        <Card className="border-destructive">
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Blocked — Error
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pb-3">
            <div className="bg-muted rounded-md p-3">
              <p className="text-xs font-mono text-muted-foreground">
                {ticket.errorMessage || 'Error details will be displayed here with probable cause codes and diagnostic summary.'}
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => performAction({ id: ticket.id, action: 'cancel' })}
                disabled={isPending}
                className="h-7 text-xs"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => performAction({ id: ticket.id, action: 'retry' })}
                disabled={isPending}
                className="h-7 text-xs"
              >
                🔄 Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex-1 min-h-0 px-4 pb-4 flex flex-col">
        <PhaseLogPanel phase="BLOCKED_ERROR" />
      </div>
    </div>
  )
}
