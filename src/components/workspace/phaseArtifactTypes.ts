import jsYaml from 'js-yaml'
import type { StructuredIntervention } from '@shared/structuredInterventions'
import type { StructuredRetryDiagnostic } from '@shared/structuredRetryDiagnostics'
import { normalizeStructuredRetryDiagnostics } from '@shared/structuredRetryDiagnostics'
import { normalizeStructuredInterventions } from '@shared/structuredInterventions'
import { getModelDisplayName } from '@/components/shared/modelBadgeUtils'
import type { DBartifact } from '@/hooks/useTicketArtifacts'
import {
  mergeCoverageArtifactContent,
  mergeVoteArtifactContent,
  parseArtifactCompanionPayload,
  readWinnerIdFromArtifactContent,
} from './artifactCompanionUtils'
import {
  extractInterviewQuestionPreviews,
  type InterviewQuestionChange,
  type InterviewQuestionChangeAttributionStatus,
} from '@shared/interviewQuestions'
import type { RefinementChange, RefinementChangeAttributionStatus } from '@shared/refinementChanges'
import {
  buildBeadsUiRefinementDiffArtifact,
  buildInterviewUiRefinementDiffArtifact,
  buildPrdUiRefinementDiffArtifact,
  parseUiRefinementDiffArtifact,
} from '@shared/refinementDiffArtifacts'
import type { UiRefinementDiffArtifact } from '@shared/refinementDiffArtifacts'
import {
  buildTextDiffSegments,
  type TextDiffSegment,
} from './textDiffSegments'
export {
  TEXT_DIFF_TOKEN_PATTERN as QUESTION_DIFF_TOKEN_PATTERN,
  tokenizeTextDiff as tokenizeQuestionDiffText,
  mergeTextDiffSegments as mergeQuestionDiffSegments,
} from './textDiffSegments'

export interface ArtifactDef {
  id: string
  label: string
  description: string
  icon: React.ReactNode
}

export interface InterviewAnswerField {
  skipped?: boolean
  free_text?: string
  selected_option_ids?: string[]
}

export interface InterviewArtifactOption {
  id?: string
  label?: string
}

export interface InterviewArtifactQuestion {
  id?: string
  prompt?: string
  answer_type?: string
  options?: InterviewArtifactOption[]
  answer?: InterviewAnswerField
}

export interface InterviewArtifactData {
  artifact?: string
  questions?: InterviewArtifactQuestion[]
  interview?: string
  refinedContent?: string
  userAnswers?: string
}

export interface CoverageInputData {
  interview?: string
  fullAnswers?: string
  prd?: string
  beads?: string
  refinedContent?: string
  changes?: RefinementChange[]
  candidateVersion?: number
}

export interface CoverageGapResolutionItemData {
  itemType: 'epic' | 'user_story' | 'bead'
  id: string
  label: string
}

export interface CoverageGapResolutionData {
  gap: string
  action: 'updated_prd' | 'updated_beads' | 'already_covered' | 'left_unresolved'
  rationale: string
  affectedItems: CoverageGapResolutionItemData[]
}

export interface CoverageAttemptData {
  candidateVersion: number
  status: 'clean' | 'gaps'
  summary: string
  gaps: string[]
  auditNotes: string
  response?: string
  normalizedContent?: string
  structuredOutput?: ArtifactStructuredOutputData
  coverageRunNumber?: number
  maxCoveragePasses?: number
  limitReached?: boolean
  terminationReason?: string | null
}

export interface CoverageTransitionData {
  fromVersion: number
  toVersion: number
  summary: string
  gaps: string[]
  auditNotes: string
  fromContent: string
  toContent: string
  gapResolutions: CoverageGapResolutionData[]
  resolutionNotes: string[]
  uiRefinementDiff?: UiRefinementDiffArtifact | null
  structuredOutput?: ArtifactStructuredOutputData
}

export interface CoverageFollowUpArtifactQuestion {
  id?: string
  question?: string
  prompt?: string
  phase?: string
  priority?: string
  rationale?: string
}

export interface CoverageArtifactData {
  winnerId?: string
  response?: string
  hasGaps?: boolean
  normalizedContent?: string
  coverageRunNumber?: number
  maxCoveragePasses?: number
  limitReached?: boolean
  terminationReason?: string
  followUpBudgetPercent?: number
  followUpBudgetTotal?: number
  followUpBudgetUsed?: number
  followUpBudgetRemaining?: number
  status?: string
  summary?: string
  gaps?: string[]
  auditNotes?: string
  finalCandidateVersion?: number
  attempts?: CoverageAttemptData[]
  transitions?: CoverageTransitionData[]
  hasRemainingGaps?: boolean
  remainingGaps?: string[]
  parsed?: {
    status?: string
    gaps?: string[]
    followUpQuestions?: CoverageFollowUpArtifactQuestion[]
    follow_up_questions?: CoverageFollowUpArtifactQuestion[]
  }
  structuredOutput?: ArtifactStructuredOutputData
}

export interface ArtifactStructuredOutputData {
  repairApplied?: boolean
  repairWarnings?: string[]
  autoRetryCount?: number
  validationError?: string
  retryDiagnostics?: StructuredRetryDiagnostic[]
  interventions?: StructuredIntervention[]
}

export interface CouncilDraftData {
  memberId: string
  outcome?: CouncilOutcome
  content?: string
  duration?: number
  error?: string
  structuredOutput?: ArtifactStructuredOutputData
}

export interface CouncilVoteData {
  voterId: string
  draftId: string
  totalScore: number
  scores: Array<{ category: string; score: number }>
}

export interface VotePresentationOrderData {
  seed: string
  order: string[]
}

export interface CouncilVoterDetailData {
  voterId: string
  structuredOutput?: ArtifactStructuredOutputData
  error?: string
}

export interface CouncilResultData {
  drafts?: CouncilDraftData[]
  votes?: CouncilVoteData[]
  winnerId?: string
  winnerContent?: string
  refinedContent?: string
  voterOutcomes?: Record<string, CouncilOutcome>
  presentationOrders?: Record<string, VotePresentationOrderData>
  voterDetails?: CouncilVoterDetailData[]
}

export interface InterviewDiffArtifactData {
  winnerId?: string
  originalContent?: string
  refinedContent?: string
  originalQuestionCount?: number
  refinedQuestionCount?: number
  questionCount?: number
  questions?: unknown[]
  changes?: InterviewQuestionChange[]
  uiRefinementDiff?: UiRefinementDiffArtifact
  structuredOutput?: ArtifactStructuredOutputData
}

