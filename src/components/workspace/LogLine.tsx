import { useState, useRef, useEffect, memo } from 'react'
import { cn } from '@/lib/utils'
import type { LogEntry } from '@/context/LogContext'
import { getEntryColor, formatTimestamp, formatVisibleTag } from './logFormat'

function renderLogLine(entry: LogEntry, showModelName: boolean) {
  const tagMatch = entry.line.match(/^(\[[^\]]+\])([\s\S]*)$/)
  if (tagMatch) {
    const [, rawTag = '', rest = ''] = tagMatch
    const tag = formatVisibleTag(rawTag, entry, showModelName)
    const color = getEntryColor(entry)
    return (
      <>
        <span className={cn('font-semibold', color)}>{tag}</span>
        {rest}
      </>
    )
  }
  if (entry.kind === 'reasoning' && !tagMatch) {
    const color = getEntryColor(entry)
    const tag = formatVisibleTag('[THINKING]', entry, showModelName)
    return (
      <>
        <span className={cn('font-semibold', color)}>{tag}</span>
        {' '}{entry.line}
      </>
    )
  }
  return <>{entry.line}</>
}

export interface LogEntryRowProps {
  entry: LogEntry
  index: number
  showModelName: boolean
}

export const LogEntryRow = memo(function LogEntryRow({ entry, index, showModelName }: LogEntryRowProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const isMultiline = entry.line.split('\n').length > 3

  useEffect(() => {
    const el = contentRef.current
    if (!el || isExpanded || isMultiline) return

    const observer = new ResizeObserver(() => {
      setIsOverflowing(el.scrollHeight > el.clientHeight)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [entry.line, isExpanded, isMultiline])

  const isTruncatable = isMultiline || isOverflowing

  return (
    <div className="py-0.5 border-b border-border/30 last:border-0 flex relative group">
      <div className="flex flex-col shrink-0 w-16 mr-2 pt-0.5 items-start">
        <span className="text-muted-foreground/40 select-none pb-1">{formatTimestamp(entry.timestamp)}</span>
        {isTruncatable && (
          <div className="sticky top-1">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-[10px] bg-background/90 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-muted px-1.5 py-0.5 rounded border border-border/50 shadow-sm transition-colors cursor-pointer opacity-80 hover:opacity-100"
            >
              {isExpanded ? 'Less' : 'More'}
            </button>
          </div>
        )}
      </div>
      <span className="text-muted-foreground/60 mr-2 select-none shrink-0 pt-0.5">{String(index + 1).padStart(3, ' ')}</span>
      <div className="flex-1 min-w-0 pr-2">
        <div className="relative">
          <div
            ref={contentRef}
            className={cn(
              getEntryColor(entry),
              'whitespace-pre-wrap break-words max-w-full',
              !isExpanded && 'line-clamp-3'
            )}
          >
            {renderLogLine(entry, showModelName)}
          </div>
          {isTruncatable && !isExpanded && (
            <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-muted to-transparent pointer-events-none" />
          )}
        </div>
      </div>
    </div>
  )
})
