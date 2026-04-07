import { useState, useRef, useEffect, memo, useMemo } from 'react'
import { Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LogEntry } from '@/context/LogContext'
import { formatLogLine, getEntryColor, formatTimestamp } from './logFormat'

/** For streaming entries: returns [firstLine, ...last5Lines] with a separator when truncated. */
function getStreamingVisibleLines(text: string): { lines: string[]; truncated: boolean } {
  const allLines = text.split('\n')
  if (allLines.length <= 6) return { lines: allLines, truncated: false }
  return {
    lines: [allLines[0]!, ...allLines.slice(-5)],
    truncated: true,
  }
}

function renderLogLine(entry: LogEntry, showModelName: boolean) {
  const formatted = formatLogLine(entry, showModelName)
  if (!formatted.tagText) return <>{formatted.visibleText}</>

  const color = getEntryColor(entry)
  return (
    <>
      <span
        className={cn('font-semibold', color)}
        title={formatted.tagTitle}
      >
        {formatted.tagText}
      </span>
      {formatted.bodyText}
    </>
  )
}

function StreamingPreview({ entry, showModelName }: { entry: LogEntry; showModelName: boolean }) {
  const { lines, truncated } = useMemo(() => getStreamingVisibleLines(entry.line), [entry.line])

  if (!truncated) {
    return <div>{renderLogLine(entry, showModelName)}</div>
  }

  // Build a synthetic entry for the first line to reuse tag/color rendering
  const firstLineEntry = { ...entry, line: lines[0]! }
  const tailText = lines.slice(1).join('\n')
  const tailEntry = { ...entry, line: tailText }

  return (
    <div>
      <div>{renderLogLine(firstLineEntry, showModelName)}</div>
      <div className="text-muted-foreground/50 select-none text-xs py-0.5">{'···'}</div>
      <div>{renderLogLine(tailEntry, showModelName)}</div>
    </div>
  )
}

export interface LogEntryRowProps {
  entry: LogEntry
  index: number
  showModelName: boolean
}

function showsStreamingUi(entry: LogEntry): boolean {
  return entry.streaming && (entry.kind === 'text' || entry.kind === 'reasoning')
}

export const LogEntryRow = memo(function LogEntryRow({ entry, index, showModelName }: LogEntryRowProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const [copied, setCopied] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const isStreamingUiEntry = showsStreamingUi(entry)
  
  // Fast multiline check to predict if truncation is needed
  const isMultiline = useMemo(() => {
    if (isStreamingUiEntry) {
      return entry.line.split('\n').length > 6
    }
    
    let count = 0
    const trimmed = entry.line.trimEnd()
    let pos = trimmed.indexOf('\n')
    while (pos !== -1) {
      count++
      if (count >= 5) return true;
      pos = trimmed.indexOf('\n', pos + 1)
    }
    return false
  }, [entry.line, isStreamingUiEntry])

  useEffect(() => {
    const el = contentRef.current
    if (!el || isExpanded || isMultiline) return

    const observer = new ResizeObserver(() => {
      // Add a 4px tolerance to prevent false positives from sub-pixel rendering 
      // or minor line-height discrepancies when content fits perfectly in 5 lines.
      setIsOverflowing(el.scrollHeight > el.clientHeight + 4)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [entry.line, isExpanded, isMultiline])

  const isTruncatable = isMultiline || isOverflowing

  return (
    <div className="py-0.5 border-b border-border/30 last:border-0 flex relative group">
      <div className="flex flex-col shrink-0 w-[105px] mr-2 pt-0.5 items-start">
        <div className="flex flex-row items-center gap-1 w-full pb-1">
          <span className="text-muted-foreground/40">{formatTimestamp(entry.timestamp)}</span>
          <button
            onClick={() => {
              const textToCopy = formatLogLine(entry, showModelName).copyText
              const timestampedText = entry.timestamp ? `[${entry.timestamp}] ${textToCopy}` : textToCopy
              void navigator.clipboard.writeText(timestampedText)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
            className="text-muted-foreground/40 hover:text-foreground hover:bg-muted p-0.5 rounded cursor-pointer transition-colors opacity-0 group-hover:opacity-100"
            title="Copy log entry"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
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
        {isStreamingUiEntry && (
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
              !isExpanded && !isStreamingUiEntry && 'line-clamp-5',
            )}
          >
            {!isExpanded && isStreamingUiEntry ? (
              <StreamingPreview entry={entry} showModelName={showModelName} />
            ) : (
              <div>
                {renderLogLine(entry, showModelName)}
              </div>
            )}
          </div>
          {isTruncatable && !isExpanded && (
            <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-muted to-transparent pointer-events-none" />
          )}
        </div>
      </div>
    </div>
  )
})