export interface InspirationDiffSource {
  memberId: string
  question: string
  questionId?: string
  phase?: string
}

export interface InterviewDiffEntry {
  key: string
  id: string
  changeType: 'modified' | 'replaced' | 'added' | 'removed'
  phase?: string
  before?: string
  after?: string
  inspiration?: InspirationDiffSource | null
  attributionStatus?: InterviewQuestionChangeAttributionStatus
}

export interface RefinementDiffArtifactData {
  winnerId?: string
  refinedContent?: string
  winnerDraftContent?: string
  coverageBaselineContent?: string
  coverageBaselineVersion?: number
  coverageDiffLabel?: string
  changes?: RefinementChange[]
  uiRefinementDiff?: UiRefinementDiffArtifact
  coverageUiRefinementDiff?: UiRefinementDiffArtifact
  draftMetrics?: {
    epicCount: number
    userStoryCount: number
  }
  structuredOutput?: ArtifactStructuredOutputData
  candidateVersion?: number
  gapResolutions?: CoverageGapResolutionData[]
}

export interface RefinementDiffEntry {
  key: string
  changeType: 'modified' | 'added' | 'removed'
  itemKind: string
  label: string
  beforeId?: string
  afterId?: string
  beforeText?: string
  afterText?: string
  inspiration?: {
    memberId: string
    sourceId?: string
    sourceLabel: string
    sourceText?: string
    blocks?: Array<{
      kind: 'epic' | 'user_story' | 'bead'
      id?: string
      label: string
      text: string
    }>
  } | null
  attributionStatus?: RefinementChangeAttributionStatus
}

export type QuestionDiffSegment = TextDiffSegment

export interface RelevantFileScanEntry {
  path: string
  rationale: string
  relevance: string
  likely_action: string
  contentLength: number
  contentPreview: string
}

export interface RelevantFilesScanData {
  fileCount: number
  files: RelevantFileScanEntry[]
  modelId?: string
  structuredOutput?: ArtifactStructuredOutputData
}

export interface FinalTestCommandResultData {
  command: string
  exitCode: number | null
  signal: string | null
  stdout: string
  stderr: string
  durationMs: number
  timedOut: boolean
}

export interface FinalTestAttemptHistoryEntryData {
  attempt: number
  status: 'passed' | 'failed'
  checkedAt: string
  summary?: string
  commands: string[]
  testFiles: string[]
  errors: string[]
  failureReason?: string
  noteAppended?: string
}

export interface FinalTestExecutionReportData {
  status: 'passed' | 'failed'
  passed: boolean
  checkedAt: string
  plannedBy: string
  summary?: string
  testFiles?: string[]
  testsCount?: number | null
  modelOutput: string
  commands: FinalTestCommandResultData[]
  errors: string[]
  planStructuredOutput?: ArtifactStructuredOutputData
  attempt?: number
  maxIterations?: number | null
  attemptHistory?: FinalTestAttemptHistoryEntryData[]
  retryNotes?: string[]
}

import type { CouncilOutcome, CouncilViewerArtifact } from './councilArtifacts'

export type ViewingArtifact = CouncilViewerArtifact & { icon?: React.ReactNode }
export type ViewingArtifactSelection =
  | { kind: 'member'; key: string }
  | { kind: 'supplemental'; id: string }

// Re-export CouncilOutcome for convenience
export type { CouncilOutcome }

type InterviewDiffAttributionStatus = NonNullable<InterviewQuestionChange['attributionStatus']>
type RefinementDiffAttributionStatus = NonNullable<RefinementChange['attributionStatus']>

export function extractDraftDetail(content: string | null): string {
  if (!content) return ''
  const beadCount = countBeadsInContent(content)
  if (beadCount > 0) return `${beadCount} beads`
  const questionMatch = content.match(/(\d+)\s*(?:questions|Q)/i)
  if (questionMatch) return `proposed ${questionMatch[1]} questions`
  const scoreMatch = content.match(/(\d+\.?\d*)\s*\/\s*10/i)
  if (scoreMatch) return `scored ${scoreMatch[1]}/10`
  const lineCount = content.split('\n').filter(l => l.trim()).length
  if (lineCount > 0) return `${lineCount} lines`
  return ''
}

export function extractCompiledInterviewDetail(content: string | null): string {
  if (!content) return ''
  try {
    const parsed = JSON.parse(content) as {
      winnerId?: string
      questionCount?: number
      questions?: unknown[]
    }
    const count = typeof parsed.questionCount === 'number'
      ? parsed.questionCount
      : Array.isArray(parsed.questions)
        ? parsed.questions.length
        : 0
    const detailParts: string[] = []
    if (parsed.winnerId) detailParts.push(getModelDisplayName(parsed.winnerId))
    if (count > 0) detailParts.push(`${count} question${count === 1 ? '' : 's'}`)
    return detailParts.join(' · ')
  } catch {
    return ''
  }
}

export function tryParseStructuredContent(content: string | null | undefined): unknown {
  if (!content?.trim()) return null

  try {
    return JSON.parse(content)
  } catch {
    try {
      return jsYaml.load(content)
    } catch {
      return null
    }
  }
}

function countBeadsInContent(content: string): number {
  const parsed = tryParseStructuredContent(content)
  if (Array.isArray(parsed)) return parsed.length
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray((parsed as { beads?: unknown[] }).beads)) {
    return (parsed as { beads: unknown[] }).beads.length
  }
  if (parsed !== null) return 0

  const trimmed = content.trim()
  if (trimmed.startsWith('{')) {
    try {
      return trimmed
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as unknown)
        .length
    } catch {
      // Ignore malformed JSONL and fall back to line-based counting.
    }
  }

  return (content.match(/^\s*-\s+id\s*:/gm) ?? []).length
}

export function extractCanonicalInterviewDetail(content: string | null): string {
  const parsed = tryParseStructuredContent(content)
  if (!parsed || typeof parsed !== 'object') return ''

  const artifact = parsed as InterviewArtifactData
  if (typeof artifact.interview === 'string' && artifact.interview.trim()) {
    return extractCanonicalInterviewDetail(artifact.interview)
  }

  if (artifact.artifact !== 'interview' || !Array.isArray(artifact.questions)) {
    return ''
  }

  const count = artifact.questions.length
  return count > 0 ? `${count} question${count === 1 ? '' : 's'}` : ''
}

export function normalizeInterviewDiffQuestions(content: string | undefined): Array<{ id: string; phase?: string; question: string }> {
  return extractInterviewQuestionPreviews(content ?? '')
    .map((question, index) => ({
      id: question.id || `Q${String(index + 1).padStart(2, '0')}`,
      phase: question.phase,
      question: question.question,
    }))
}

