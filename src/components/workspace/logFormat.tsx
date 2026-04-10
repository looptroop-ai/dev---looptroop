import type { LogEntry } from '@/context/LogContext'
import { getModelDisplayName } from '@/components/shared/modelBadgeUtils'
import { isBenignGitProbeErrorLine } from '@/context/logUtils'

export interface FormattedLogLine {
  tagText: string | null
  tagTitle?: string
  bodyText: string
  visibleText: string
  copyText: string
}

function getEntryFullModelId(entry: LogEntry): string | null {
  if (entry.modelId) return entry.modelId
  return entry.source.startsWith('model:') ? entry.source.slice('model:'.length) : null
}

function getModelKey(entry: LogEntry): string | null {
  return getEntryFullModelId(entry)
}

function getPhaseModelKey(entry: LogEntry): string | null {
  const modelKey = getModelKey(entry)
  return modelKey ? `${entry.status}:${modelKey}` : null
}

function isLegacyTranscriptSummary(entry: LogEntry): boolean {
  return entry.entryId.endsWith(':transcript-summary')
}

function isLegacyDerivedSummary(entry: LogEntry): boolean {
  if (entry.kind !== 'text') return false

  if (
    entry.entryId.endsWith(':questions-preview')
    || entry.entryId.startsWith('compiled-questions:')
    || entry.entryId.startsWith('draft-summary:')
    || entry.entryId.startsWith('prd-draft-summary:')
    || entry.entryId.startsWith('prd-full-answers-summary:')
    || entry.entryId.startsWith('beads-draft-summary:')
    || entry.entryId.startsWith('refined-prd:')
  ) {
    return true
  }

  return entry.line.includes('Questions received from')
    || entry.line.includes('Compiled interview questions from')
}

function isCanonicalAiTextEntry(entry: LogEntry): boolean {
  return entry.audience === 'ai'
    && entry.kind === 'text'
    && !isLegacyTranscriptSummary(entry)
    && !isLegacyDerivedSummary(entry)
}

export function getCanonicalLogEntries(entries: LogEntry[]): LogEntry[] {
  const canonicalSessions = new Set<string>()
  const canonicalPhaseModels = new Set<string>()

  for (const entry of entries) {
    if (!isCanonicalAiTextEntry(entry)) continue
    if (entry.sessionId) canonicalSessions.add(entry.sessionId)
    const phaseModelKey = getPhaseModelKey(entry)
    if (phaseModelKey) canonicalPhaseModels.add(phaseModelKey)
  }

  return entries.filter((entry) => {
    if (isLegacyTranscriptSummary(entry)) {
      return entry.sessionId ? !canonicalSessions.has(entry.sessionId) : true
    }

    if (!isLegacyDerivedSummary(entry)) return true
    const phaseModelKey = getPhaseModelKey(entry)
    return phaseModelKey ? !canonicalPhaseModels.has(phaseModelKey) : true
  })
}

export function getEntryColor(entry: LogEntry): string {
  if (entry.audience === 'debug' || entry.source === 'debug' || entry.line.includes('[DEBUG]')) return 'text-amber-600'
  if (entry.kind === 'error' || entry.source === 'error' || entry.line.includes('[ERROR]')) return 'text-red-500'
  if (entry.line.includes('[CMD]')) return 'text-zinc-500'
  if (entry.kind === 'reasoning') return 'text-purple-400'
  if (entry.kind === 'prompt') return 'text-blue-500'
  if (entry.kind === 'text') return 'text-emerald-600'
  if (entry.audience === 'ai' || entry.source === 'opencode' || entry.source.startsWith('model:')) return 'text-green-500'
  return 'text-foreground'
}

export function formatTimestampString(timestamp?: string): string {
  if (!timestamp) return '--:--:--.---'
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) return '--:--:--.---'
  
  const timeString = parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  
  const ms = parsed.getMilliseconds().toString().padStart(3, '0')
  return `${timeString}.${ms}`
}

export function formatTimestamp(timestamp?: string): React.ReactNode {
  if (!timestamp) return '--:--:--.---'
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) return '--:--:--.---'
  
  const timeString = parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  
  const ms = parsed.getMilliseconds().toString().padStart(3, '0')
  
  return (
    <>
      {timeString}.<span className="opacity-40">{ms}</span>
    </>
  )
}

export function getEntryModelDisplayName(entry: LogEntry): string | null {
  const rawModelId = getEntryFullModelId(entry) ?? ''
  const displayName = rawModelId ? getModelDisplayName(rawModelId) : ''
  return displayName || null
}

function formatTaggedSegment(tag: string, entry: LogEntry, showModelName: boolean): Pick<FormattedLogLine, 'tagText' | 'tagTitle'> {
  const bareTag = tag.slice(1, -1)
  const modelDisplayName = getEntryModelDisplayName(entry)
  const fullModelId = getEntryFullModelId(entry)
  const shouldShowModelName = Boolean(modelDisplayName) && (
    bareTag === 'ERROR'
    || (showModelName && (bareTag === 'MODEL' || bareTag === 'THINKING'))
  )

  if (!shouldShowModelName) {
    return { tagText: tag }
  }

  return {
    tagText: `[${bareTag}-${modelDisplayName}]`,
    ...(fullModelId ? { tagTitle: fullModelId } : {}),
  }
}

function formatCopyText(visibleText: string, entry: LogEntry): string {
  const fullModelId = getEntryFullModelId(entry)
  return fullModelId ? `${visibleText} [model: ${fullModelId}]` : visibleText
}

export function formatVisibleTag(tag: string, entry: LogEntry, showModelName: boolean): string {
  return formatTaggedSegment(tag, entry, showModelName).tagText ?? tag
}

