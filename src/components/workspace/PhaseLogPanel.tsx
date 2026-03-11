import { useState, useMemo, useRef, useEffect, Fragment } from 'react'
import { ChevronRight, ChevronLeft } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useLogs, type LogEntry } from '@/context/LogContext'
import { getStatusUserLabel } from '@/lib/workflowMeta'
import { ModelBadge } from '@/components/shared/ModelBadge'
import { LoadingText } from '@/components/ui/LoadingText'
import type { Ticket } from '@/hooks/useTickets'

interface PhaseLogPanelProps {
  phase: string
  logs?: LogEntry[]
  ticket?: Ticket
}

type LogTab = 'ALL' | 'SYS' | 'AI' | 'ERROR' | 'DEBUG'

const FIXED_TABS: LogTab[] = ['ALL', 'SYS', 'AI', 'ERROR', 'DEBUG']

function getEntryColor(entry: LogEntry): string {
  if (entry.audience === 'debug' || entry.source === 'debug' || entry.line.includes('[DEBUG]')) return 'text-amber-600'
  if (entry.kind === 'error' || entry.source === 'error' || entry.line.includes('[ERROR]')) return 'text-red-500'
  if (entry.kind === 'reasoning') return 'text-purple-400'
  if (entry.audience === 'ai' || entry.source === 'opencode' || entry.source.startsWith('model:')) return 'text-green-500'
  return 'text-foreground'
}

// Deleted getModelLabel (using shared getModelDisplayName)

function formatTimestamp(timestamp?: string): string {
  if (!timestamp) return '--:--:--'
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) return '--:--:--'
  return parsed.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function renderLogLine(entry: LogEntry) {
  const tagMatch = entry.line.match(/^(\[[\w]+\])(.*)$/)
  if (tagMatch) {
    const tag = tagMatch[1]
    const rest = tagMatch[2]
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
    return (
      <>
        <span className={cn('font-semibold', color)}>[THINKING]</span>
        {' '}{entry.line}
      </>
    )
  }
  return <>{entry.line}</>
}

function LogEntryRow({ entry, index }: { entry: LogEntry; index: number }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isTruncatable, setIsTruncatable] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = contentRef.current
    if (!el) return

    const checkTruncatable = () => {
      if (entry.line.split('\n').length > 3) {
        setIsTruncatable(true)
        return
      }
      if (!isExpanded) {
        setIsTruncatable(el.scrollHeight > el.clientHeight)
      }
    }

    // Check on mount
    checkTruncatable()

    // Re-check when resized (e.g. window squeeze causing more wrapping)
    const observer = new ResizeObserver(checkTruncatable)
    observer.observe(el)

    return () => observer.disconnect()
  }, [entry.line, isExpanded])

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
            {renderLogLine(entry)}
          </div>
          {isTruncatable && !isExpanded && (
            <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-muted to-transparent pointer-events-none" />
          )}
        </div>
      </div>
    </div>
  )
}

const PHASE_LOG_DESCRIPTIONS: Record<string, string> = {
  DRAFT: 'Ticket created and waiting to start.',
  COUNCIL_DELIBERATING: 'Each council model generates an independent interview draft with questions in logical order.',
  COUNCIL_VOTING_INTERVIEW: 'Council members vote on all interview drafts using weighted scoring rubric.',
  COMPILING_INTERVIEW: 'Winning model incorporates best ideas from other drafts into a final normalized question set.',
  WAITING_INTERVIEW_ANSWERS: 'Interview questions presented to user for answers.',
  VERIFYING_INTERVIEW_COVERAGE: 'AI analyzes answers for coverage gaps and completeness.',
  WAITING_INTERVIEW_APPROVAL: 'Interview results ready for user review and approval.',
  DRAFTING_PRD: 'Each council model generates an independent PRD draft with epics and user stories.',
  COUNCIL_VOTING_PRD: 'Council members vote on all PRD drafts using weighted scoring rubric.',
  REFINING_PRD: 'Winning model incorporates relevant ideas from other PRD proposals.',
  VERIFYING_PRD_COVERAGE: 'AI verifies PRD covers all interview requirements.',
  WAITING_PRD_APPROVAL: 'PRD ready for user review and approval.',
  DRAFTING_BEADS: 'Each council model creates an independent beads breakdown from the PRD.',
  COUNCIL_VOTING_BEADS: 'Council members vote on all beads drafts for best architecture.',
  REFINING_BEADS: 'Winning model incorporates relevant ideas from other beads proposals.',
  VERIFYING_BEADS_COVERAGE: 'AI verifies beads cover all PRD requirements.',
  WAITING_BEADS_APPROVAL: 'Beads breakdown ready for user review and approval.',
  PRE_FLIGHT_CHECK: 'Validating OpenCode connectivity, git safety, tool availability, artifact paths, beads graph integrity.',
  CODING: 'AI coding agent executes beads with retry loop (Ralph Wiggum loop) until all tasks + tests pass.',
  RUNNING_FINAL_TEST: 'Running full test suite on unsquashed bead-commit branch state.',
  INTEGRATING_CHANGES: 'Squashing commits, finalizing commit history, running pre-merge checks.',
  WAITING_MANUAL_VERIFICATION: 'Candidate branch ready for manual verification.',
  CLEANING_ENV: 'Removing temporary files, worktrees, and processes created during execution.',
  COMPLETED: 'All phases completed successfully. Code merged to main.',
  CANCELED: 'Ticket was canceled.',
  BLOCKED_ERROR: 'An error occurred during processing.',
}