export function normalizeInterviewDiffQuestionRecord(value: unknown, fallbackIndex: number): { id: string; phase?: string; question: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' && record.id.trim()
    ? record.id.trim()
    : `Q${String(fallbackIndex + 1).padStart(2, '0')}`
  const phase = typeof record.phase === 'string' && record.phase.trim()
    ? record.phase.trim()
    : undefined
  const question = typeof record.question === 'string' ? record.question.trim() : ''

  if (!question) return null

  return { id, phase, question }
}

function normalizeInterviewDiffAttributionStatus(value: unknown): InterviewDiffAttributionStatus | undefined {
  if (
    value === 'inspired'
    || value === 'model_unattributed'
    || value === 'synthesized_unattributed'
    || value === 'invalid_unattributed'
  ) {
    return value
  }
  return undefined
}

function normalizeRefinementDiffAttributionStatus(value: unknown): RefinementDiffAttributionStatus | undefined {
  if (
    value === 'inspired'
    || value === 'model_unattributed'
    || value === 'synthesized_unattributed'
    || value === 'invalid_unattributed'
  ) {
    return value
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeUiRefinementDiff(value: unknown): UiRefinementDiffArtifact | undefined {
  if (typeof value === 'string') {
    return parseUiRefinementDiffArtifact(value) ?? undefined
  }
  if (!isRecord(value)) return undefined
  return parseUiRefinementDiffArtifact(JSON.stringify(value)) ?? undefined
}

export function normalizeArtifactStructuredOutput(value: unknown): ArtifactStructuredOutputData | undefined {
  if (!isRecord(value)) return undefined

  const repairApplied = typeof value.repairApplied === 'boolean' ? value.repairApplied : false
  const repairWarnings = Array.isArray(value.repairWarnings)
    ? value.repairWarnings.filter((warning): warning is string => typeof warning === 'string')
    : []
  const autoRetryCount = typeof value.autoRetryCount === 'number' && Number.isInteger(value.autoRetryCount)
    ? value.autoRetryCount
    : 0
  const validationError = typeof value.validationError === 'string' && value.validationError.trim()
    ? value.validationError
    : undefined
  const retryDiagnostics = normalizeStructuredRetryDiagnostics(value.retryDiagnostics)
  const interventions = normalizeStructuredInterventions(value.interventions)

  return {
    repairApplied,
    repairWarnings,
    autoRetryCount,
    ...(validationError ? { validationError } : {}),
    ...(retryDiagnostics.length > 0 ? { retryDiagnostics } : {}),
    ...(interventions.length > 0 ? { interventions } : {}),
  }
}

export function normalizeRefinementDraftMetrics(
  value: unknown,
): RefinementDiffArtifactData['draftMetrics'] | undefined {
  if (!isRecord(value)) return undefined

  const epicCount = typeof value.epicCount === 'number' && Number.isInteger(value.epicCount)
    ? value.epicCount
    : null
  const userStoryCount = typeof value.userStoryCount === 'number' && Number.isInteger(value.userStoryCount)
    ? value.userStoryCount
    : null

  if (epicCount == null || userStoryCount == null) {
    return undefined
  }

  return { epicCount, userStoryCount }
}

function normalizeCandidateVersion(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined
}

function normalizeCoverageGapResolutionItem(value: unknown): CoverageGapResolutionItemData | null {
  if (!isRecord(value)) return null
  const itemType = value.itemType === 'epic' || value.itemType === 'user_story' || value.itemType === 'bead'
    ? value.itemType
    : value.item_type === 'epic' || value.item_type === 'user_story' || value.item_type === 'bead'
      ? value.item_type
      : null
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  const label = typeof value.label === 'string' ? value.label.trim() : ''
  if (!itemType || !id || !label) return null
  return { itemType, id, label }
}

function normalizeCoverageGapResolutions(value: unknown): CoverageGapResolutionData[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const gap = typeof entry.gap === 'string' ? entry.gap.trim() : ''
    const action = entry.action === 'updated_prd'
      || entry.action === 'updated_beads'
      || entry.action === 'already_covered'
      || entry.action === 'left_unresolved'
      ? entry.action
      : null
    const rationale = typeof entry.rationale === 'string' ? entry.rationale.trim() : ''
    if (!gap || !action || !rationale) return []
    const rawItems = Array.isArray(entry.affectedItems)
      ? entry.affectedItems
      : Array.isArray(entry.affected_items)
        ? entry.affected_items
        : []
    return [{
      gap,
      action,
      rationale,
      affectedItems: rawItems
        .map((item) => normalizeCoverageGapResolutionItem(item))
        .filter((item): item is CoverageGapResolutionItemData => Boolean(item)),
    }]
  })
}

function buildRefinementCoveragePayload(
  coverageArtifact: CoverageArtifactData | null,
): Partial<CoverageArtifactData> {
  if (!coverageArtifact) return {}

  return {
    response: coverageArtifact.response,
    hasGaps: coverageArtifact.hasGaps,
    normalizedContent: coverageArtifact.normalizedContent,
    coverageRunNumber: coverageArtifact.coverageRunNumber,
    maxCoveragePasses: coverageArtifact.maxCoveragePasses,
    limitReached: coverageArtifact.limitReached,
    terminationReason: coverageArtifact.terminationReason,
    followUpBudgetPercent: coverageArtifact.followUpBudgetPercent,
    followUpBudgetTotal: coverageArtifact.followUpBudgetTotal,
    followUpBudgetUsed: coverageArtifact.followUpBudgetUsed,
    followUpBudgetRemaining: coverageArtifact.followUpBudgetRemaining,
    status: coverageArtifact.status,
    summary: coverageArtifact.summary,
    gaps: coverageArtifact.gaps,
    auditNotes: coverageArtifact.auditNotes,
    finalCandidateVersion: coverageArtifact.finalCandidateVersion,
    attempts: coverageArtifact.attempts,
    transitions: coverageArtifact.transitions,
    hasRemainingGaps: coverageArtifact.hasRemainingGaps,
    remainingGaps: coverageArtifact.remainingGaps,
    parsed: coverageArtifact.parsed,
  }
}

