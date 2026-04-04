import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { VerticalResizeHandle } from './VerticalResizeHandle'
import { PhaseLogPanel } from './PhaseLogPanel'
import { getFillDrawerAvailableHeight, resolveStickyFillNaturalHeight, type StickyFillNaturalHeight } from './logDrawerSizing'
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
  const [fillNaturalHeight, setFillNaturalHeight] = useState<StickyFillNaturalHeight | null>(null)
  const [fillAvailableHeight, setFillAvailableHeight] = useState<number | null>(null)
  const panelId = useId()
  const rootRef = useRef<HTMLDivElement>(null)

  const rootClassName = cn(
    'min-w-0 flex flex-col',
    variant === 'fill' ? 'mt-auto shrink-0' : 'shrink-0',
    className,
  )

  const handleToggleExpanded = useCallback(() => {
    setExpanded((value) => {
      const nextValue = !value
      if (variant === 'fill') {
        if (nextValue) {
          setFillNaturalHeight(null)
        } else {
          setFillAvailableHeight(null)
        }
      }
      return nextValue
    })
  }, [variant])

  const effectiveFillNaturalHeight = fillNaturalHeight?.phase === phase
    ? fillNaturalHeight.height
    : null

  const measureFillAvailableHeight = useCallback(() => {
    if (variant !== 'fill' || !expanded) {
      setFillAvailableHeight(null)
      return
    }

    const rootEl = rootRef.current
    const parentEl = rootEl?.parentElement
    if (!rootEl || !parentEl) {
      setFillAvailableHeight(null)
      return
    }
    setFillAvailableHeight(getFillDrawerAvailableHeight(parentEl, rootEl))
  }, [expanded, variant])

  useEffect(() => {
    if (variant !== 'fill' || !expanded) return

    const rootEl = rootRef.current
    const parentEl = rootEl?.parentElement
    if (!rootEl || !parentEl) return
    const frame = requestAnimationFrame(() => {
      measureFillAvailableHeight()
    })

    const observer = new ResizeObserver(() => {
      measureFillAvailableHeight()
    })

    observer.observe(parentEl)
    Array.from(parentEl.children).forEach((child) => {
      if (child !== rootEl) observer.observe(child)
    })

    window.addEventListener('resize', measureFillAvailableHeight)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', measureFillAvailableHeight)
    }
  }, [expanded, measureFillAvailableHeight, variant])

  const rootStyle = (() => {
    if (!expanded) return undefined
    if (variant === 'bottom') return { height, minHeight: 0, maxHeight: '100%' }
    if (variant !== 'fill' || fillAvailableHeight === null) return undefined

    return {
      height: effectiveFillNaturalHeight === null ? fillAvailableHeight : Math.min(effectiveFillNaturalHeight, fillAvailableHeight),
      minHeight: 0,
      maxHeight: '100%',
    }
  })()

  const handleFillNaturalHeightChange = useCallback((nextHeight: number) => {
    setFillNaturalHeight((current) => resolveStickyFillNaturalHeight(current, phase, nextHeight))
  }, [phase])

  const logToggleButton = (
    <button
      type="button"
      onClick={handleToggleExpanded}
      aria-expanded={expanded}
      aria-controls={panelId}
      className="flex items-center gap-1 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider transition-colors hover:text-foreground shrink-0"
    >
      <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')} />
      <span>Log</span>
    </button>
  )

  return (
    <>
      {variant === 'bottom' && expanded && resizeContainerRef ? (
        <VerticalResizeHandle onResize={setHeight} containerRef={resizeContainerRef} />
      ) : null}
      <div ref={rootRef} className={rootClassName} style={rootStyle}>
        {!expanded ? logToggleButton : null}
        {expanded ? (
          <div id={panelId} className="flex-1 min-h-0 flex flex-col">
            <PhaseLogPanel
              phase={phase}
              logs={logs}
              ticket={ticket}
              hideHeader
              toolbarPrefix={logToggleButton}
              onNaturalHeightChange={variant === 'fill' ? handleFillNaturalHeightChange : undefined}
            />
          </div>
        ) : null}
      </div>
    </>
  )
}
