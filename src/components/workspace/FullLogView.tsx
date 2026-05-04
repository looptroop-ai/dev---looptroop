import { useState, useMemo, useRef, useEffect, useCallback, Fragment } from 'react'
import { Copy, Check, ScrollText, ChevronLeft, ChevronRight, ArrowUpToLine, ArrowDownToLine } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useLogs } from '@/context/useLogContext'
import type { LogEntry } from '@/context/LogContext'
import { getStatusUserLabel, type StatusLabelOptions } from '@/lib/workflowMeta'
import { LoadingText } from '@/components/ui/LoadingText'
import type { Ticket } from '@/hooks/useTickets'
import { filterEntries, formatLogLine, isSystem, isCommand } from './logFormat'
import { LogEntryRow } from './LogLine'
import { LogColorLegend } from './LogColorLegend'
import { ModelBadge } from '@/components/shared/ModelBadge'
import { getModelDisplayName } from '@/components/shared/modelBadgeUtils'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'

type LogTab = 'ALL' | 'SYS' | 'AI' | 'ERROR' | 'DEBUG'

const FIXED_TABS: LogTab[] = ['ALL', 'SYS', 'AI', 'ERROR', 'DEBUG']
const BOTTOM_THRESHOLD = 50

function isAiLogTab(tab: string): boolean {
  return tab === 'AI' || (!FIXED_TABS.includes(tab as LogTab) && tab !== 'CMD')
}

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

interface RenderedBeadSection {
  beadId: string
  ordinal: number
  total: number
  title: string
  entries: LogEntry[]
}

interface RenderedPhaseGroup {
  phase: string
  entries: LogEntry[]
  preambleEntries?: LogEntry[]
  beadSections?: RenderedBeadSection[]
}

const COMPLETED_BEAD_STATUSES = new Set(['done', 'completed', 'skipped'])
const EXECUTING_BEAD_PATTERN = /^(?:\[[A-Z_]+\]\s+)?Executing bead\s+([^:]+):\s+(.+?)\s*$/

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

function PhaseDelimiter({ phase, labelOptions, label }: { phase: string; labelOptions?: StatusLabelOptions; label?: string }) {
  const resolvedLabel = label ?? getStatusUserLabel(phase, labelOptions)
  return (
    <div className="flex items-center gap-3 py-2 select-none" aria-label={`Phase: ${resolvedLabel}`}>
      <div className="flex-1 border-t border-border/60" />
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 whitespace-nowrap">
        {resolvedLabel}
      </span>
      <div className="flex-1 border-t border-border/60" />
    </div>
  )
}

function BeadDelimiter({ ordinal, total, title }: { ordinal: number; total: number; title?: string }) {
  return (
    <div className="flex items-center gap-3 py-2 pl-4 select-none" aria-label={`Bead ${ordinal}/${total}`}>
      <div className="flex-1 border-t border-border/40" />
      <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground whitespace-nowrap">
        {`Bead ${ordinal}/${total}`}
      </span>
      {title ? (
        <span className="max-w-[45%] truncate text-[10px] text-muted-foreground/80">
          {title}
        </span>
      ) : null}
      <div className="flex-1 border-t border-border/40" />
    </div>
  )
}

function parseExecutingBead(entry: LogEntry): { beadId: string; title: string } | null {
  if (!isSystem(entry)) return null
  const match = entry.line.match(EXECUTING_BEAD_PATTERN)
  if (!match) return null
  return {
    beadId: match[1]!.trim(),
    title: match[2]!.trim(),
  }
}

function isCompletedBeadStatus(status?: string | null): boolean {
  return status ? COMPLETED_BEAD_STATUSES.has(status.toLowerCase()) : false
}