export function parseRefinementArtifact(content: string): RefinementDiffArtifactData | null {
  const parsed = tryParseStructuredContent(content)
  if (!isRecord(parsed)) return null

  const refinedContent = typeof parsed.refinedContent === 'string' ? parsed.refinedContent : ''
  if (!refinedContent.trim()) return null

  return {
    winnerId: typeof parsed.winnerId === 'string' ? parsed.winnerId : undefined,
    refinedContent,
    winnerDraftContent: typeof parsed.winnerDraftContent === 'string' ? parsed.winnerDraftContent : undefined,
    coverageBaselineContent: typeof parsed.coverageBaselineContent === 'string' ? parsed.coverageBaselineContent : undefined,
    coverageBaselineVersion: normalizeCandidateVersion(parsed.coverageBaselineVersion),
    coverageDiffLabel: typeof parsed.coverageDiffLabel === 'string' && parsed.coverageDiffLabel.trim()
      ? parsed.coverageDiffLabel
      : undefined,
    changes: Array.isArray(parsed.changes) ? parsed.changes as RefinementChange[] : [],
    uiRefinementDiff: normalizeUiRefinementDiff(parsed.uiRefinementDiff),
    coverageUiRefinementDiff: normalizeUiRefinementDiff(parsed.coverageUiRefinementDiff),
    draftMetrics: normalizeRefinementDraftMetrics(parsed.draftMetrics),
    structuredOutput: normalizeArtifactStructuredOutput(parsed.structuredOutput),
    candidateVersion: normalizeCandidateVersion(parsed.candidateVersion),
    gapResolutions: normalizeCoverageGapResolutions(parsed.gapResolutions ?? parsed.gap_resolutions),
  }
}

function extractLegacySynthesizedInterviewIds(repairWarnings: string[] | undefined): Set<string> {
  const synthesizedIds = new Set<string>()
  for (const warning of repairWarnings ?? []) {
    const match = warning.match(/Synthesized omitted interview refinement modified change for (\S+)/i)
    if (match?.[1]) synthesizedIds.add(match[1])
  }
  return synthesizedIds
}

function shouldSuppressNoOpUiDiffEntry(
  changeType: string,
  beforeText: string | undefined,
  afterText: string | undefined,
): boolean {
  if (changeType !== 'modified' && changeType !== 'replaced') return false
  if (typeof beforeText !== 'string' || typeof afterText !== 'string') return false
  return beforeText.trim() === afterText.trim()
}

export function buildInterviewDiffEntries(content: string | undefined): InterviewDiffEntry[] {
  if (!content) return []
  try {
    const parsed = JSON.parse(content) as InterviewDiffArtifactData
    if (parsed.uiRefinementDiff?.domain === 'interview') {
      const phaseLookup = new Map(
        [...normalizeInterviewDiffQuestions(parsed.originalContent), ...normalizeInterviewDiffQuestions(parsed.refinedContent)]
          .map((question) => [question.id, question.phase] as const),
      )
      return parsed.uiRefinementDiff.entries.flatMap((entry, index) => {
        const id = entry.afterId || entry.beforeId || `Q${String(index + 1).padStart(2, '0')}`
        const inspiration: InspirationDiffSource | null = entry.inspiration
          ? {
              memberId: entry.inspiration.memberId,
              question: entry.inspiration.sourceText ?? entry.inspiration.sourceLabel,
              questionId: entry.inspiration.sourceId,
            }
          : null
        if (shouldSuppressNoOpUiDiffEntry(entry.changeType, entry.beforeText, entry.afterText)) {
          return []
        }

        return [{
          key: entry.key,
          id,
          changeType: entry.changeType,
          phase: phaseLookup.get(id),
          before: entry.beforeText,
          after: entry.afterText,
          ...(inspiration ? { inspiration } : {}),
          attributionStatus: normalizeInterviewDiffAttributionStatus(entry.attributionStatus) ?? 'model_unattributed',
        }]
      })
    }
    if (Array.isArray(parsed.changes)) {
      const synthesizedIds = extractLegacySynthesizedInterviewIds(parsed.structuredOutput?.repairWarnings)
      return parsed.changes.flatMap((change, index) => {
        const normalizedType = typeof change?.type === 'string' ? change.type.toLowerCase() : ''
        if (
          normalizedType !== 'modified'
          && normalizedType !== 'replaced'
          && normalizedType !== 'added'
          && normalizedType !== 'removed'
        ) {
          return []
        }

        const before = normalizeInterviewDiffQuestionRecord(change.before, index)
        const after = normalizeInterviewDiffQuestionRecord(change.after, index)
        const id = after?.id || before?.id || `Q${String(index + 1).padStart(2, '0')}`
        const phase = after?.phase || before?.phase
        const beforeText = before?.question
        const afterText = after?.question

        const inspiration: InspirationDiffSource | null | undefined = change.inspiration
          ? {
              memberId: change.inspiration.memberId ?? '',
              question: change.inspiration.question?.question ?? '',
              questionId: change.inspiration.question?.id,
              phase: change.inspiration.question?.phase,
            }
          : change.inspiration === null ? null : undefined
        const attributionStatus = normalizeInterviewDiffAttributionStatus(change.attributionStatus)
          ?? (inspiration
            ? 'inspired'
            : synthesizedIds.has(id)
              ? 'synthesized_unattributed'
              : 'model_unattributed')
        if (shouldSuppressNoOpUiDiffEntry(normalizedType, beforeText, afterText)) {
          return []
        }

        return [{
          key: `${id}:${normalizedType}:${index}`,
          id,
          changeType: normalizedType as InterviewDiffEntry['changeType'],
          phase,
          before: beforeText,
          after: afterText,
          ...(inspiration !== undefined ? { inspiration } : {}),
          attributionStatus,
        }]
      })
    }

    if (!parsed.originalContent || !parsed.refinedContent) return []

    return buildInterviewUiRefinementDiffArtifact({
      winnerId: parsed.winnerId ?? '',
      winnerDraftContent: parsed.originalContent,
      refinedContent: parsed.refinedContent,
    }).entries.map((entry, index) => ({
      key: entry.key,
      id: entry.afterId || entry.beforeId || `Q${String(index + 1).padStart(2, '0')}`,
      changeType: entry.changeType,
      before: entry.beforeText,
      after: entry.afterText,
      inspiration: entry.inspiration
        ? {
            memberId: entry.inspiration.memberId,
            question: entry.inspiration.sourceText ?? entry.inspiration.sourceLabel,
            questionId: entry.inspiration.sourceId,
          }
        : null,
      attributionStatus: normalizeInterviewDiffAttributionStatus(entry.attributionStatus) ?? 'model_unattributed',
    }))
  } catch {
    return []
  }
}

export const buildQuestionDiffSegments = buildTextDiffSegments

