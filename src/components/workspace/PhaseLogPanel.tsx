import { useState, useEffect, useMemo } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useLogs, type LogEntry } from '@/context/LogContext'
import { getStatusUserLabel } from '@/lib/workflowMeta'
import type { Ticket } from '@/hooks/useTickets'

interface PhaseLogPanelProps {
  phase: string
  logs?: LogEntry[]
  ticket?: Ticket
}

type LogTab = 'ALL' | 'SYS' | 'AI' | 'ERROR'

const FIXED_TABS: LogTab[] = ['ALL', 'SYS', 'AI', 'ERROR']

function getEntryColor(entry: LogEntry): string {
  if (entry.source === 'error' || entry.line.includes('[ERROR]')) return 'text-red-500'
  if (entry.source === 'opencode' || entry.source.startsWith('model:')) return 'text-green-500'
  return 'text-gray-500'
}

function getModelLabel(modelId: string): string {
  return modelId.split('/').pop() ?? modelId
}

function formatTimestamp(index: number): string {
  const base = new Date()
  base.setSeconds(base.getSeconds() - (index * 2))
  return base.toTimeString().slice(0, 8)
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
  return <>{entry.line}</>
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
  switch (tab) {
    case 'ALL':
      return entries
    case 'SYS':
      return entries.filter(e => e.source === 'system')
    case 'AI':
      return entries.filter(e => e.source === 'opencode' || e.source.startsWith('model:'))
    case 'ERROR':
      return entries.filter(e => e.source === 'error' || e.line.includes('[ERROR]'))
    default:
      // Per-model tab: tab value is a modelId, filter by exact model source
      return entries.filter(e => e.source === `model:${tab}`)
  }
}

export function PhaseLogPanel({ phase, logs: propLogs, ticket }: PhaseLogPanelProps) {
  const logCtx = useLogs()
  const logs: LogEntry[] = propLogs ?? logCtx?.getLogsForPhase(phase) ?? []
  const description = PHASE_LOG_DESCRIPTIONS[phase] ?? 'Processing…'
  const [activeTab, setActiveTab] = useState<string>('ALL')
  const isKnownMultiModelPhase = MULTI_MODEL_PHASES.has(phase)

  const configuredModelIds = useMemo(() => {
    if (!ticket?.lockedCouncilMembers) return []
    try {
      const parsed = JSON.parse(ticket.lockedCouncilMembers) as string[]
      return Array.isArray(parsed) ? parsed.filter(Boolean) : []
    } catch {
      return []
    }
  }, [ticket?.lockedCouncilMembers])

  // Detect model IDs from structured source field
  const detectedModelIds = useMemo(() => {
    const ids = new Set<string>()
    for (const entry of logs) {
      if (entry.source.startsWith('model:')) {
        ids.add(entry.source.slice('model:'.length))
      }
    }
    return Array.from(ids)
  }, [logs])

  const modelTabs = useMemo(() => {
    const hasMultiModelOutput = detectedModelIds.length > 1
    const enableModelTabs = isKnownMultiModelPhase || hasMultiModelOutput
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

  const showModelTabs = modelTabs.length > 1
  const availableTabs: string[] = showModelTabs ? [...FIXED_TABS, ...modelTabs] : [...FIXED_TABS]

  useEffect(() => {
    if (!availableTabs.includes(activeTab)) setActiveTab('ALL')
  }, [activeTab, availableTabs])

  const filteredLogs = filterEntries(logs, activeTab)
  const hasLogs = filteredLogs.length > 0

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-1 py-1.5 flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Log — {getStatusUserLabel(phase)}
        </span>
      </div>
      <div className="text-xs text-muted-foreground px-1 mb-1">{description}</div>
      <div className="flex gap-1 px-1 py-1">
        {availableTabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'px-2 py-0.5 rounded text-xs font-medium',
              activeTab === tab ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
            title={modelTabs.includes(tab) ? tab : undefined}
          >
            {modelTabs.includes(tab) ? getModelLabel(tab) : tab}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">{filteredLogs.length} entries</span>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="font-mono text-xs bg-muted rounded-md p-3 min-h-[100px]">
          {hasLogs ? (
            filteredLogs.map((entry, i) => (
              <div key={i} className="py-0.5 border-b border-border/30 last:border-0 flex">
                <span className="text-muted-foreground/40 mr-2 select-none shrink-0 w-16">{formatTimestamp(filteredLogs.length - i)}</span>
                <span className="text-muted-foreground/60 mr-2 select-none shrink-0">{String(i + 1).padStart(3, ' ')}</span>
                <span className={getEntryColor(entry)}>{renderLogLine(entry)}</span>
              </div>
            ))
          ) : (
            <span className="text-muted-foreground/50 italic">
              {logs.length > 0 ? 'No entries match current filter.' : 'No log entries yet. Logs will stream here during execution.'}
            </span>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
