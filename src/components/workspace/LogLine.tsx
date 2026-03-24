import { useState, useRef, useEffect, memo } from 'react'
import { cn } from '@/lib/utils'
import type { LogEntry } from '@/context/LogContext'
import { getEntryColor, formatTimestamp, formatVisibleTag } from './logFormat'

function renderLogLine(entry: LogEntry, showModelName: boolean, isStreamingCollapsed: boolean = false) {
  const tagMatch = entry.line.match(/^(\[[^\]]+\])([\s\S]*)$/)
  if (tagMatch) {
    const [, rawTag = '', rest = ''] = tagMatch
    const tag = formatVisibleTag(rawTag, entry, showModelName)
    const color = getEntryColor(entry)
    
    let displayRest = rest
    if (isStreamingCollapsed) {
      const lines = rest.split('\n')
      if (lines.length > 5) {
        displayRest = ' ...\n' + lines.slice(-4).join('\n')
      } else if (rest.length > 1000) {
        displayRest = ' ...' + rest.slice(-1000)
      }
    }

    return (
      <>
        <span className={cn('font-semibold', color)}>{tag}</span>
        {displayRest}
      </>
    )
  }
  
  if (entry.kind === 'reasoning' && !tagMatch) {
    const color = getEntryColor(entry)
    const tag = formatVisibleTag('[THINKING]', entry, showModelName)
    
    let displayContent = entry.line
    if (isStreamingCollapsed) {
      const lines = displayContent.split('\n')
      if (lines.length > 5) {
        displayContent = ' ...\n' + lines.slice(-4).join('\n')
      } else if (displayContent.length > 1000) {
        displayContent = ' ...' + displayContent.slice(-1000)
      }
    }

    return (
      <>
        <span className={cn('font-semibold', color)}>{tag}</span>
        {' '}{displayContent}
      </>
    )
  }

  let displayContent = entry.line
  if (isStreamingCollapsed) {
    const lines = displayContent.split('\n')
    if (lines.length > 5) {
      displayContent = '...\n' + lines.slice(-4).join('\n')
    } else if (displayContent.length > 1000) {
      displayContent = '...' + displayContent.slice(-1000)
    }
  }

  return <>{displayContent}</>
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
  const isMultiline = entry.line.split('\n').length > 5

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
      <div className="flex flex-col shrink-0 w-[105px] mr-2 pt-0.5 items-start">
        <span className="text-muted-foreground/40 pb-1">{formatTimestamp(entry.timestamp)}</span>
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
        {entry.streaming && (
          <div className="mt-0.5">
            <span
              title="Receiving continuous text from AI model"
              className="text-[10px] bg-emerald-500/10 text-emerald-500 px-1.5 py-0.5 rounded border border-emerald-500/30 shadow-sm opacity-80 select-none cursor-default animate-pulse"
            >
              Stream
            </span>
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
              'whitespace-pre-wrap break-words break-all [overflow-wrap:anywhere] max-w-full',
              !isExpanded && !entry.streaming && 'line-clamp-5'
            )}
          >
            {renderLogLine(entry, showModelName, !isExpanded && !!entry.streaming)}
          </div>
          {isTruncatable && !isExpanded && (
            <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-muted to-transparent pointer-events-none" />
          )}
        </div>
      </div>
    </div>
  )
})