export function buildFinalInterviewArtifactContent(
  voteContent: string | null | undefined,
  compiledContent: string | null | undefined,
  uiDiffContent?: string | null | undefined,
  compiledCompanionContent?: string | null | undefined,
  winnerArtifactContent?: string | null | undefined,
): string | null {
  if (!compiledContent) return null
  try {
    const compiled = JSON.parse(compiledContent) as {
      refinedContent?: string
      questionCount?: number
      questions?: unknown[]
      winnerId?: string
      changes?: unknown
      uiRefinementDiff?: unknown
      structuredOutput?: ArtifactStructuredOutputData
    }
    const compiledCompanion = parseArtifactCompanionPayload(compiledCompanionContent, 'interview_compiled')
    const refinedContent = typeof compiled.refinedContent === 'string' ? compiled.refinedContent : ''
    if (!refinedContent) return null

    const mergedVoteContent = mergeVoteArtifactContent(voteContent)
    const voteResult = mergedVoteContent ? tryParseCouncilResult(mergedVoteContent) : null
    const winnerId = compiled.winnerId
      ?? (typeof compiledCompanion?.winnerId === 'string' ? compiledCompanion.winnerId : undefined)
      ?? readWinnerIdFromArtifactContent(winnerArtifactContent)
      ?? voteResult?.winnerId
    const winnerDraft = voteResult?.winnerId
      ? (voteResult.drafts ?? []).find((draft) => draft.memberId === voteResult.winnerId)
      : null

    const payload: InterviewDiffArtifactData = {
      winnerId,
      originalContent: winnerDraft?.content,
      refinedContent,
      originalQuestionCount: winnerDraft?.content
        ? normalizeInterviewDiffQuestions(winnerDraft.content).length
        : undefined,
      refinedQuestionCount: typeof compiled.questionCount === 'number'
        ? compiled.questionCount
        : Array.isArray(compiled.questions)
          ? compiled.questions.length
          : typeof compiledCompanion?.questionCount === 'number'
            ? compiledCompanion.questionCount
          : normalizeInterviewDiffQuestions(refinedContent).length,
      questionCount: typeof compiled.questionCount === 'number'
        ? compiled.questionCount
        : Array.isArray(compiled.questions)
          ? compiled.questions.length
          : typeof compiledCompanion?.questionCount === 'number'
            ? compiledCompanion.questionCount
          : normalizeInterviewDiffQuestions(refinedContent).length,
      questions: Array.isArray(compiled.questions)
        ? compiled.questions
        : Array.isArray(compiledCompanion?.questions)
          ? compiledCompanion.questions
          : undefined,
      changes: Object.prototype.hasOwnProperty.call(compiled, 'changes') && Array.isArray(compiled.changes)
        ? compiled.changes as InterviewQuestionChange[]
        : undefined,
      uiRefinementDiff: normalizeUiRefinementDiff(compiled.uiRefinementDiff) ?? normalizeUiRefinementDiff(uiDiffContent),
      structuredOutput: compiled.structuredOutput ?? normalizeArtifactStructuredOutput(compiledCompanion?.structuredOutput),
    }
    return JSON.stringify(payload)
  } catch {
    return null
  }
}

export function buildFinalRefinementArtifactContent(
  refinedContent: string | null | undefined,
  uiDiffContent?: string | null | undefined,
  coverageInputContent?: string | null | undefined,
  refinedCompanionContent?: string | null | undefined,
  winnerArtifactContent?: string | null | undefined,
  latestRevisionContent?: string | null | undefined,
  coverageArtifactContent?: string | null | undefined,
): string | null {
  const refinedArtifact = refinedContent ? parseRefinementArtifact(refinedContent) : null
  const latestRevisionArtifact = latestRevisionContent ? parseRefinementArtifact(latestRevisionContent) : null
  const coverageArtifact = coverageArtifactContent ? parseCoverageArtifact(coverageArtifactContent) : null
  const coverageTransitions = coverageArtifact?.transitions ?? []
  const firstCoverageTransition = coverageTransitions[0]
  const latestCoverageTransition = coverageTransitions[coverageTransitions.length - 1]
  const hasCoverageTransitions = Boolean(firstCoverageTransition?.fromContent && latestCoverageTransition?.toContent)
  const coverageInput = coverageInputContent ? tryParseStructuredContent(coverageInputContent) : null
  const coverageRecord = isRecord(coverageInput) ? coverageInput : null
  const refinedCompanion = parseArtifactCompanionPayload(refinedCompanionContent)
  const sourceArtifact = latestRevisionArtifact ?? refinedArtifact
  const coveragePayload = buildRefinementCoveragePayload(coverageArtifact)

  const nextRefinedContent = latestCoverageTransition?.toContent
    ?? latestRevisionArtifact?.refinedContent
    ?? (typeof coverageRecord?.refinedContent === 'string'
      ? coverageRecord.refinedContent
      : typeof coverageRecord?.prd === 'string'
        ? coverageRecord.prd
        : sourceArtifact?.refinedContent ?? '')
  if (!nextRefinedContent.trim()) return null

  // Coverage views should show the current artifact under review, not reuse the
  // earlier winner-to-refined diff when no coverage-driven revision exists yet.
  if (coverageRecord && !hasCoverageTransitions && !latestRevisionArtifact) {
    const payload: RefinementDiffArtifactData & CoverageInputData = {
      ...coveragePayload,
      ...(coverageRecord as CoverageInputData),
      winnerId: sourceArtifact?.winnerId ?? readWinnerIdFromArtifactContent(winnerArtifactContent),
      refinedContent: nextRefinedContent,
      candidateVersion: typeof coverageRecord.candidateVersion === 'number'
        ? coverageRecord.candidateVersion
        : sourceArtifact?.candidateVersion,
    }

    return JSON.stringify(payload)
  }

  const payload: RefinementDiffArtifactData & CoverageInputData = {
    ...coveragePayload,
    ...(coverageRecord ? coverageRecord as CoverageInputData : {}),
    winnerId: sourceArtifact?.winnerId ?? readWinnerIdFromArtifactContent(winnerArtifactContent),
    refinedContent: nextRefinedContent,
    ...(hasCoverageTransitions
      ? {
          coverageBaselineContent: firstCoverageTransition?.fromContent,
          coverageBaselineVersion: firstCoverageTransition?.fromVersion,
          coverageDiffLabel: 'Diff vs v1',
          coverageUiRefinementDiff: latestCoverageTransition?.uiRefinementDiff ?? undefined,
        }
      : {
          winnerDraftContent: sourceArtifact?.winnerDraftContent
      ?? (typeof refinedCompanion?.winnerDraftContent === 'string' ? refinedCompanion.winnerDraftContent : undefined),
          changes: sourceArtifact?.changes,
          uiRefinementDiff: sourceArtifact?.uiRefinementDiff ?? normalizeUiRefinementDiff(uiDiffContent),
        }),
    draftMetrics: sourceArtifact?.draftMetrics ?? normalizeRefinementDraftMetrics(refinedCompanion?.draftMetrics),
    structuredOutput: sourceArtifact?.structuredOutput
      ?? normalizeArtifactStructuredOutput(refinedCompanion?.structuredOutput)
      ?? coverageArtifact?.structuredOutput,
    candidateVersion: coverageArtifact?.finalCandidateVersion
      ?? latestRevisionArtifact?.candidateVersion
      ?? (typeof coverageRecord?.candidateVersion === 'number'
        ? coverageRecord.candidateVersion
        : sourceArtifact?.candidateVersion),
    gapResolutions: sourceArtifact?.gapResolutions,
  }

  return JSON.stringify(payload)
}

