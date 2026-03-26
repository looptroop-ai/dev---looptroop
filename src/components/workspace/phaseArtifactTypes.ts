import jsYaml from 'js-yaml'
import { getModelDisplayName } from '@/components/shared/modelBadgeUtils'
import type { DBartifact } from '@/hooks/useTicketArtifacts'
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
  parsed?: {
    status?: string
    gaps?: string[]
    followUpQuestions?: CoverageFollowUpArtifactQuestion[]
    follow_up_questions?: CoverageFollowUpArtifactQuestion[]
  }
}

export interface ArtifactStructuredOutputData {
  repairApplied?: boolean
  repairWarnings?: string[]
  autoRetryCount?: number
  validationError?: string
}

export interface CouncilDraftData {
  memberId: string
  outcome?: CouncilOutcome
  content?: string
  duration?: number
  error?: string
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

export interface CouncilResultData {
  drafts?: CouncilDraftData[]
  votes?: CouncilVoteData[]
  winnerId?: string
  winnerContent?: string
  refinedContent?: string
  voterOutcomes?: Record<string, CouncilOutcome>
  presentationOrders?: Record<string, VotePresentationOrderData>
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
  changes?: RefinementChange[]
  uiRefinementDiff?: UiRefinementDiffArtifact
  draftMetrics?: {
    epicCount: number
    userStoryCount: number
  }
  structuredOutput?: ArtifactStructuredOutputData
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
  } | null
  attributionStatus?: RefinementChangeAttributionStatus
}

export interface QuestionDiffSegment {
  text: string
  changed: boolean
}

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
}

import type { CouncilOutcome, CouncilViewerArtifact } from './councilArtifacts'

export type ViewingArtifact = CouncilViewerArtifact & { icon?: React.ReactNode }
export type ViewingArtifactSelection =
  | { kind: 'member'; key: string }
  | { kind: 'supplemental'; id: string }

// Re-export CouncilOutcome for convenience
export type { CouncilOutcome }

export const QUESTION_DIFF_TOKEN_PATTERN = /(\s+|[A-Za-z0-9_]+|[^A-Za-z0-9_\s]+)/g
type InterviewDiffAttributionStatus = NonNullable<InterviewQuestionChange['attributionStatus']>
type RefinementDiffAttributionStatus = NonNullable<RefinementChange['attributionStatus']>