export function formatLogLine(entry: LogEntry, showModelName: boolean): FormattedLogLine {
  const tagMatch = entry.line.match(/^(\[[^\]]+\])([\s\S]*)$/)
  if (tagMatch) {
    const [, rawTag = '', bodyText = ''] = tagMatch
    const { tagText, tagTitle } = formatTaggedSegment(rawTag, entry, showModelName)
    const visibleText = `${tagText}${bodyText}`
    return {
      tagText,
      ...(tagTitle ? { tagTitle } : {}),
      bodyText,
      visibleText,
      copyText: formatCopyText(visibleText, entry),
    }
  }

  if (entry.kind === 'reasoning') {
    const bodyText = ` ${entry.line}`
    const { tagText, tagTitle } = formatTaggedSegment('[THINKING]', entry, showModelName)
    const visibleText = `${tagText}${bodyText}`
    return {
      tagText,
      ...(tagTitle ? { tagTitle } : {}),
      bodyText,
      visibleText,
      copyText: formatCopyText(visibleText, entry),
    }
  }

  return {
    tagText: null,
    bodyText: entry.line,
    visibleText: entry.line,
    copyText: formatCopyText(entry.line, entry),
  }
}

export const isCommand = (entry: LogEntry) => entry.line.includes('[CMD]')
export const isSystem = (entry: LogEntry) => entry.audience === 'all' && entry.source === 'system'

export function filterEntries(entries: LogEntry[], tab: string): LogEntry[] {
  const canonicalEntries = getCanonicalLogEntries(entries)
  const isDebug = (entry: LogEntry) => entry.audience === 'debug' || entry.source === 'debug' || entry.line.includes('[DEBUG]')
  const isError = (entry: LogEntry) => (entry.kind === 'error' || entry.source === 'error' || entry.line.includes('[ERROR]')) && !isBenignGitProbeErrorLine(entry.line)
  const isPrompt = (entry: LogEntry) => entry.kind === 'prompt'
  const isFromOpenCode = (entry: LogEntry) =>
    entry.audience === 'ai' ||
    entry.source === 'opencode' ||
    entry.source.startsWith('model:') ||
    Boolean(entry.modelId) ||
    Boolean(entry.sessionId)
  const isOverviewAiEntry = (entry: LogEntry) =>
    entry.audience === 'ai'
    && ((entry.kind === 'text' && (!entry.streaming || entry.op === 'append')) || isLegacyTranscriptSummary(entry))

  switch (tab) {
    case 'ALL':
      return canonicalEntries.filter(entry => (((entry.audience === 'all' && !isCommand(entry)) || isError(entry) || isPrompt(entry) || isOverviewAiEntry(entry)) && !isDebug(entry)))
    case 'SYS':
      return canonicalEntries.filter(e => isSystem(e) && !isDebug(e))
    case 'CMD':
      return canonicalEntries.filter(e => isSystem(e) && isCommand(e) && !isDebug(e))
    case 'AI':
      return canonicalEntries.filter(isFromOpenCode)
    case 'ERROR':
      return canonicalEntries.filter(isError)
    case 'DEBUG':
      return canonicalEntries.filter(isDebug)
    default:
      return canonicalEntries.filter(entry => entry.modelId === tab)
  }
}

export function filterBeadLogEntries(entries: LogEntry[]): LogEntry[] {
  const canonicalEntries = getCanonicalLogEntries(entries)
  return canonicalEntries.filter(entry =>
    !(entry.audience === 'debug' || entry.source === 'debug' || entry.line.includes('[DEBUG]')),
  )
}

export const PHASE_LOG_DESCRIPTIONS: Record<string, string> = {
  DRAFT: 'Ticket created and waiting to start.',
  SCANNING_RELEVANT_FILES: 'AI reads and extracts relevant source file contents for use as context in subsequent phases.',
  COUNCIL_DELIBERATING: 'Each council model generates an independent interview draft with questions in logical order.',
  COUNCIL_VOTING_INTERVIEW: 'Council members vote on all interview drafts using weighted scoring rubric.',
  COMPILING_INTERVIEW: 'Winning model incorporates best ideas from other drafts into a final normalized question set.',
  WAITING_INTERVIEW_ANSWERS: 'Interview questions presented to user for answers.',
  VERIFYING_INTERVIEW_COVERAGE: 'AI analyzes answers for coverage gaps, may add follow-up questions, and checks interview completeness.',
  WAITING_INTERVIEW_APPROVAL: 'Interview results ready for user review and approval before PRD drafting.',
  DRAFTING_PRD: 'Each council model generates an independent PRD draft with epics and user stories.',
  COUNCIL_VOTING_PRD: 'Council members vote on all PRD drafts using weighted scoring rubric.',
  REFINING_PRD: 'Winning model consolidates the best draft into PRD Candidate v1 using useful ideas from the losing proposals.',
  VERIFYING_PRD_COVERAGE: 'LoopTroop checks the current PRD against the approved interview and, if needed, revises it before checking again.',
  WAITING_PRD_APPROVAL: 'Latest PRD candidate is ready for user review and approval.',
  DRAFTING_BEADS: 'Each council model creates an independent beads breakdown from the PRD.',
  COUNCIL_VOTING_BEADS: 'Council members vote on all beads drafts for best architecture.',
  REFINING_BEADS: 'Winning model consolidates the best beads draft into the final semantic blueprint using useful ideas from the losing proposals.',
  VERIFYING_BEADS_COVERAGE: 'LoopTroop checks the semantic beads blueprint against the approved PRD, revises it if needed, then expands the final version before approval.',
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
