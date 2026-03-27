import type { LogEntry } from '@/context/LogContext'
import { getModelDisplayName } from '@/components/shared/modelBadgeUtils'

export function getEntryColor(entry: LogEntry): string {
  if (entry.audience === 'debug' || entry.source === 'debug' || entry.line.includes('[DEBUG]')) return 'text-amber-600'
  if (entry.kind === 'error' || entry.source === 'error' || entry.line.includes('[ERROR]')) return 'text-red-500'
  if (entry.kind === 'reasoning') return 'text-purple-400'
  if (entry.kind === 'prompt') return 'text-blue-500'
  if (entry.kind === 'text') return 'text-emerald-600'
  if (entry.audience === 'ai' || entry.source === 'opencode' || entry.source.startsWith('model:')) return 'text-green-500'
  return 'text-foreground'
}

export function formatTimestamp(timestamp?: string): string {
  if (!timestamp) return '--:--:--'
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) return '--:--:--'
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

export function getEntryModelDisplayName(entry: LogEntry): string | null {
  const rawModelId = entry.modelId || (entry.source.startsWith('model:') ? entry.source : '')
  const displayName = rawModelId ? getModelDisplayName(rawModelId) : ''
  return displayName || null
}

export function formatVisibleTag(tag: string, entry: LogEntry, showModelName: boolean): string {
  if (!showModelName) return tag

  const bareTag = tag.slice(1, -1)
  if (bareTag !== 'MODEL' && bareTag !== 'THINKING') return tag

  const modelDisplayName = getEntryModelDisplayName(entry)
  return modelDisplayName ? `[${bareTag}-${modelDisplayName}]` : tag
}

export function filterEntries(entries: LogEntry[], tab: string): LogEntry[] {
  const isDebug = (entry: LogEntry) => entry.audience === 'debug' || entry.source === 'debug' || entry.line.includes('[DEBUG]')
  const isError = (entry: LogEntry) => entry.kind === 'error' || entry.source === 'error' || entry.line.includes('[ERROR]')
  const isPrompt = (entry: LogEntry) => entry.kind === 'prompt'
  const isFromOpenCode = (entry: LogEntry) =>
    entry.audience === 'ai' ||
    entry.source === 'opencode' ||
    entry.source.startsWith('model:') ||
    Boolean(entry.modelId) ||
    Boolean(entry.sessionId)
  const isSystem = (entry: LogEntry) => entry.audience === 'all' && entry.source === 'system'
  const isImportantAiSummary = (entry: LogEntry) =>
    entry.entryId?.endsWith(':transcript-summary') ||
    entry.line.includes('Questions received from') ||
    entry.line.includes('Compiled interview questions from')

  switch (tab) {
    case 'ALL':
      return entries.filter(entry => (entry.audience === 'all' || isError(entry) || isPrompt(entry) || isImportantAiSummary(entry)) && !isDebug(entry))
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

export const PHASE_LOG_DESCRIPTIONS: Record<string, string> = {
  DRAFT: 'Ticket created and waiting to start.',
  SCANNING_RELEVANT_FILES: 'AI reads and extracts relevant source file contents for use as context in subsequent phases.',
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
  COMPLETED: 'All phases completed successfully. Candidate branch was verified and cleanup finished.',
  CANCELED: 'Ticket was canceled.',
  BLOCKED_ERROR: 'An error occurred during processing.',
}

export const MULTI_MODEL_PHASES = new Set([
  'COUNCIL_DELIBERATING',
  'COUNCIL_VOTING_INTERVIEW',
  'DRAFTING_PRD',
  'COUNCIL_VOTING_PRD',
  'DRAFTING_BEADS',
  'COUNCIL_VOTING_BEADS',
])