const MULTI_MODEL_PHASES = new Set([
  'COUNCIL_DELIBERATING',
  'COUNCIL_VOTING_INTERVIEW',
  'DRAFTING_PRD',
  'COUNCIL_VOTING_PRD',
  'DRAFTING_BEADS',
  'COUNCIL_VOTING_BEADS',
])

function filterEntries(entries: LogEntry[], tab: string): LogEntry[] {
  const isDebug = (entry: LogEntry) => entry.audience === 'debug' || entry.source === 'debug' || entry.line.includes('[DEBUG]')
  const isError = (entry: LogEntry) => entry.kind === 'error' || entry.source === 'error' || entry.line.includes('[ERROR]')
  const isFromOpenCode = (entry: LogEntry) =>
    entry.audience === 'ai' ||
    entry.source === 'opencode' ||
    entry.source.startsWith('model:') ||
    Boolean(entry.modelId) ||
    Boolean(entry.sessionId)
  const isSystem = (entry: LogEntry) => entry.audience === 'all' && entry.source === 'system'
  const isImportantAiSummary = (entry: LogEntry) =>
    entry.line.includes('Questions received from') ||
    entry.line.includes('Compiled interview questions from')

  switch (tab) {
    case 'ALL':
      return entries.filter(entry => (entry.audience === 'all' || isError(entry) || isImportantAiSummary(entry)) && !isDebug(entry))
    case 'SYS':
      return entries.filter(e => isSystem(e) && !isDebug(e))
    case 'AI':
      return entries.filter(isFromOpenCode)
    case 'ERROR':
      return entries.filter(isError)
    case 'DEBUG':
      return entries.filter(isDebug)
    default:
      return entries.filter(entry => entry.modelId === tab)
  }
}

export function PhaseLogPanel({ phase, logs: propLogs, ticket }: PhaseLogPanelProps) {
  const logCtx = useLogs()
  const phaseLogs: LogEntry[] = useMemo(
    () => propLogs ?? logCtx?.getLogsForPhase(phase) ?? [],
    [propLogs, logCtx, phase],
  )
  const [activeTab, setActiveTab] = useState<string>('ALL')
  const [modelsCollapsed, setModelsCollapsed] = useState(true)
  const isKnownMultiModelPhase = MULTI_MODEL_PHASES.has(phase)
  const lockedCouncilMembers = ticket?.lockedCouncilMembers ?? null

  // ── Smart auto-scroll ──────────────────────────────────────────────
  const viewportRef = useRef<HTMLDivElement>(null)
  const userScrolledAway = useRef(false)
  const previousViewRef = useRef<string | null>(null)
  const previousVisibleTailRef = useRef<string | null>(null)
  const scrollFrameRef = useRef<number | null>(null)

  const BOTTOM_THRESHOLD = 50 // px from bottom to consider "at bottom"

  // Attach scroll listener directly on the viewport (scroll events don't bubble)
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      userScrolledAway.current = distanceFromBottom > BOTTOM_THRESHOLD
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current)
    }
  }, [])

  const configuredModelIds = useMemo(() => {
    if (!lockedCouncilMembers) return []
    try {
      const parsed = JSON.parse(lockedCouncilMembers) as string[]
      return Array.isArray(parsed) ? parsed.filter(Boolean) : []
    } catch {
      return []
    }
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
  const hasLogs = filteredLogs.length > 0
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

    if (viewChanged) {
      userScrolledAway.current = false
    }

    if (hasLogs && (viewChanged || (visibleTailChanged && !userScrolledAway.current))) {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current)
      }

      scrollFrameRef.current = requestAnimationFrame(() => {
        const el = viewportRef.current
        scrollFrameRef.current = null
        if (!el) return
        el.scrollTo({ top: el.scrollHeight, behavior: viewChanged ? 'auto' : 'smooth' })
      })
    }

    previousViewRef.current = currentView
    previousVisibleTailRef.current = visibleLogTail
  }, [phase, effectiveTab, hasLogs, visibleLogTail])

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-1 py-1.5 flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Log — {getStatusUserLabel(phase)}
        </span>
      </div>
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
        <span className="ml-auto text-xs text-muted-foreground pl-2">{filteredLogs.length} entries</span>
      </div>
      <ScrollArea className="flex-1 min-h-0" viewportRef={viewportRef}>
        <div className="font-mono text-xs bg-muted rounded-md p-3 min-h-[100px]">
          {hasLogs ? (
            filteredLogs.map((entry, i) => (
              <LogEntryRow key={entry.entryId} entry={entry} index={i} />
            ))
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