function buildRenderedPhaseGroups(
  phaseGroups: PhaseGroup[],
  visibleEntryIds: Set<string>,
  ticket?: Ticket,
): RenderedPhaseGroup[] {
  const runtimeBeads = ticket?.runtime.beads ?? []
  const runtimeBeadMap = new Map(
    runtimeBeads.map((bead, index) => [
      bead.id,
      {
        ordinal: index + 1,
        title: bead.title,
        status: bead.status,
      },
    ]),
  )
  const activeBeadId = ticket?.runtime.activeBeadId ?? null
  const runtimeTotal = ticket?.runtime.totalBeads ?? 0

  return phaseGroups.flatMap((group) => {
    if (group.phase !== 'CODING') {
      const entries = group.entries.filter((entry) => visibleEntryIds.has(entry.entryId))
      return entries.length > 0 ? [{ phase: group.phase, entries }] : []
    }

    const preambleEntries: LogEntry[] = []
    const discoveredBeadIds: string[] = []
    const beadSegments: Array<{ beadId: string; title: string; entries: LogEntry[] }> = []
    let currentSegment: { beadId: string; title: string; entries: LogEntry[] } | null = null

    for (const entry of group.entries) {
      const beadStart = parseExecutingBead(entry)
      if (beadStart) {
        if (currentSegment) {
          beadSegments.push(currentSegment)
        }
        currentSegment = {
          beadId: beadStart.beadId,
          title: beadStart.title,
          entries: [entry],
        }
        if (!discoveredBeadIds.includes(beadStart.beadId)) {
          discoveredBeadIds.push(beadStart.beadId)
        }
        continue
      }

      if (currentSegment) {
        currentSegment.entries.push(entry)
      } else {
        preambleEntries.push(entry)
      }
    }

    if (currentSegment) {
      beadSegments.push(currentSegment)
    }

    if (beadSegments.length === 0) {
      const entries = group.entries.filter((entry) => visibleEntryIds.has(entry.entryId))
      return entries.length > 0 ? [{ phase: group.phase, entries }] : []
    }

    const discoveryOrdinalMap = new Map(discoveredBeadIds.map((beadId, index) => [beadId, index + 1]))
    const total = runtimeTotal > 0 ? runtimeTotal : discoveredBeadIds.length
    const shouldFilterByRuntimeStatus = runtimeBeadMap.size > 0

    const visiblePreambleEntries = preambleEntries.filter((entry) => visibleEntryIds.has(entry.entryId))
    const beadSections = beadSegments
      .map((segment, segmentIndex): RenderedBeadSection | null => {
        const visibleEntries = segment.entries.filter((entry) => visibleEntryIds.has(entry.entryId))
        if (visibleEntries.length === 0) return null

        const runtimeBead = runtimeBeadMap.get(segment.beadId)
        if (
          shouldFilterByRuntimeStatus
          && segment.beadId !== activeBeadId
          && !isCompletedBeadStatus(runtimeBead?.status)
        ) {
          return null
        }

        const ordinal = runtimeBead?.ordinal ?? discoveryOrdinalMap.get(segment.beadId) ?? segmentIndex + 1
        return {
          beadId: segment.beadId,
          ordinal,
          total: total > 0 ? total : ordinal,
          title: runtimeBead?.title?.trim() || segment.title,
          entries: visibleEntries,
        }
      })
      .filter((section): section is RenderedBeadSection => section !== null)

    if (visiblePreambleEntries.length === 0 && beadSections.length === 0) {
      return []
    }

    return [{
      phase: group.phase,
      entries: [...visiblePreambleEntries, ...beadSections.flatMap((section) => section.entries)],
      preambleEntries: visiblePreambleEntries,
      beadSections,
    }]
  })
}

interface FullLogViewProps {
  ticket?: Ticket
}