export function buildCoverageArtifactContent(
  coverageContent: string | null | undefined,
  coverageCompanionContent?: string | null | undefined,
): string | null {
  return mergeCoverageArtifactContent(coverageContent, coverageCompanionContent)
}

export function normalizeCoverageFollowUpArtifacts(questions: unknown): CoverageFollowUpArtifactQuestion[] {
  if (!Array.isArray(questions)) return []
  return questions
    .filter((question): question is CoverageFollowUpArtifactQuestion => Boolean(question) && typeof question === 'object')
    .map((question) => ({
      id: typeof question.id === 'string' ? question.id : undefined,
      question: typeof question.question === 'string'
        ? question.question
        : typeof question.prompt === 'string'
          ? question.prompt
          : undefined,
      phase: typeof question.phase === 'string' ? question.phase : undefined,
      priority: typeof question.priority === 'string' ? question.priority : undefined,
      rationale: typeof question.rationale === 'string' ? question.rationale : undefined,
    }))
    .filter((question) => Boolean(question.question?.trim()))
}

export function parseCoverageArtifact(content: string): CoverageArtifactData | null {
  const parsed = tryParseStructuredContent(content)
  if (!parsed || typeof parsed !== 'object') return null

  const result = parsed as Record<string, unknown>
  if (
    !('response' in result)
    && !('hasGaps' in result)
    && !('winnerId' in result)
    && !('parsed' in result)
    && !('normalizedContent' in result)
    && !('attempts' in result)
    && !('transitions' in result)
    && !('status' in result)
  ) {
    return null
  }

  const parsedCoverage = isRecord(result.parsed)
    ? {
        status: typeof result.parsed.status === 'string' ? result.parsed.status : undefined,
        gaps: Array.isArray(result.parsed.gaps)
          ? result.parsed.gaps.filter((gap): gap is string => typeof gap === 'string' && gap.trim().length > 0)
          : undefined,
        followUpQuestions: normalizeCoverageFollowUpArtifacts(result.parsed.followUpQuestions),
        follow_up_questions: normalizeCoverageFollowUpArtifacts(result.parsed.follow_up_questions),
      }
    : undefined

  return {
    winnerId: typeof result.winnerId === 'string' ? result.winnerId : undefined,
    response: typeof result.response === 'string' ? result.response : undefined,
    hasGaps: typeof result.hasGaps === 'boolean' ? result.hasGaps : undefined,
    normalizedContent: typeof result.normalizedContent === 'string' ? result.normalizedContent : undefined,
    coverageRunNumber: typeof result.coverageRunNumber === 'number' ? result.coverageRunNumber : undefined,
    maxCoveragePasses: typeof result.maxCoveragePasses === 'number' ? result.maxCoveragePasses : undefined,
    limitReached: typeof result.limitReached === 'boolean' ? result.limitReached : undefined,
    terminationReason: typeof result.terminationReason === 'string' ? result.terminationReason : undefined,
    followUpBudgetPercent: typeof result.followUpBudgetPercent === 'number' ? result.followUpBudgetPercent : undefined,
    followUpBudgetTotal: typeof result.followUpBudgetTotal === 'number' ? result.followUpBudgetTotal : undefined,
    followUpBudgetUsed: typeof result.followUpBudgetUsed === 'number' ? result.followUpBudgetUsed : undefined,
    followUpBudgetRemaining: typeof result.followUpBudgetRemaining === 'number' ? result.followUpBudgetRemaining : undefined,
    status: typeof result.status === 'string' ? result.status : parsedCoverage?.status,
    summary: typeof result.summary === 'string' ? result.summary : undefined,
    gaps: Array.isArray(result.gaps)
      ? result.gaps.filter((gap): gap is string => typeof gap === 'string' && gap.trim().length > 0)
      : parsedCoverage?.gaps,
    auditNotes: typeof result.auditNotes === 'string' ? result.auditNotes : undefined,
    finalCandidateVersion: normalizeCandidateVersion(result.finalCandidateVersion),
    attempts: Array.isArray(result.attempts)
      ? result.attempts.flatMap((attempt) => {
          if (!isRecord(attempt)) return []
          const candidateVersion = normalizeCandidateVersion(attempt.candidateVersion)
          const status = attempt.status === 'clean' || attempt.status === 'gaps' ? attempt.status : null
          const summary = typeof attempt.summary === 'string' ? attempt.summary.trim() : ''
          const auditNotes = typeof attempt.auditNotes === 'string' ? attempt.auditNotes : ''
          if (!candidateVersion || !status || !summary) return []
          return [{
            candidateVersion,
            status,
            summary,
            gaps: Array.isArray(attempt.gaps)
              ? attempt.gaps.filter((gap): gap is string => typeof gap === 'string' && gap.trim().length > 0)
              : [],
            auditNotes,
            response: typeof attempt.response === 'string' ? attempt.response : undefined,
            normalizedContent: typeof attempt.normalizedContent === 'string' ? attempt.normalizedContent : undefined,
            structuredOutput: normalizeArtifactStructuredOutput(attempt.structuredOutput),
            coverageRunNumber: typeof attempt.coverageRunNumber === 'number' ? attempt.coverageRunNumber : undefined,
            maxCoveragePasses: typeof attempt.maxCoveragePasses === 'number' ? attempt.maxCoveragePasses : undefined,
            limitReached: typeof attempt.limitReached === 'boolean' ? attempt.limitReached : undefined,
            terminationReason: typeof attempt.terminationReason === 'string' ? attempt.terminationReason : null,
          } satisfies CoverageAttemptData]
        })
      : undefined,
    transitions: Array.isArray(result.transitions)
      ? result.transitions.flatMap((transition) => {
          if (!isRecord(transition)) return []
          const fromVersion = normalizeCandidateVersion(transition.fromVersion)
          const toVersion = normalizeCandidateVersion(transition.toVersion)
          const summary = typeof transition.summary === 'string' ? transition.summary.trim() : ''
          const auditNotes = typeof transition.auditNotes === 'string' ? transition.auditNotes : ''
          const fromContent = typeof transition.fromContent === 'string' ? transition.fromContent : ''
          const toContent = typeof transition.toContent === 'string' ? transition.toContent : ''
          if (!fromVersion || !toVersion || !summary || !fromContent.trim() || !toContent.trim()) return []
          return [{
            fromVersion,
            toVersion,
            summary,
            gaps: Array.isArray(transition.gaps)
              ? transition.gaps.filter((gap): gap is string => typeof gap === 'string' && gap.trim().length > 0)
              : [],
            auditNotes,
            fromContent,
            toContent,
            gapResolutions: normalizeCoverageGapResolutions(transition.gapResolutions ?? transition.gap_resolutions) ?? [],
            resolutionNotes: Array.isArray(transition.resolutionNotes)
              ? transition.resolutionNotes.filter((note): note is string => typeof note === 'string' && note.trim().length > 0)
              : [],
            uiRefinementDiff: normalizeUiRefinementDiff(transition.uiRefinementDiff) ?? undefined,
            structuredOutput: normalizeArtifactStructuredOutput(transition.structuredOutput),
          } satisfies CoverageTransitionData]
        })
      : undefined,
    hasRemainingGaps: typeof result.hasRemainingGaps === 'boolean' ? result.hasRemainingGaps : undefined,
    remainingGaps: Array.isArray(result.remainingGaps)
      ? result.remainingGaps.filter((gap): gap is string => typeof gap === 'string' && gap.trim().length > 0)
      : undefined,
    parsed: parsedCoverage,
    structuredOutput: normalizeArtifactStructuredOutput(result.structuredOutput),
  }
}