export function extractDraftDetail(content: string | null): string {
  if (!content) return ''
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

  return {
    repairApplied,
    repairWarnings,
    autoRetryCount,
    ...(validationError ? { validationError } : {}),
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

export function parseRefinementArtifact(content: string): RefinementDiffArtifactData | null {
  const parsed = tryParseStructuredContent(content)
  if (!isRecord(parsed)) return null

  const refinedContent = typeof parsed.refinedContent === 'string' ? parsed.refinedContent : ''
  if (!refinedContent.trim()) return null

  return {
    winnerId: typeof parsed.winnerId === 'string' ? parsed.winnerId : undefined,
    refinedContent,
    winnerDraftContent: typeof parsed.winnerDraftContent === 'string' ? parsed.winnerDraftContent : undefined,
    changes: Array.isArray(parsed.changes) ? parsed.changes as RefinementChange[] : [],
    uiRefinementDiff: normalizeUiRefinementDiff(parsed.uiRefinementDiff),
    draftMetrics: normalizeRefinementDraftMetrics(parsed.draftMetrics),
    structuredOutput: normalizeArtifactStructuredOutput(parsed.structuredOutput),
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

        return [{
          key: `${id}:${normalizedType}:${index}`,
          id,
          changeType: normalizedType as InterviewDiffEntry['changeType'],
          phase,
          before: before?.question,
          after: after?.question,
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

export function tokenizeQuestionDiffText(text: string): string[] {
  return text.match(QUESTION_DIFF_TOKEN_PATTERN) ?? []
}

export function mergeQuestionDiffSegments(segments: QuestionDiffSegment[]): QuestionDiffSegment[] {
  const merged: QuestionDiffSegment[] = []

  for (const segment of segments) {
    if (!segment.text) continue
    const previous = merged[merged.length - 1]
    if (previous && previous.changed === segment.changed) {
      previous.text += segment.text
      continue
    }
    merged.push({ ...segment })
  }

  return merged
}

export function buildQuestionDiffSegments(before: string | undefined, after: string | undefined): {
  before: QuestionDiffSegment[]
  after: QuestionDiffSegment[]
} {
  if (!before && !after) return { before: [], after: [] }
  if (!before) return { before: [], after: after ? [{ text: after, changed: true }] : [] }
  if (!after) return { before: before ? [{ text: before, changed: true }] : [], after: [] }
  if (before === after) {
    return {
      before: [{ text: before, changed: false }],
      after: [{ text: after, changed: false }],
    }
  }

  const beforeTokens = tokenizeQuestionDiffText(before)
  const afterTokens = tokenizeQuestionDiffText(after)
  const lcs: number[][] = Array.from(
    { length: beforeTokens.length + 1 },
    () => Array<number>(afterTokens.length + 1).fill(0),
  )

  for (let beforeIndex = beforeTokens.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterTokens.length - 1; afterIndex >= 0; afterIndex -= 1) {
      lcs[beforeIndex]![afterIndex] = beforeTokens[beforeIndex] === afterTokens[afterIndex]
        ? (lcs[beforeIndex + 1]?.[afterIndex + 1] ?? 0) + 1
        : Math.max(lcs[beforeIndex + 1]?.[afterIndex] ?? 0, lcs[beforeIndex]![afterIndex + 1] ?? 0)
    }
  }

  const beforeSegments: QuestionDiffSegment[] = []
  const afterSegments: QuestionDiffSegment[] = []
  let beforeIndex = 0
  let afterIndex = 0

  while (beforeIndex < beforeTokens.length && afterIndex < afterTokens.length) {
    if (beforeTokens[beforeIndex] === afterTokens[afterIndex]) {
      const shared = beforeTokens[beforeIndex]!
      beforeSegments.push({ text: shared, changed: false })
      afterSegments.push({ text: shared, changed: false })
      beforeIndex += 1
      afterIndex += 1
      continue
    }

    if ((lcs[beforeIndex + 1]?.[afterIndex] ?? 0) >= (lcs[beforeIndex]?.[afterIndex + 1] ?? 0)) {
      beforeSegments.push({ text: beforeTokens[beforeIndex]!, changed: true })
      beforeIndex += 1
      continue
    }

    afterSegments.push({ text: afterTokens[afterIndex]!, changed: true })
    afterIndex += 1
  }

  while (beforeIndex < beforeTokens.length) {
    beforeSegments.push({ text: beforeTokens[beforeIndex]!, changed: true })
    beforeIndex += 1
  }

  while (afterIndex < afterTokens.length) {
    afterSegments.push({ text: afterTokens[afterIndex]!, changed: true })
    afterIndex += 1
  }

  return {
    before: mergeQuestionDiffSegments(beforeSegments),
    after: mergeQuestionDiffSegments(afterSegments),
  }
}

export function buildFinalInterviewArtifactContent(
  voteContent: string | null | undefined,
  compiledContent: string | null | undefined,
  uiDiffContent?: string | null | undefined,
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
    const refinedContent = typeof compiled.refinedContent === 'string' ? compiled.refinedContent : ''
    if (!refinedContent) return null

    const voteResult = voteContent ? tryParseCouncilResult(voteContent) : null
    const winnerId = compiled.winnerId ?? voteResult?.winnerId
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
          : normalizeInterviewDiffQuestions(refinedContent).length,
      questionCount: typeof compiled.questionCount === 'number'
        ? compiled.questionCount
        : Array.isArray(compiled.questions)
          ? compiled.questions.length
          : normalizeInterviewDiffQuestions(refinedContent).length,
      questions: Array.isArray(compiled.questions) ? compiled.questions : undefined,
      changes: Object.prototype.hasOwnProperty.call(compiled, 'changes') && Array.isArray(compiled.changes)
        ? compiled.changes as InterviewQuestionChange[]
        : undefined,
      uiRefinementDiff: normalizeUiRefinementDiff(compiled.uiRefinementDiff) ?? normalizeUiRefinementDiff(uiDiffContent),
      structuredOutput: compiled.structuredOutput,
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
): string | null {
  const refinedArtifact = refinedContent ? parseRefinementArtifact(refinedContent) : null
  const coverageInput = coverageInputContent ? tryParseStructuredContent(coverageInputContent) : null
  const coverageRecord = isRecord(coverageInput) ? coverageInput : null

  const nextRefinedContent = typeof coverageRecord?.refinedContent === 'string'
    ? coverageRecord.refinedContent
    : refinedArtifact?.refinedContent ?? ''
  if (!nextRefinedContent.trim()) return null

  const payload: RefinementDiffArtifactData & CoverageInputData = {
    ...(coverageRecord ? coverageRecord as CoverageInputData : {}),
    winnerId: refinedArtifact?.winnerId,
    refinedContent: nextRefinedContent,
    winnerDraftContent: refinedArtifact?.winnerDraftContent,
    changes: refinedArtifact?.changes,
    uiRefinementDiff: refinedArtifact?.uiRefinementDiff ?? normalizeUiRefinementDiff(uiDiffContent),
    draftMetrics: refinedArtifact?.draftMetrics,
    structuredOutput: refinedArtifact?.structuredOutput,
  }

  return JSON.stringify(payload)
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

  const result = parsed as CoverageArtifactData
  if (
    !('response' in result)
    && !('hasGaps' in result)
    && !('winnerId' in result)
    && !('parsed' in result)
    && !('normalizedContent' in result)
  ) {
    return null
  }

  return result
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
      return findExactType('prd_coverage_input') ?? findExactType('prd_refined')
    case 'final-prd-draft':
      return findExactType('prd_refined')
    case 'refined-beads':
      return findExactType('beads_coverage_input') ?? findExactType('beads_refined')
    case 'final-beads-draft':
      return findExactType('beads_refined')
    case 'relevant-files-scan':
      return findExactType('relevant_files_scan')
    case 'diagnostics':
      return findExactType('preflight_report')
    case 'bead-commits':
      return findByPredicate(artifact => artifact.artifactType.startsWith('bead_execution:'))
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

  if (parsed.uiRefinementDiff && (parsed.uiRefinementDiff.domain === 'prd' || parsed.uiRefinementDiff.domain === 'beads')) {
    return parsed.uiRefinementDiff.entries.flatMap((entry) => {
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

    const inspiration = change.inspiration
      ? {
          memberId: change.inspiration.memberId ?? '',
          sourceId: change.inspiration.item?.id ?? '',
          sourceLabel: change.inspiration.item?.label ?? '',
        }
      : change.inspiration === null ? null : undefined
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
