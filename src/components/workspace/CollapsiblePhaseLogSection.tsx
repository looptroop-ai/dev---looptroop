import { useId, useState, type RefObject } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getStatusUserLabel } from '@/lib/workflowMeta'
import { VerticalResizeHandle } from './VerticalResizeHandle'
import { PhaseLogPanel } from './PhaseLogPanel'
import type { LogEntry } from '@/context/LogContext'
import type { Ticket } from '@/hooks/useTickets'

interface CollapsiblePhaseLogSectionProps {
  phase: string
  logs?: LogEntry[]
  ticket?: Ticket
  defaultExpanded?: boolean
  variant?: 'fill' | 'bottom'
  className?: string
  resizeContainerRef?: RefObject<HTMLElement | null>
  defaultHeight?: number
}

export function CollapsiblePhaseLogSection({
  phase,
  logs,
  ticket,
  defaultExpanded = true,
  variant = 'fill',
  className,
  resizeContainerRef,
  defaultHeight = 200,
}: CollapsiblePhaseLogSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [height, setHeight] = useState(defaultHeight)
  const panelId = useId()
  const label = getStatusUserLabel(phase, {
    currentBead: ticket?.currentBead,
    totalBeads: ticket?.totalBeads,
    errorMessage: ticket?.errorMessage,
  })

  const rootClassName = cn(
    'min-w-0 flex flex-col',
    variant === 'fill'
      ? (expanded ? 'flex-1 min-h-0' : 'mt-auto shrink-0')
      : 'shrink-0',
    className,
  )

  const rootStyle = variant === 'bottom' && expanded
    ? { height, minHeight: 0 }
    : undefined

  return (
    <>
      {variant === 'bottom' && expanded && resizeContainerRef ? (
        <VerticalResizeHandle onResize={setHeight} containerRef={resizeContainerRef} />
      ) : null}
      <div className={rootClassName} style={rootStyle}>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="flex items-center gap-1 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider transition-colors hover:text-foreground"
        >
          <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')} />
          <span>Log — {label}</span>
        </button>
        {expanded ? (
          <div id={panelId} className="flex-1 min-h-0 flex flex-col">
            <PhaseLogPanel phase={phase} logs={logs} ticket={ticket} hideHeader />
          </div>
        ) : null}
      </div>
    </>
  )
}
