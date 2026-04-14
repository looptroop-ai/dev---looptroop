import { AlertTriangle, Clock3, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTicketAction } from '@/hooks/useTickets'
import { useLogs } from '@/context/useLogContext'
import type { LogEntry } from '@/context/LogContext'
import { CollapsiblePhaseLogSection } from './CollapsiblePhaseLogSection'
import type { Ticket } from '@/hooks/useTickets'
import { formatTimestamp, formatTimestampString } from './logFormat'
import {
  formatErrorOccurrenceLabel,
  formatErrorOccurrenceStatus,
  getActiveErrorOccurrence,
  getTicketErrorOccurrences,
  type TicketErrorOccurrence,
} from '@/lib/errorOccurrences'
import { getStatusUserLabel } from '@/lib/workflowMeta'

interface ErrorViewProps {
  ticket: Ticket
  occurrence?: TicketErrorOccurrence | null
  readOnly?: boolean
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

function readTimestamp(value?: string | null): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function filterLogsWithinWindow(
  logs: LogEntry[],
  options: {
    startTime?: number | null
    endTime?: number | null
    includeStart?: boolean
    includeEnd?: boolean
  },
) {
  const {
    startTime = null,
    endTime = null,
    includeStart = true,
    includeEnd = true,
  } = options

  return logs.filter((entry) => {
    const timestamp = readTimestamp(entry.timestamp)
    if (timestamp === null) return true
    if (startTime !== null) {
      if (includeStart ? timestamp < startTime : timestamp <= startTime) return false
    }
    if (endTime !== null) {
      if (includeEnd ? timestamp > endTime : timestamp >= endTime) return false
    }
    return true
  })
}

export function ErrorView({ ticket, occurrence, readOnly = false }: ErrorViewProps) {
  const { mutate: performAction, isPending } = useTicketAction()
  const logCtx = useLogs()
  const failedBead = ticket.runtime.lastFailedBeadId
    ? ticket.runtime.beads?.find((bead) => bead.id === ticket.runtime.lastFailedBeadId) ?? null
    : null
  const failedBeadNotes = typeof failedBead?.notes === 'string'
    ? failedBead.notes
        .split(/\n\s*---\s*\n/g)
        .map((entry) => entry.trim())
        .filter(Boolean)
    : []
  const visibleOccurrence = occurrence ?? getActiveErrorOccurrence(ticket)
  const errorLogs = (() => {
    if (!visibleOccurrence) {
      return logCtx?.getLogsForPhase('BLOCKED_ERROR') ?? []
    }

    const allOccurrences = getTicketErrorOccurrences(ticket)
    const occurrenceIndex = allOccurrences.findIndex((candidate) => candidate.id === visibleOccurrence.id)
    const previousOccurrence = occurrenceIndex > 0 ? allOccurrences[occurrenceIndex - 1] : null
    const previousResolutionTime = readTimestamp(previousOccurrence?.resolvedAt ?? previousOccurrence?.occurredAt ?? null)
    const blockedAt = readTimestamp(visibleOccurrence.occurredAt)
    const resolvedAt = readTimestamp(visibleOccurrence.resolvedAt)
    const blockedLogs = logCtx?.getLogsForPhase('BLOCKED_ERROR') ?? []
    const phaseLogs = logCtx?.getLogsForPhase(visibleOccurrence.blockedFromStatus) ?? []
    const merged = mergeErrorLogs(
      filterLogsWithinWindow(phaseLogs, {
        startTime: previousResolutionTime,
        endTime: blockedAt,
        includeStart: false,
      }),
      filterLogsWithinWindow(blockedLogs, {
        startTime: blockedAt,
        endTime: resolvedAt,
      }),
    )
    return merged
  })()

  const isLiveError = !readOnly
    && ticket.status === 'BLOCKED_ERROR'
    && Boolean(visibleOccurrence)
    && visibleOccurrence?.resolvedAt === null

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="min-h-0 shrink overflow-y-auto p-4">
        <Card className={isLiveError ? 'border-destructive' : 'border-amber-300 dark:border-amber-800'}>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {isLiveError ? 'Blocked — Error' : 'Error Review'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pb-3">
            <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                {visibleOccurrence ? (
                  <>
                    <Badge variant={isLiveError ? 'destructive' : 'secondary'} className="text-[10px]">
                      {formatErrorOccurrenceStatus(visibleOccurrence)}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {formatErrorOccurrenceLabel(visibleOccurrence, visibleOccurrence.occurrenceNumber)}
                    </Badge>
                  </>
                ) : (
                  <Badge variant="destructive" className="text-[10px]">Active</Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1" title={visibleOccurrence?.occurredAt ? formatTimestampString(visibleOccurrence.occurredAt) : undefined}>
                  <Clock3 className="h-3.5 w-3.5" />
                  {visibleOccurrence ? `Blocked from ${getStatusUserLabel(visibleOccurrence.blockedFromStatus)}` : 'Blocked error'}
                </span>
                {visibleOccurrence?.resolvedAt && (
                  <span className="flex items-center gap-1">
                    <RotateCcw className="h-3.5 w-3.5" />
                    Resolved {formatTimestamp(visibleOccurrence.resolvedAt)}
                  </span>
                )}
              </div>
              <p className="text-xs font-mono text-muted-foreground">
                {visibleOccurrence?.errorMessage || ticket.errorMessage || 'An error occurred but no details were captured. Try retrying or check the server logs.'}
              </p>
              {visibleOccurrence?.errorCodes && visibleOccurrence.errorCodes.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {visibleOccurrence.errorCodes.map((code) => (
                    <Badge key={code} variant="outline" className="text-[10px]">
                      {code}
                    </Badge>
                  ))}
                </div>
              )}
              {(failedBead || ticket.runtime.activeBeadIteration) && (
                <div className="rounded border border-border bg-background/70 px-2 py-1.5 text-[11px] text-muted-foreground space-y-1">
                  {failedBead && (
                    <div>
                      Failed bead <span className="font-mono text-foreground">{failedBead.id}</span>
                      {ticket.runtime.activeBeadIteration ? ` on iteration ${ticket.runtime.activeBeadIteration}` : ''}
                    </div>
                  )}
                  <div>
                    Retryable: {ticket.availableActions.includes('retry') ? 'yes' : 'no'}
                  </div>
                  {failedBeadNotes.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] uppercase tracking-wider">Preserved notes</div>
                      {failedBeadNotes.map((note) => (
                        <p key={note} className="font-mono text-[10px] whitespace-pre-wrap text-muted-foreground/90">
                          {note}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            {isLiveError && (
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
            )}
          </CardContent>
        </Card>
      </div>

      <CollapsiblePhaseLogSection
        phase={visibleOccurrence?.blockedFromStatus ?? 'BLOCKED_ERROR'}
        logs={errorLogs}
        ticket={ticket}
        defaultExpanded={false}
        className="px-4 pb-4"
      />
    </div>
  )
}
