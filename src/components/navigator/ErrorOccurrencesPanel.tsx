import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { Ticket } from '@/hooks/useTickets'
import { formatTimestamp } from '@/components/workspace/logFormat'
import { StatusIndicator } from './StatusIndicator'
import {
  formatErrorOccurrenceLabel,
  formatErrorOccurrenceStatus,
  getActiveErrorOccurrence,
  getTicketErrorOccurrences,
  type TicketErrorOccurrence,
} from '@/lib/errorOccurrences'

interface ErrorOccurrencesPanelProps {
  ticket: Ticket
  selectedErrorOccurrenceId?: string | null
  onSelectErrorOccurrence: (occurrenceId: string | null) => void
}

function getOccurrenceSubtitle(occurrence: TicketErrorOccurrence) {
  const startedAt = formatTimestamp(occurrence.occurredAt)
  if (occurrence.resolvedAt) {
    return `Blocked ${startedAt} · Resolved ${formatTimestamp(occurrence.resolvedAt)}`
  }
  return `Blocked ${startedAt}`
}

function ErrorOccurrenceRow({
  occurrence,
  isSelected,
  onSelect,
}: {
  occurrence: TicketErrorOccurrence
  isSelected: boolean
  onSelect: () => void
}) {
  const summary = getOccurrenceSubtitle(occurrence)
  const status = formatErrorOccurrenceStatus(occurrence)

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-md border px-2.5 py-2 text-left transition-colors',
        isSelected
          ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
          : 'border-border hover:bg-accent/60',
      )}
    >
      <div className="flex items-start gap-2">
        <StatusIndicator status={occurrence.resolvedAt ? 'completed' : 'error'} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate text-xs font-semibold">
              {formatErrorOccurrenceLabel(occurrence, occurrence.occurrenceNumber)}
            </span>
            <Badge variant="outline" className="text-[10px] shrink-0">
              {status}
            </Badge>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground leading-tight">
            {summary}
          </p>
          {occurrence.errorMessage && (
            <p className="mt-1 text-[11px] font-mono text-muted-foreground/90 line-clamp-2 [overflow-wrap:anywhere]">
              {occurrence.errorMessage}
            </p>
          )}
        </div>
      </div>
    </button>
  )
}

export function ErrorOccurrencesPanel({
  ticket,
  selectedErrorOccurrenceId,
  onSelectErrorOccurrence,
}: ErrorOccurrencesPanelProps) {
  const occurrences = useMemo(() => getTicketErrorOccurrences(ticket), [ticket])
  const activeOccurrence = useMemo(() => getActiveErrorOccurrence(ticket), [ticket])
  const currentStatusIsBlocked = ticket.status === 'BLOCKED_ERROR'
  const selectedOccurrence = selectedErrorOccurrenceId != null
    ? occurrences.find((occurrence) => occurrence.id === selectedErrorOccurrenceId) ?? null
    : null

  const visibleCurrentOccurrence = currentStatusIsBlocked ? activeOccurrence ?? occurrences.at(-1) ?? null : null
  const pastOccurrences = useMemo(() => {
    if (currentStatusIsBlocked) {
      return occurrences.filter((occurrence) => occurrence.id !== visibleCurrentOccurrence?.id)
    }
    return occurrences
  }, [currentStatusIsBlocked, occurrences, visibleCurrentOccurrence?.id])

  const shouldShowPanel = currentStatusIsBlocked || pastOccurrences.length > 0 || Boolean(selectedOccurrence)
  const shouldForcePastOpen = Boolean(selectedOccurrence && selectedOccurrence.id !== visibleCurrentOccurrence?.id)
  const [pastExpanded, setPastExpanded] = useState(false)
  const isPastExpanded = pastExpanded || shouldForcePastOpen

  if (!shouldShowPanel) return null

  const isViewingPast = Boolean(selectedOccurrence && selectedOccurrence.id !== visibleCurrentOccurrence?.id)

  return (
    <div className="border-t border-border px-2 py-2 space-y-2">
      <div className="flex items-center gap-2 px-1">
        <AlertTriangle className={cn('h-3.5 w-3.5', currentStatusIsBlocked ? 'text-red-500' : 'text-amber-500')} />
        <span className="text-xs font-semibold uppercase tracking-wider">Errors</span>
        <Badge variant="outline" className="text-[10px] shrink-0">
          {occurrences.length}
        </Badge>
        {currentStatusIsBlocked && (
          <Badge variant="destructive" className="text-[10px] shrink-0">
            Active
          </Badge>
        )}
        {!currentStatusIsBlocked && isViewingPast && (
          <Badge variant="secondary" className="text-[10px] shrink-0">
            Review
          </Badge>
        )}
      </div>

      {currentStatusIsBlocked && visibleCurrentOccurrence && (
        <div className="space-y-2">
          <div className="rounded-md border border-red-200 bg-red-50/70 p-2 dark:border-red-900/50 dark:bg-red-950/20">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-semibold truncate">
                    {formatErrorOccurrenceLabel(visibleCurrentOccurrence, visibleCurrentOccurrence.occurrenceNumber)}
                  </span>
                  <Badge variant="destructive" className="text-[10px] shrink-0">
                    Current
                  </Badge>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {getOccurrenceSubtitle(visibleCurrentOccurrence)}
                </p>
              </div>
              <button
                type="button"
                disabled
                className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground"
              >
                Live
              </button>
            </div>

            {visibleCurrentOccurrence.errorMessage && (
              <p className="mt-2 rounded-md bg-background/70 p-2 text-[11px] font-mono text-muted-foreground [overflow-wrap:anywhere]">
                {visibleCurrentOccurrence.errorMessage}
              </p>
            )}

            {visibleCurrentOccurrence.errorCodes.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {visibleCurrentOccurrence.errorCodes.map((code) => (
                  <Badge key={code} variant="outline" className="text-[10px]">
                    {code}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {pastOccurrences.length > 0 && (
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => setPastExpanded((value) => !value)}
                aria-expanded={isPastExpanded}
                className="flex w-full items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronRight className={cn('h-3 w-3 transition-transform', isPastExpanded && 'rotate-90')} />
                <span>Past errors</span>
                <span className="ml-auto text-[10px] font-normal normal-case">
                  {pastOccurrences.length}
                </span>
              </button>

              {isPastExpanded && (
                <ScrollArea className="max-h-[220px] pr-1">
                  <div className="space-y-1.5">
                    {pastOccurrences.map((occurrence) => (
                      <ErrorOccurrenceRow
                        key={occurrence.id}
                        occurrence={occurrence}
                        isSelected={selectedErrorOccurrenceId === occurrence.id}
                        onSelect={() => onSelectErrorOccurrence(occurrence.id)}
                      />
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}
        </div>
      )}

      {!currentStatusIsBlocked && (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => setPastExpanded((value) => !value)}
            aria-expanded={isPastExpanded}
            className="flex w-full items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronRight className={cn('h-3 w-3 transition-transform', isPastExpanded && 'rotate-90')} />
            <span>Past errors</span>
            <span className="ml-auto text-[10px] font-normal normal-case">
              {pastOccurrences.length}
            </span>
          </button>

          {isPastExpanded && (
            <ScrollArea className="max-h-[260px] pr-1">
              <div className="space-y-1.5">
                {pastOccurrences.map((occurrence) => (
                  <ErrorOccurrenceRow
                    key={occurrence.id}
                    occurrence={occurrence}
                    isSelected={selectedErrorOccurrenceId === occurrence.id}
                    onSelect={() => onSelectErrorOccurrence(occurrence.id)}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      )}
    </div>
  )
}
