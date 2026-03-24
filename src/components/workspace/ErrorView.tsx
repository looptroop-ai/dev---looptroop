import { AlertTriangle } from 'lucide-react'
import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTicketAction } from '@/hooks/useTickets'
import { useLogs } from '@/context/useLogContext'
import type { LogEntry } from '@/context/LogContext'
import { CollapsiblePhaseLogSection } from './CollapsiblePhaseLogSection'
import type { Ticket } from '@/hooks/useTickets'

interface ErrorViewProps {
  ticket: Ticket
}

function getBlockingPhase(ticket: Ticket): string | null {
  if (ticket.status !== 'BLOCKED_ERROR') return null
  return ticket.previousStatus && ticket.previousStatus !== 'BLOCKED_ERROR'
    ? ticket.previousStatus
    : null
}

function mergeErrorLogs(previousPhaseLogs: LogEntry[], blockedLogs: LogEntry[]): LogEntry[] {
  const seen = new Set<string>()
  const merged = [...previousPhaseLogs, ...blockedLogs].filter((entry, index) => {
    const key = entry.timestamp
      ? `${entry.timestamp}|${entry.status}|${entry.source}|${entry.line}`
      : `no-ts:${index}|${entry.status}|${entry.source}|${entry.line}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return merged.sort((a, b) => {
    const aTime = a.timestamp ? Date.parse(a.timestamp) : Number.NaN
    const bTime = b.timestamp ? Date.parse(b.timestamp) : Number.NaN
    if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0
    if (Number.isNaN(aTime)) return 1
    if (Number.isNaN(bTime)) return -1
    return aTime - bTime
  })
}

export function ErrorView({ ticket }: ErrorViewProps) {
  const { mutate: performAction, isPending } = useTicketAction()
  const logCtx = useLogs()
  const blockingPhase = getBlockingPhase(ticket)
  const errorLogs = useMemo(() => {
    const blockedLogs = logCtx?.getLogsForPhase('BLOCKED_ERROR') ?? []
    if (!blockingPhase) return blockedLogs
    return mergeErrorLogs(logCtx?.getLogsForPhase(blockingPhase) ?? [], blockedLogs)
  }, [blockingPhase, logCtx])

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
                {ticket.errorMessage || 'An error occurred but no details were captured. Try retrying or check the server logs.'}
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

      <CollapsiblePhaseLogSection phase="BLOCKED_ERROR" logs={errorLogs} ticket={ticket} className="px-4 pb-4" />
    </div>
  )
}
