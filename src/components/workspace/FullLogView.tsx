import { useState, useMemo, useRef, useEffect, useCallback, Fragment } from 'react'
import { Copy, Check, ScrollText, ChevronLeft, ChevronRight } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useLogs } from '@/context/useLogContext'
import type { LogEntry } from '@/context/LogContext'
import { getStatusUserLabel, type StatusLabelOptions } from '@/lib/workflowMeta'
import { LoadingText } from '@/components/ui/LoadingText'
import type { Ticket } from '@/hooks/useTickets'
import { filterEntries, formatLogLine } from './logFormat'
import { LogEntryRow } from './LogLine'
import { ModelBadge } from '@/components/shared/ModelBadge'
import { getModelDisplayName } from '@/components/shared/modelBadgeUtils'

type LogTab = 'ALL' | 'SYS' | 'AI' | 'ERROR' | 'DEBUG'

const FIXED_TABS: LogTab[] = ['ALL', 'SYS', 'AI', 'ERROR', 'DEBUG']
const BOTTOM_THRESHOLD = 50

const TAB_TOOLTIPS: Record<string, string> = {
  ALL: 'Shows system milestones, prompts, errors, and canonical AI outputs across all phases.',
  SYS: 'System background events and milestones for the orchestrator.',
  AI: 'Raw inputs (prompts), outputs, reasoning, and tool executions from AI models.',
  ERROR: 'Errors and exceptions encountered during execution.',
  DEBUG: 'Verbose internal debugging events and data.',
}

interface PhaseGroup {
  phase: string
  entries: LogEntry[]
}

function groupByPhaseRuns(entries: LogEntry[]): PhaseGroup[] {
  if (entries.length === 0) return []

  const groups: PhaseGroup[] = []
  let currentPhase = entries[0]!.status
  let currentEntries: LogEntry[] = [entries[0]!]

  for (let i = 1; i < entries.length; i++) {
    const entry = entries[i]!
    if (entry.status !== currentPhase) {
      groups.push({ phase: currentPhase, entries: currentEntries })
      currentPhase = entry.status
      currentEntries = [entry]
    } else {
      currentEntries.push(entry)
    }
  }

  groups.push({ phase: currentPhase, entries: currentEntries })
  return groups
}

function PhaseDelimiter({ phase, labelOptions }: { phase: string; labelOptions?: StatusLabelOptions }) {
  const label = getStatusUserLabel(phase, labelOptions)
  return (
    <div className="flex items-center gap-3 py-2 select-none" aria-label={`Phase: ${label}`}>
      <div className="flex-1 border-t border-border/60" />
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 whitespace-nowrap">
        {label}
      </span>
      <div className="flex-1 border-t border-border/60" />
    </div>
  )
}

interface FullLogViewProps {
  ticket?: Ticket
}

