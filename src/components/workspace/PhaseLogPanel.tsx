import { useState, useMemo, useRef, useEffect, useCallback, Fragment } from 'react'
import { ChevronRight, ChevronLeft, Copy, Check } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useLogs } from '@/context/useLogContext'
import type { LogEntry } from '@/context/LogContext'
import { getStatusUserLabel } from '@/lib/workflowMeta'
import { ModelBadge } from '@/components/shared/ModelBadge'
import { LoadingText } from '@/components/ui/LoadingText'
import type { Ticket } from '@/hooks/useTickets'
import { filterEntries, PHASE_LOG_DESCRIPTIONS, MULTI_MODEL_PHASES } from './logFormat'
import { LogEntryRow } from './LogLine'

interface PhaseLogPanelProps {
  phase: string
  logs?: LogEntry[]
  ticket?: Ticket
  hideHeader?: boolean
}

type LogTab = 'ALL' | 'SYS' | 'AI' | 'ERROR' | 'DEBUG'

const FIXED_TABS: LogTab[] = ['ALL', 'SYS', 'AI', 'ERROR', 'DEBUG']
const BOTTOM_THRESHOLD = 50

export function PhaseLogPanel({ phase, logs: propLogs, ticket, hideHeader = false }: PhaseLogPanelProps) {
  const logCtx = useLogs()
  const isLoadingLogs = logCtx?.isLoadingLogs ?? false
  const phaseLogs: LogEntry[] = useMemo(
    () => propLogs ?? logCtx?.getLogsForPhase(phase) ?? [],
    [propLogs, logCtx, phase],
  )
  const [activeTab, setActiveTab] = useState<string>('ALL')
  const [modelsCollapsed, setModelsCollapsed] = useState(true)
  const isKnownMultiModelPhase = MULTI_MODEL_PHASES.has(phase)
  const lockedCouncilMembers = useMemo(
    () => ticket?.lockedCouncilMembers ?? [],
    [ticket?.lockedCouncilMembers],
  )

  // ── Smart auto-scroll ──────────────────────────────────────────────
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const autoScrollEnabledRef = useRef(true)
  const previousViewRef = useRef<string | null>(null)
  const previousVisibleTailRef = useRef<string | null>(null)
  const scrollFrameRef = useRef<number | null>(null)

  const scheduleScrollToBottom = useCallback((behavior: ScrollBehavior) => {
    const scroll = () => {
      const el = viewportRef.current
      if (!el) return
      el.scrollTo({ top: el.scrollHeight, behavior })
    }

    if (behavior === 'auto') {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current)
        scrollFrameRef.current = null
      }
      scroll()
      return
    }

    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current)
    }

    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null
      scroll()
    })
  }, [])

  // Attach scroll listener directly on the viewport (scroll events don't bubble)
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      autoScrollEnabledRef.current = distanceFromBottom <= BOTTOM_THRESHOLD
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current)
    }
  }, [])

  useEffect(() => {
    const contentEl = contentRef.current
    if (!contentEl) return

    const observer = new ResizeObserver(() => {
      if (!autoScrollEnabledRef.current) return
      scheduleScrollToBottom('auto')
    })

    observer.observe(contentEl)
    return () => observer.disconnect()
  }, [scheduleScrollToBottom])

  const configuredModelIds = useMemo(() => {
    return lockedCouncilMembers.filter((memberId) => memberId.trim().length > 0)
  }, [lockedCouncilMembers])

  // Detect model IDs from structured source field
  const detectedModelIds = useMemo(() => {
    const ids = new Set<string>()
    for (const entry of phaseLogs) {
      if (entry.modelId) {
        ids.add(entry.modelId)
        continue
      }
      if (entry.source.startsWith('model:')) {
        ids.add(entry.source.slice('model:'.length))
      }
    }
    return Array.from(ids)
  }, [phaseLogs])

  const modelTabs = useMemo(() => {
    const enableModelTabs = isKnownMultiModelPhase || detectedModelIds.length > 0
    if (!enableModelTabs) return []

    const seen = new Set<string>()
    const tabs: string[] = []
    const add = (id: string) => {
      if (!id || seen.has(id)) return
      seen.add(id)
      tabs.push(id)
    }

    if (isKnownMultiModelPhase) configuredModelIds.forEach(add)
    detectedModelIds.forEach(add)

    return tabs
  }, [isKnownMultiModelPhase, configuredModelIds, detectedModelIds])

  const showModelTabs = modelTabs.length > 0
  const availableTabs: string[] = useMemo(
    () => (showModelTabs ? [...FIXED_TABS, ...modelTabs] : [...FIXED_TABS]),
    [showModelTabs, modelTabs],
  )
  const effectiveTab = availableTabs.includes(activeTab) ? activeTab : 'ALL'
  const filteredLogs = filterEntries(phaseLogs, effectiveTab)
  const showModelNameInLogTags = effectiveTab === 'ALL' || effectiveTab === 'AI'
  const hasLogs = filteredLogs.length > 0

  const [copied, setCopied] = useState(false)
  const handleCopyLogs = useCallback(() => {
    if (!filteredLogs.length) return
    const textToCopy = filteredLogs.map((entry) => {
      const ts = entry.timestamp ? `[${entry.timestamp}] ` : ''
      return `${ts}${entry.line}`
    }).join('\n')
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(err => console.error('Failed to copy logs:', err))
  }, [filteredLogs])

  const visibleLogTail = useMemo(() => {
    const lastEntry = filteredLogs.at(-1)
    if (!lastEntry) return null
    return [
      filteredLogs.length,
      lastEntry.entryId,
      lastEntry.timestamp ?? '',
      lastEntry.line,
      lastEntry.streaming ? 'streaming' : 'static',
      lastEntry.op,
    ].join('|')
  }, [filteredLogs])
  const description = PHASE_LOG_DESCRIPTIONS[phase] ?? <LoadingText text="Processing" />

  // Pin the latest visible logs on mount/view changes, then keep following
  // the tail until the user scrolls away from the bottom.
  useEffect(() => {
    const currentView = `${phase}:${effectiveTab}`
    const viewChanged = previousViewRef.current !== currentView
    const visibleTailChanged = previousVisibleTailRef.current !== visibleLogTail
    const hadVisibleLogs = previousVisibleTailRef.current !== null

    if (viewChanged) {
      autoScrollEnabledRef.current = true
    }

    if (hasLogs && (viewChanged || (visibleTailChanged && autoScrollEnabledRef.current))) {
      const behavior: ScrollBehavior = viewChanged || !hadVisibleLogs ? 'auto' : 'smooth'
      scheduleScrollToBottom(behavior)
    }

    previousViewRef.current = currentView
    previousVisibleTailRef.current = visibleLogTail
  }, [phase, effectiveTab, hasLogs, visibleLogTail, scheduleScrollToBottom])

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col">
      {!hideHeader && (
        <div className="px-1 py-1.5 flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Log — {getStatusUserLabel(phase)}
          </span>
        </div>
      )}
      <div className="text-xs text-muted-foreground px-1 mb-1">{description}</div>
      <div className="flex gap-1 px-1 py-1 items-center flex-wrap">
        {FIXED_TABS.map(tab => {
          if (tab === 'AI' && showModelTabs) {
            const isActive = effectiveTab === tab
            return (
              <Fragment key={tab}>
                <div
                  className={cn(
                    'flex items-center rounded text-xs font-medium shrink-0 transition-colors',
                    isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
                  )}
                >
                  <button
                    onClick={() => setActiveTab(tab)}
                    className="pl-2 pr-0.5 py-0.5 hover:text-foreground transition-colors"
                  >
                    {tab}
                  </button>
                  <button
                    onClick={() => setModelsCollapsed(!modelsCollapsed)}
                    className="pr-1.5 pl-0.5 py-0.5 flex items-center justify-center hover:text-foreground transition-colors opacity-70 hover:opacity-100"
                    title={modelsCollapsed ? 'Show models' : 'Hide models'}
                  >
                    {modelsCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
                  </button>
                </div>
                {!modelsCollapsed && modelTabs.map(mTab => (
                  <ModelBadge
                    key={mTab}
                    modelId={mTab}
                    active={effectiveTab === mTab}
                    onClick={() => setActiveTab(mTab)}
                    showIcon={false}
                  />
                ))}
              </Fragment>
            )
          }

          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-2 py-0.5 rounded text-xs font-medium shrink-0',
                effectiveTab === tab ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {tab}
            </button>
          )
        })}
        <div className="ml-auto flex items-center pl-2 gap-2 text-xs text-muted-foreground">
          <span>{filteredLogs.length} entries</span>
          <button
            onClick={handleCopyLogs}
            disabled={!hasLogs}
            title="Copy all logs"
            className="flex items-center justify-center p-1 rounded hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
      <ScrollArea className="flex-1 min-h-0" viewportRef={viewportRef}>
        <div ref={contentRef} className="font-mono text-xs bg-muted rounded-md p-3 min-h-[100px] w-full max-w-full">
          {hasLogs ? (
            filteredLogs.map((entry, i) => (
              <LogEntryRow key={entry.entryId} entry={entry} index={i} showModelName={showModelNameInLogTags} />
            ))
          ) : isLoadingLogs ? (
            <span className="text-muted-foreground/50 italic">
              <LoadingText text="Loading logs" />
            </span>
          ) : (
            <span className="text-muted-foreground/50 italic">
              {phaseLogs.length > 0 ? 'No entries match current filter.' : 'No log entries yet. Logs will stream here during execution.'}
            </span>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
