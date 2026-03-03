import { useState, useEffect } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useLogs } from '@/context/LogContext'
import { getStatusUserLabel } from '@/lib/workflowMeta'

interface PhaseLogPanelProps {
  phase: string
  logs?: string[]
}

type LogLevel = 'ALL' | 'SYS' | 'MODEL' | 'TEST' | 'ERROR' | 'BEAD'

const LOG_LEVEL_COLORS: Record<string, string> = {
  SYS: 'text-gray-500',
  MODEL: 'text-green-500',
  TEST: 'text-blue-500',
  ERROR: 'text-red-500',
  BEAD: 'text-purple-500',
}

function getLogLevel(line: string): string {
  if (line.includes('[SYS]') || line.includes('[sys]')) return 'SYS'
  if (line.includes('[MODEL]') || line.includes('[model]')) return 'MODEL'
  if (line.includes('[TEST]') || line.includes('[test]')) return 'TEST'
  if (line.includes('[ERROR]') || line.includes('[error]') || line.includes('Error')) return 'ERROR'
  if (line.includes('[BEAD]') || line.includes('[bead]') || line.includes('Bead')) return 'BEAD'
  return 'SYS'
}

function getLogColor(line: string): string {
  const level = getLogLevel(line)
  return LOG_LEVEL_COLORS[level] || ''
}

function formatTimestamp(index: number): string {
  const base = new Date()
  base.setSeconds(base.getSeconds() - (index * 2))
  return base.toTimeString().slice(0, 8)
}

// Colorize [TAG] prefixes in a log line
function renderLogLine(line: string) {
  const tagMatch = line.match(/^(\[[\w]+\])(.*)$/)
  if (tagMatch) {
    const tag = tagMatch[1]
    const rest = tagMatch[2]
    const color = getLogColor(line)
    return (
      <>
        <span className={cn('font-semibold', color)}>{tag}</span>
        {rest}
      </>
    )
  }
  return <>{line}</>
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

const CODING_PHASES = new Set(['PRE_FLIGHT_CHECK', 'CODING', 'INTEGRATING_CHANGES', 'CLEANING_ENV', 'WAITING_MANUAL_VERIFICATION'])
const FINAL_TEST_PHASES = new Set(['RUNNING_FINAL_TEST'])

function getAvailableLevels(phase: string): LogLevel[] {
  if (FINAL_TEST_PHASES.has(phase)) return ['ALL', 'SYS', 'TEST', 'ERROR']
  if (CODING_PHASES.has(phase)) return ['ALL', 'SYS', 'MODEL', 'TEST', 'ERROR', 'BEAD']
  return ['ALL', 'SYS', 'MODEL', 'ERROR']
}

export function PhaseLogPanel({ phase, logs: propLogs }: PhaseLogPanelProps) {
  const logCtx = useLogs()
  const logs = propLogs ?? logCtx?.getLogsForPhase(phase) ?? []
  const description = PHASE_LOG_DESCRIPTIONS[phase] ?? 'Processing…'
  const [activeFilter, setActiveFilter] = useState<LogLevel>('ALL')
  const levels: LogLevel[] = getAvailableLevels(phase)

  useEffect(() => {
    if (!levels.includes(activeFilter)) setActiveFilter('ALL')
  }, [phase, levels, activeFilter])

  const filteredLogs = activeFilter === 'ALL'
    ? logs
    : logs.filter(line => getLogLevel(line) === activeFilter)
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
        {levels.map(level => (
          <button
            key={level}
            onClick={() => setActiveFilter(level)}
            className={cn(
              'px-2 py-0.5 rounded text-xs font-medium',
              activeFilter === level ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {level}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">{filteredLogs.length} entries</span>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="font-mono text-xs bg-muted rounded-md p-3 min-h-[100px]">
          {hasLogs ? (
            filteredLogs.map((line, i) => (
              <div key={i} className="py-0.5 border-b border-border/30 last:border-0 flex">
                <span className="text-muted-foreground/40 mr-2 select-none shrink-0 w-16">{formatTimestamp(filteredLogs.length - i)}</span>
                <span className="text-muted-foreground/60 mr-2 select-none shrink-0">{String(i + 1).padStart(3, ' ')}</span>
                <span className={getLogColor(line)}>{renderLogLine(line)}</span>
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
