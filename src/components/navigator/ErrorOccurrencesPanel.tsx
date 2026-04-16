import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { Ticket } from '@/hooks/useTickets'
import { formatTimestampString } from '@/components/workspace/logFormat'
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
  const startedAt = formatTimestampString(occurrence.occurredAt, { includeMilliseconds: false })
  if (occurrence.resolvedAt) {
    return `Blocked ${startedAt} · Resolved ${formatTimestampString(occurrence.resolvedAt, { includeMilliseconds: false })}`
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
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
        <StatusIndicator status={occurrence.resolvedAt ? 'completed' : 'error'} className="mt-0.5 shrink-0" />
        <div className="min-w-0 space-y-1">
          <span className="block text-xs font-semibold leading-tight break-words">
            {formatErrorOccurrenceLabel(occurrence, occurrence.occurrenceNumber)}
          </span>
          <div className="flex flex-wrap items-start gap-1.5">
            <Badge variant="outline" className="max-w-full text-[10px] leading-tight whitespace-normal break-words">
              {status}
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground leading-tight break-words">
            {summary}
          </p>
          {occurrence.errorMessage && (
            <p className="text-[11px] font-mono text-muted-foreground/90 line-clamp-2 [overflow-wrap:anywhere]">
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

  const visibleOccurrences = useMemo(() => {
    if (!currentStatusIsBlocked || !activeOccurrence) return occurrences
    return [
      activeOccurrence,
      ...occurrences.filter((occurrence) => occurrence.id !== activeOccurrence.id),
    ]
  }, [activeOccurrence, currentStatusIsBlocked, occurrences])

  const shouldShowPanel = visibleOccurrences.length > 0 || Boolean(selectedOccurrence)
  const shouldAutoExpand = currentStatusIsBlocked || Boolean(selectedOccurrence?.resolvedAt)
  const [userToggled, setUserToggled] = useState(false)
  const expanded = shouldAutoExpand || userToggled
  const activeFailureSummary = currentStatusIsBlocked && ticket.runtime.lastFailedBeadId
    ? `${ticket.runtime.lastFailedBeadId}${ticket.runtime.activeBeadIteration ? ` · iter ${ticket.runtime.activeBeadIteration}` : ''}`
    : null

  if (!shouldShowPanel) return null

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setUserToggled((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')} />
        <AlertTriangle className={cn('h-3.5 w-3.5', currentStatusIsBlocked ? 'text-red-500' : 'text-amber-500')} />
        <span>Errors</span>
        <Badge variant="outline" className="text-[10px] shrink-0">
          {visibleOccurrences.length}
        </Badge>
        {currentStatusIsBlocked && (
          <Badge variant="destructive" className="text-[10px] shrink-0">
            Active
          </Badge>
        )}
        {activeFailureSummary && (
          <Badge variant="outline" className="text-[10px] shrink-0 font-mono">
            {activeFailureSummary}
          </Badge>
        )}
        {!currentStatusIsBlocked && selectedOccurrence?.resolvedAt && (
          <Badge variant="secondary" className="text-[10px] shrink-0">
            Review
          </Badge>
        )}
      </button>

      {expanded && (
        <ScrollArea className="max-h-[260px] pr-1">
          <div className="space-y-1.5">
            {visibleOccurrences.map((occurrence) => (
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
  )
}