export function tryParseCouncilResult(content: string): CouncilResultData | null {
  try {
    const parsed = JSON.parse(content) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const result = parsed as CouncilResultData
    if (result.drafts || result.votes || result.winnerId) return result
    return null
  } catch {
    return null
  }
}

export function parseInterviewQuestions(content: string): { q: string; section?: string }[] {
  return extractInterviewQuestionPreviews(content)
    .map((question) => ({
      q: question.question,
      section: question.phase,
    }))
}

export function getArtifactTargetPhases(phase: string): string[] {
  const phaseMap: Record<string, string[]> = {
    WAITING_INTERVIEW_ANSWERS: ['WAITING_INTERVIEW_ANSWERS', 'COMPILING_INTERVIEW'],
    VERIFYING_INTERVIEW_COVERAGE: ['VERIFYING_INTERVIEW_COVERAGE', 'WAITING_INTERVIEW_ANSWERS', 'COMPILING_INTERVIEW'],
    WAITING_INTERVIEW_APPROVAL: ['VERIFYING_INTERVIEW_COVERAGE', 'WAITING_INTERVIEW_ANSWERS', 'COMPILING_INTERVIEW'],
    WAITING_PRD_APPROVAL: ['VERIFYING_PRD_COVERAGE', 'REFINING_PRD'],
    WAITING_BEADS_APPROVAL: ['VERIFYING_BEADS_COVERAGE', 'REFINING_BEADS'],
    WAITING_MANUAL_VERIFICATION: ['WAITING_MANUAL_VERIFICATION', 'INTEGRATING_CHANGES', 'RUNNING_FINAL_TEST', 'CODING'],
  }

  return phaseMap[phase] || [phase]
}

export function resolveStaticArtifact(
  artifactDef: ArtifactDef,
  phase: string,
  reversedArtifacts: DBartifact[],
): DBartifact | undefined {
  const targetPhases = getArtifactTargetPhases(phase)
  const findExactType = (artifactType: string) =>
    reversedArtifacts.find(artifact => targetPhases.includes(artifact.phase) && artifact.artifactType === artifactType)
  const findByPredicate = (predicate: (artifact: DBartifact) => boolean) =>
    reversedArtifacts.find(artifact => targetPhases.includes(artifact.phase) && predicate(artifact))

  switch (artifactDef.id) {
    case 'winner-draft':
      return findExactType('interview_votes')
    case 'vote-details':
      if (phase.includes('PRD')) return findExactType('prd_votes')
      if (phase.includes('BEADS')) return findExactType('beads_votes')
      return findExactType('interview_votes')
    case 'final-interview':
      if (phase === 'VERIFYING_INTERVIEW_COVERAGE' || phase === 'WAITING_INTERVIEW_APPROVAL') {
        return findExactType('interview_coverage_input') ?? findExactType('interview_compiled')
      }
      return findExactType('interview_compiled')
    case 'winner-prd-draft':
      return findExactType('prd_votes')
    case 'winner-beads-draft':
      return findExactType('beads_votes')
    case 'interview-answers':
      if (phase === 'VERIFYING_INTERVIEW_COVERAGE' || phase === 'WAITING_INTERVIEW_APPROVAL') {
        return findExactType('interview_coverage_input')
      }
      return findExactType('interview_session')
    case 'refined-prd':
      return findExactType('prd_coverage_revision') ?? findExactType('prd_coverage_input') ?? findExactType('prd_refined')
    case 'final-prd-draft':
      return findExactType('prd_refined')
    case 'coverage-report':
      return phase.includes('BEADS')
        ? findExactType('beads_coverage') ?? findExactType('beads_coverage_revision')
        : findExactType('prd_coverage') ?? findExactType('prd_coverage_revision')
    case 'refined-beads':
      return findExactType('beads_coverage_revision') ?? findExactType('beads_coverage_input') ?? findExactType('beads_expanded') ?? findExactType('beads_refined')
    case 'final-beads-draft':
      return findExactType('beads_expanded') ?? findExactType('beads_refined')
    case 'relevant-files-scan':
      return findExactType('relevant_files_scan')
    case 'diagnostics':
      return findExactType('preflight_report')
    case 'bead-commits':
      return findByPredicate(artifact => artifact.artifactType.startsWith('bead_diff:'))
    case 'test-results':
      return findExactType('final_test_report')
    case 'commit-summary':
      return findExactType('integration_report')
    case 'cleanup-report':
      return findExactType('cleanup_report')
  }

  const prefix = artifactDef.id.split('-')[0] ?? ''
  return findByPredicate(artifact => artifact.artifactType.toLowerCase().includes(prefix))
    ?? findByPredicate(artifact => Boolean(artifact.content))
}