export function FullLogView({ ticket }: FullLogViewProps) {
  const logCtx = useLogs()
  const isLoadingLogs = logCtx?.isLoadingLogs ?? false

  const allLogs: LogEntry[] = useMemo(
    () => logCtx?.getAllLogs() ?? [],
    [logCtx],
  )

  const [activeTab, setActiveTab] = useState<string>('ALL')
  const [modelsCollapsed, setModelsCollapsed] = useState(true)

  const configuredModelIds = useMemo(() => {
    return (ticket?.lockedCouncilMembers ?? []).filter((memberId) => memberId.trim().length > 0)
  }, [ticket?.lockedCouncilMembers])

  const detectedModelIds = useMemo(() => {
    const ids = new Set<string>()
    for (const entry of allLogs) {
      if (entry.modelId) {
        ids.add(entry.modelId)
        continue
      }
      if (entry.source.startsWith('model:')) {
        ids.add(entry.source.slice('model:'.length))
      }
    }
    return Array.from(ids)
  }, [allLogs])

  const modelTabs = useMemo(() => {
    const seen = new Set<string>()
    const tabs: string[] = []
    const add = (id: string) => {
      if (!id || seen.has(id)) return
      seen.add(id)
      tabs.push(id)
    }

    configuredModelIds.forEach(add)
    detectedModelIds.forEach(add)

    return tabs
  }, [configuredModelIds, detectedModelIds])

  const singleModelTabId = modelTabs.length === 1 ? modelTabs[0]! : null
  const aiTabLabel = singleModelTabId ? `AI > ${getModelDisplayName(singleModelTabId)}` : 'AI'
  const showModelTabs = modelTabs.length > 1
  const availableTabs: string[] = useMemo(
    () => (showModelTabs ? [...FIXED_TABS, ...modelTabs] : [...FIXED_TABS]),
    [showModelTabs, modelTabs],
  )
  const effectiveTab = availableTabs.includes(activeTab)
    ? activeTab
    : singleModelTabId && activeTab === singleModelTabId
      ? 'AI'
      : 'ALL'

  const filteredLogs = useMemo(
    () => filterEntries(allLogs, effectiveTab),
    [allLogs, effectiveTab],
  )

  const phaseGroups = useMemo(
    () => groupByPhaseRuns(filteredLogs),
    [filteredLogs],
  )

  const hasLogs = filteredLogs.length > 0

  const beadLabelOptions: StatusLabelOptions | undefined = useMemo(() => {
    if (!ticket) return undefined
    return {
      currentBead: ticket.runtime.currentBead,
      totalBeads: ticket.runtime.totalBeads,
      errorMessage: ticket.errorMessage,
    }
  }, [ticket])

  // ── Smart auto-scroll ──────────────────────────────────────────────
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const autoScrollEnabledRef = useRef(true)
  const previousVisibleTailRef = useRef<string | null>(null)
  const previousViewRef = useRef<string | null>(null)
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

  useEffect(() => {
    const currentView = `full-log:${effectiveTab}`
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
  }, [effectiveTab, hasLogs, visibleLogTail, scheduleScrollToBottom])

  // ── Copy all logs ──────────────────────────────────────────────
  const [copied, setCopied] = useState(false)
  const handleCopyLogs = useCallback(() => {
    if (!filteredLogs.length) return
    const textToCopy = filteredLogs.map((entry) => {
      const ts = entry.timestamp ? `[${entry.timestamp}] ` : ''
      return `${ts}[${entry.status}] ${formatLogLine(entry, true).copyText}`
    }).join('\n')
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(err => console.error('Failed to copy logs:', err))
  }, [filteredLogs])

  // ── Global entry index counter ──────────────────────────────────
  const globalIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    let idx = 0
    for (const group of phaseGroups) {
      for (const entry of group.entries) {
        map.set(entry.entryId, idx++)
      }
    }
    return map
  }, [phaseGroups])

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-muted/20 px-4 py-3">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">Full Log</span>
          <span className="text-[11px] text-muted-foreground">— Complete ticket lifecycle</span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex px-1 py-1 items-center flex-wrap gap-1 shrink-0">
        {FIXED_TABS.map(tab => {
          const tooltipContent = TAB_TOOLTIPS[tab]

          if (tab === 'AI' && singleModelTabId) {
            return (
              <Tooltip key={tab} delayDuration={300}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                      'px-2 py-0.5 rounded text-xs font-medium shrink-0',
                      effectiveTab === tab ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
                    )}
                    title={singleModelTabId}
                  >
                    {aiTabLabel}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs bg-popover text-popover-foreground border border-border shadow-md font-medium max-w-[200px] text-center">
                  {tooltipContent}
                </TooltipContent>
              </Tooltip>
            )
          }

          if (tab === 'AI' && showModelTabs) {
            const isActive = effectiveTab === tab
            return (
              <Fragment key={tab}>
                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        'flex items-center rounded text-xs font-medium shrink-0 transition-colors',
                        isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setActiveTab(tab)}
                        className="pl-2 pr-0.5 py-0.5 hover:text-foreground transition-colors"
                      >
                        {tab}
                      </button>
                      <button
                        type="button"
                        onClick={() => setModelsCollapsed(!modelsCollapsed)}
                        className="pr-1.5 pl-0.5 py-0.5 flex items-center justify-center hover:text-foreground transition-colors opacity-70 hover:opacity-100"
                        title={modelsCollapsed ? 'Show models' : 'Hide models'}
                      >
                        {modelsCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs bg-popover text-popover-foreground border border-border shadow-md font-medium max-w-[200px] text-center">
                    {tooltipContent}
                  </TooltipContent>
                </Tooltip>
                {!modelsCollapsed && modelTabs.map((modelTab) => (
                  <ModelBadge
                    key={modelTab}
                    modelId={modelTab}
                    active={effectiveTab === modelTab}
                    onClick={() => setActiveTab(modelTab)}
                    showIcon={false}
                  />
                ))}
              </Fragment>
            )
          }

          return (
            <Tooltip key={tab} delayDuration={300}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    'px-2 py-0.5 rounded text-xs font-medium shrink-0',
                    effectiveTab === tab ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {tab}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs bg-popover text-popover-foreground border border-border shadow-md font-medium max-w-[200px] text-center">
                {tooltipContent}
              </TooltipContent>
            </Tooltip>
          )
        })}
        <div className="ml-auto flex items-center pl-2 gap-2 text-xs text-muted-foreground">
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="flex items-center cursor-help px-1 py-0.5 rounded hover:bg-muted transition-colors border-none bg-transparent m-0 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <span>{filteredLogs.length} entries</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" align="end" className="flex flex-col gap-1.5 p-2 bg-popover text-popover-foreground border border-border font-medium shadow-md">
              <div className="font-semibold text-xs border-b border-border pb-1">Log Colors Legend</div>
              <div className="flex items-center gap-2 text-[11px]"><div className="w-2.5 h-2.5 rounded bg-blue-500"></div> Input (Prompt)</div>
              <div className="flex items-center gap-2 text-[11px]"><div className="w-2.5 h-2.5 rounded bg-emerald-600"></div> Final Output (Text)</div>
              <div className="flex items-center gap-2 text-[11px]"><div className="w-2.5 h-2.5 rounded bg-green-500"></div> Other AI Events</div>
              <div className="flex items-center gap-2 text-[11px]"><div className="w-2.5 h-2.5 rounded bg-purple-400"></div> Thinking</div>
              <div className="flex items-center gap-2 text-[11px]"><div className="w-2.5 h-2.5 rounded bg-red-500"></div> Error</div>
              <div className="flex items-center gap-2 text-[11px]"><div className="w-2.5 h-2.5 rounded bg-amber-600"></div> Debug</div>
              <div className="flex items-center gap-2 text-[11px]"><div className="w-2.5 h-2.5 rounded bg-foreground"></div> System</div>
              <div className="flex items-center gap-2 text-[11px]"><div className="w-2.5 h-2.5 rounded bg-zinc-500"></div> System Commands</div>
            </TooltipContent>
          </Tooltip>
          <button
            type="button"
            onClick={handleCopyLogs}
            disabled={!hasLogs}
            title="Copy all logs"
            className="flex items-center justify-center p-1 rounded hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Log content */}
      <ScrollArea className="h-0 flex-1 min-h-0" viewportRef={viewportRef} type="always">
        <div ref={contentRef} className="font-mono text-xs bg-muted rounded-md p-3 min-h-[100px] w-full max-w-full">
          {hasLogs ? (
            phaseGroups.map((group, groupIdx) => (
              <Fragment key={`${group.phase}-${groupIdx}`}>
                <PhaseDelimiter phase={group.phase} labelOptions={group.phase === 'CODING' || group.phase === 'BLOCKED_ERROR' ? beadLabelOptions : undefined} />
                {group.entries.map((entry) => (
                  <LogEntryRow
                    key={entry.entryId}
                    entry={entry}
                    index={globalIndexMap.get(entry.entryId) ?? 0}
                    showModelName={true}
                  />
                ))}
              </Fragment>
            ))
          ) : isLoadingLogs ? (
            <span className="text-muted-foreground/50 italic">
              <LoadingText text="Loading logs" />
            </span>
          ) : (
            <span className="text-muted-foreground/50 italic">
              No log entries yet. Logs will appear here as the ticket progresses through its lifecycle.
            </span>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