export function FullLogView({ ticket }: FullLogViewProps) {
  const logCtx = useLogs()
  const loadAllLogs = logCtx?.loadAllLogs
  const isLoadingLogScope = logCtx?.isLoadingLogScope

  const allLogs: LogEntry[] = useMemo(
    () => logCtx?.getAllLogs() ?? [],
    [logCtx],
  )

  const [activeTab, setActiveTab] = useState<string>('ALL')
  const [modelsCollapsed, setModelsCollapsed] = useState(true)
  const [sysCollapsed, setSysCollapsed] = useState(true)

  useEffect(() => {
    loadAllLogs?.()
  }, [loadAllLogs])

  useEffect(() => {
    if (activeTab !== 'DEBUG') return
    loadAllLogs?.({ channel: 'debug' })
  }, [activeTab, loadAllLogs])

  const hasCmdLogs = useMemo(() => {
    return allLogs.some((entry) => isSystem(entry) && isCommand(entry))
  }, [allLogs])

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
  const availableTabs: string[] = useMemo(() => {
    const tabs: string[] = [...FIXED_TABS]
    if (showModelTabs) tabs.push(...modelTabs)
    if (hasCmdLogs) tabs.push('CMD')
    return tabs
  }, [showModelTabs, modelTabs, hasCmdLogs])
  const effectiveTab = availableTabs.includes(activeTab)
    ? activeTab
    : singleModelTabId && activeTab === singleModelTabId
      ? 'AI'
      : 'ALL'

  useEffect(() => {
    if (!isAiLogTab(effectiveTab)) return
    loadAllLogs?.({ channel: 'ai' })
  }, [effectiveTab, loadAllLogs])

  const isLoadingLogs = effectiveTab === 'DEBUG'
    ? (isLoadingLogScope?.({ lifecycle: true, channel: 'debug' }) ?? false)
    : isAiLogTab(effectiveTab)
      ? ((isLoadingLogScope?.({ lifecycle: true }) ?? false) || (isLoadingLogScope?.({ lifecycle: true, channel: 'ai' }) ?? false))
      : (isLoadingLogScope?.({ lifecycle: true }) ?? (logCtx?.isLoadingLogs ?? false))

  const filteredLogs = useMemo(
    () => filterEntries(allLogs, effectiveTab),
    [allLogs, effectiveTab],
  )

  const rawPhaseGroups = useMemo(
    () => groupByPhaseRuns(allLogs),
    [allLogs],
  )

  const visibleEntryIds = useMemo(
    () => new Set(filteredLogs.map((entry) => entry.entryId)),
    [filteredLogs],
  )

  const phaseGroups = useMemo(
    () => buildRenderedPhaseGroups(rawPhaseGroups, visibleEntryIds, ticket),
    [rawPhaseGroups, visibleEntryIds, ticket],
  )

  const renderedEntries = useMemo(
    () => phaseGroups.flatMap((group) => group.entries),
    [phaseGroups],
  )

  const hasLogs = renderedEntries.length > 0

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

  const [isAutoScroll, setIsAutoScroll] = useState(true)
  const [isAtTop, setIsAtTop] = useState(true)

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      const atBottom = distanceFromBottom <= BOTTOM_THRESHOLD
      autoScrollEnabledRef.current = atBottom
      setIsAutoScroll((prev) => (prev !== atBottom ? atBottom : prev))
      const atTop = el.scrollTop <= 50
      setIsAtTop((prev) => (prev !== atTop ? atTop : prev))
    }
    onScroll()
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
    const lastEntry = renderedEntries.at(-1)
    if (!lastEntry) return null
    return [
      renderedEntries.length,
      lastEntry.entryId,
      lastEntry.timestamp ?? '',
      lastEntry.line.length,
      lastEntry.streaming ? 'streaming' : 'static',
      lastEntry.op,
    ].join('|')
  }, [renderedEntries])

  useEffect(() => {
    const currentView = `full-log:${effectiveTab}`
    const viewChanged = previousViewRef.current !== currentView
    const visibleTailChanged = previousVisibleTailRef.current !== visibleLogTail
    const hadVisibleLogs = previousVisibleTailRef.current !== null

    if (viewChanged) {
      autoScrollEnabledRef.current = true
      queueMicrotask(() => setIsAutoScroll(true))
    }

    if (hasLogs && (viewChanged || (visibleTailChanged && autoScrollEnabledRef.current))) {
      const behavior: ScrollBehavior = viewChanged || !hadVisibleLogs ? 'auto' : 'smooth'
      scheduleScrollToBottom(behavior)
    }

    previousViewRef.current = currentView
    previousVisibleTailRef.current = visibleLogTail
  }, [effectiveTab, hasLogs, visibleLogTail, scheduleScrollToBottom])

  // ── Copy all logs ──────────────────────────────────────────────
  const [copied, copyToClipboard] = useCopyToClipboard()
  const handleCopyLogs = useCallback(() => {
    if (!renderedEntries.length) return
    const textToCopy = renderedEntries.map((entry) => {
      const ts = entry.timestamp ? `[${entry.timestamp}] ` : ''
      return `${ts}[${entry.status}] ${formatLogLine(entry, true).copyText}`
    }).join('\n')
    copyToClipboard(textToCopy)
  }, [renderedEntries, copyToClipboard])

  // ── Global entry index counter ──────────────────────────────────
  const globalIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    let idx = 0
    for (const entry of renderedEntries) {
      map.set(entry.entryId, idx++)
    }
    return map
  }, [renderedEntries])

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
                  <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                                            type="button"
                                            onClick={() => setActiveTab(tab)}
                                            className={cn(
                                              'px-2 py-0.5 rounded text-xs font-medium shrink-0',
                                              effectiveTab === tab ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
                                            )}
                                          >
                                            {aiTabLabel}
                                          </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-center text-balance">{singleModelTabId}</TooltipContent>
                        </Tooltip>
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
                      <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                                        type="button"
                                                        aria-label={modelsCollapsed ? 'Show models' : 'Hide models'}
                                                        onClick={() => setModelsCollapsed(!modelsCollapsed)}
                                                        className="pr-1.5 pl-0.5 py-0.5 flex items-center justify-center hover:text-foreground transition-colors opacity-70 hover:opacity-100"
                                                      >
                                                        {modelsCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
                                                      </button>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs text-center text-balance">{modelsCollapsed ? 'Show models' : 'Hide models'}</TooltipContent>
                                </Tooltip>
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

          if (tab === 'SYS' && hasCmdLogs) {
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
                      <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                                        type="button"
                                                        aria-label={sysCollapsed ? 'Show commands' : 'Hide commands'}
                                                        onClick={() => setSysCollapsed(!sysCollapsed)}
                                                        className="pr-1.5 pl-0.5 py-0.5 flex items-center justify-center hover:text-foreground transition-colors opacity-70 hover:opacity-100"
                                                      >
                                                        {sysCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
                                                      </button>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs text-center text-balance">{sysCollapsed ? 'Show commands' : 'Hide commands'}</TooltipContent>
                                </Tooltip>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs bg-popover text-popover-foreground border border-border shadow-md font-medium max-w-[200px] text-center">
                    {tooltipContent}
                  </TooltipContent>
                </Tooltip>
                {!sysCollapsed && (
                  <ModelBadge
                    key="CMD"
                    modelId="CMD"
                    showIcon={false}
                    active={effectiveTab === 'CMD'}
                    onClick={() => setActiveTab('CMD')}
                  >
                    CMD
                  </ModelBadge>
                )}
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
                <span>{renderedEntries.length} entries</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" align="end" className="flex flex-col gap-1.5 p-2 bg-popover text-popover-foreground border border-border font-medium shadow-md">
              <LogColorLegend />
            </TooltipContent>
          </Tooltip>
          <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                              type="button"
                              aria-label="Copy all logs"
                              onClick={handleCopyLogs}
                              disabled={!hasLogs}
                              className="flex items-center justify-center p-1 rounded hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-center text-balance">Copy all logs</TooltipContent>
                  </Tooltip>
        </div>
      </div>

      {/* Log content */}
      <div className="relative flex-1 min-h-0 flex flex-col">
        <ScrollArea className="h-full flex-1 min-h-0" viewportRef={viewportRef} type="always">
          <div ref={contentRef} className="font-mono text-xs bg-muted rounded-md p-3 min-h-[100px] w-full max-w-full">
            {hasLogs ? (
              phaseGroups.map((group, groupIdx) => (
                <Fragment key={`${group.phase}-${groupIdx}`}>
                  <PhaseDelimiter
                    phase={group.phase}
                    label={group.phase === 'CODING' ? 'Implementing' : undefined}
                    labelOptions={group.phase === 'BLOCKED_ERROR' ? beadLabelOptions : undefined}
                  />
                  {group.phase === 'CODING' && group.beadSections !== undefined ? (
                    <>
                      {(group.preambleEntries ?? []).map((entry) => (
                        <LogEntryRow
                          key={entry.entryId}
                          entry={entry}
                          index={globalIndexMap.get(entry.entryId) ?? 0}
                          showModelName={true}
                        />
                      ))}
                      {group.beadSections.map((section) => (
                        <Fragment key={`${group.phase}-${groupIdx}-${section.beadId}-${section.ordinal}`}>
                          <BeadDelimiter ordinal={section.ordinal} total={section.total} title={section.title} />
                          {section.entries.map((entry) => (
                            <LogEntryRow
                              key={entry.entryId}
                              entry={entry}
                              index={globalIndexMap.get(entry.entryId) ?? 0}
                              showModelName={true}
                            />
                          ))}
                        </Fragment>
                      ))}
                    </>
                  ) : (
                    group.entries.map((entry) => (
                      <LogEntryRow
                        key={entry.entryId}
                        entry={entry}
                        index={globalIndexMap.get(entry.entryId) ?? 0}
                        showModelName={true}
                      />
                    ))
                  )}
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
        {hasLogs && !isAtTop && (
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => viewportRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                className="absolute top-4 right-6 p-2 bg-background/20 hover:bg-background backdrop-blur-sm border border-border/40 hover:border-border rounded-full shadow-sm hover:shadow pointer-events-auto text-muted-foreground hover:text-foreground transition-all z-10 opacity-40 hover:opacity-100"
              >
                <ArrowUpToLine className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" className="text-xs">Go to top</TooltipContent>
          </Tooltip>
        )}
        {hasLogs && !isAutoScroll && (
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => {
                  autoScrollEnabledRef.current = true
                  setIsAutoScroll(true)
                  scheduleScrollToBottom('smooth')
                }}
                className="absolute bottom-4 right-6 p-2 bg-background/20 hover:bg-background backdrop-blur-sm border border-border/40 hover:border-border rounded-full shadow-sm hover:shadow pointer-events-auto text-muted-foreground hover:text-foreground transition-all z-10 opacity-40 hover:opacity-100"
              >
                <ArrowDownToLine className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" className="text-xs">Back to bottom</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