export function buildRefinementDiffEntries(
  content: string | undefined,
  domain?: 'prd' | 'beads',
): RefinementDiffEntry[] {
  if (!content) return []
  const parsed = parseRefinementArtifact(content)
  if (!parsed) return []

  const preferredUiDiff = parsed.coverageUiRefinementDiff ?? parsed.uiRefinementDiff

  if (preferredUiDiff && (preferredUiDiff.domain === 'prd' || preferredUiDiff.domain === 'beads')) {
    const preferredEntries = preferredUiDiff.entries.flatMap((entry) => {
      if (entry.changeType === 'replaced') return []
      if (shouldSuppressNoOpUiDiffEntry(entry.changeType, entry.beforeText, entry.afterText)) return []
      return [{
        key: entry.key,
        changeType: entry.changeType,
        itemKind: entry.itemKind,
        label: entry.label,
        beforeId: entry.beforeId,
        afterId: entry.afterId,
        beforeText: entry.beforeText,
        afterText: entry.afterText,
        inspiration: entry.inspiration
          ? {
              memberId: entry.inspiration.memberId,
              sourceId: entry.inspiration.sourceId,
              sourceLabel: entry.inspiration.sourceLabel,
              sourceText: entry.inspiration.sourceText,
              blocks: entry.inspiration.blocks,
            }
          : null,
        attributionStatus: normalizeRefinementDiffAttributionStatus(entry.attributionStatus) ?? 'model_unattributed',
      }]
    })

    if (preferredEntries.length > 0) {
      return preferredEntries
    }
  }

  if (parsed.coverageBaselineContent && parsed.refinedContent && domain) {
    const fallbackArtifact = domain === 'prd'
      ? buildPrdUiRefinementDiffArtifact({
          winnerId: parsed.winnerId ?? '',
          winnerDraftContent: parsed.coverageBaselineContent,
          refinedContent: parsed.refinedContent,
        })
      : buildBeadsUiRefinementDiffArtifact({
          winnerId: parsed.winnerId ?? '',
          winnerDraftContent: parsed.coverageBaselineContent,
          refinedContent: parsed.refinedContent,
        })

    return fallbackArtifact.entries.flatMap((entry) => {
      if (entry.changeType === 'replaced') return []
      return [{
        key: entry.key,
        changeType: entry.changeType,
        itemKind: entry.itemKind,
        label: entry.label,
        beforeId: entry.beforeId,
        afterId: entry.afterId,
        beforeText: entry.beforeText,
        afterText: entry.afterText,
        inspiration: entry.inspiration
          ? {
              memberId: entry.inspiration.memberId,
              sourceId: entry.inspiration.sourceId,
              sourceLabel: entry.inspiration.sourceLabel,
              sourceText: entry.inspiration.sourceText,
              blocks: entry.inspiration.blocks,
            }
          : null,
        attributionStatus: normalizeRefinementDiffAttributionStatus(entry.attributionStatus) ?? 'model_unattributed',
      }]
    })
  }

  if (parsed.winnerDraftContent && parsed.refinedContent && domain) {
    const fallbackArtifact = domain === 'prd'
      ? buildPrdUiRefinementDiffArtifact({
          winnerId: parsed.winnerId ?? '',
          winnerDraftContent: parsed.winnerDraftContent,
          refinedContent: parsed.refinedContent,
        })
      : buildBeadsUiRefinementDiffArtifact({
          winnerId: parsed.winnerId ?? '',
          winnerDraftContent: parsed.winnerDraftContent,
          refinedContent: parsed.refinedContent,
        })

    return fallbackArtifact.entries.flatMap((entry) => {
      if (entry.changeType === 'replaced') return []
      return [{
        key: entry.key,
        changeType: entry.changeType,
        itemKind: entry.itemKind,
        label: entry.label,
        beforeId: entry.beforeId,
        afterId: entry.afterId,
        beforeText: entry.beforeText,
        afterText: entry.afterText,
        inspiration: entry.inspiration
          ? {
              memberId: entry.inspiration.memberId,
              sourceId: entry.inspiration.sourceId,
              sourceLabel: entry.inspiration.sourceLabel,
              sourceText: entry.inspiration.sourceText,
              blocks: entry.inspiration.blocks,
            }
          : null,
        attributionStatus: normalizeRefinementDiffAttributionStatus(entry.attributionStatus) ?? 'model_unattributed',
      }]
    })
  }

  if (!Array.isArray(parsed.changes)) return []

  return parsed.changes.flatMap((change, index) => {
    const normalizedType = typeof change?.type === 'string' ? change.type.toLowerCase() : ''
    if (normalizedType !== 'modified' && normalizedType !== 'added' && normalizedType !== 'removed') {
      return []
    }

    const afterId = change.after?.id
    const beforeId = change.before?.id
    const key = `${afterId || beforeId || index}:${normalizedType}:${index}`

    const rawInspiration = change.inspiration as Record<string, unknown> | null | undefined
    const rawItem = rawInspiration?.item
    const itemRecord = isRecord(rawItem) ? rawItem : null
    const inspiration = rawInspiration
      ? {
          memberId: String(rawInspiration.memberId ?? rawInspiration.alternative_draft ?? rawInspiration.alternativeDraft ?? ''),
          sourceId: typeof rawItem === 'string' ? '' : String(itemRecord?.id ?? ''),
          sourceLabel: typeof rawItem === 'string' ? rawItem : String(itemRecord?.label ?? ''),
          sourceText: typeof rawItem === 'string' ? rawItem : String(itemRecord?.detail ?? itemRecord?.label ?? ''),
        }
      : rawInspiration === null ? null : undefined
    const attributionStatus = normalizeRefinementDiffAttributionStatus(change.attributionStatus)
      ?? (inspiration ? 'inspired' : 'model_unattributed')

    return [{
      key,
      changeType: normalizedType as RefinementDiffEntry['changeType'],
      itemKind: change.itemType ?? 'item',
      label: change.after?.label ?? change.before?.label ?? change.after?.id ?? change.before?.id ?? key,
      beforeId: change.before?.id,
      beforeText: change.before?.label,
      afterId: change.after?.id,
      afterText: change.after?.label,
      ...(inspiration !== undefined ? { inspiration } : {}),
      attributionStatus,
    }]
  })
}

export function shouldCollapseVotingMemberArtifacts(phase: string): boolean {
  return phase === 'COUNCIL_VOTING_INTERVIEW' || phase === 'COUNCIL_VOTING_PRD' || phase === 'COUNCIL_VOTING_BEADS'
}
