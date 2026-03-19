import { createHash } from 'node:crypto'
// @ts-expect-error no type declarations for js-yaml
import jsYaml from 'js-yaml'
import type { PromptPart } from '../opencode/types'
import { parseInterviewQuestions, type ParsedInterviewQuestion } from '../phases/interview/questions'
import type { Bead, BeadSubset } from '../phases/beads/types'
import type { BeadChecks } from '../phases/execution/completionSchema'
import type { InterviewQuestionChangeType } from '@shared/interviewQuestions'
import { repairYamlIndentation } from '@shared/yamlRepair'

export interface StructuredOutputSuccess<T> {
  ok: true
  value: T
  normalizedContent: string
  repairApplied: boolean
  repairWarnings: string[]
}

export interface StructuredOutputFailure {
  ok: false
  error: string
  repairApplied: boolean
  repairWarnings: string[]
}

export type StructuredOutputResult<T> = StructuredOutputSuccess<T> | StructuredOutputFailure

export interface StructuredOutputMetadata {
  repairApplied: boolean
  repairWarnings: string[]
  autoRetryCount: number
  validationError?: string
}

export interface CoverageFollowUpQuestion {
  id?: string
  question: string
  phase?: string
  priority?: string
  rationale?: string
}

export interface CoverageResultEnvelope {
  status: 'clean' | 'gaps'
  gaps: string[]
  followUpQuestions: CoverageFollowUpQuestion[]
}

export interface InterviewBatchPayloadQuestion {
  id: string
  question: string
  phase?: string
  priority?: string
  rationale?: string
}

export interface InterviewBatchPayload {
  batchNumber: number
  progress: {
    current: number
    total: number
  }
  isFinalFreeForm: boolean
  aiCommentary: string
  questions: InterviewBatchPayloadQuestion[]
}

export type InterviewTurnOutput =
  | {
      kind: 'batch'
      batch: InterviewBatchPayload
    }
  | {
      kind: 'complete'
      finalYaml: string
    }

export interface BeadCompletionPayload {
  beadId: string
  status: 'completed' | 'failed'
  checks: BeadChecks
  reason?: string
}

export interface FinalTestCommandPayload {
  commands: string[]
  summary: string | null
}

export interface VoteScorecard {
  draftScores: Record<string, Record<string, number>>
}

export interface PrdDocument {
  schema_version: number
  ticket_id: string
  artifact: 'prd'
  status: string
  source_interview: {
    content_sha256: string
  }
  product: {
    problem_statement: string
    target_users: string[]
  }
  scope: {
    in_scope: string[]
    out_of_scope: string[]
  }
  technical_requirements: {
    architecture_constraints: string[]
    data_model: string[]
    api_contracts: string[]
    security_constraints: string[]
    performance_constraints: string[]
    reliability_constraints: string[]
    error_handling_rules: string[]
    tooling_assumptions: string[]
  }
  epics: Array<{
    id: string
    title: string
    objective: string
    implementation_steps: string[]
    user_stories: Array<{
      id: string
      title: string
      acceptance_criteria: string[]
      implementation_steps: string[]
      verification: {
        required_commands: string[]
      }
    }>
  }>
  risks: string[]
  approval: {
    approved_by: string
    approved_at: string
  }
}

const TRANSCRIPT_PREFIX_PATTERN = /^\s*\[(?:assistant|user|system|sys|tool|model|error)(?:\/[^\]]+)?\](?:\s*\[[^\]]+\])?\s*/i
const PHASE_ORDER = new Map([
  ['foundation', 0],
  ['structure', 1],
  ['assembly', 2],
])

interface NormalizedInterviewQuestion {
  id: string
  phase: 'foundation' | 'structure' | 'assembly'
  question: string
}

interface NormalizedInterviewRefinementChange {
  type: InterviewQuestionChangeType
  before: NormalizedInterviewQuestion | null
  after: NormalizedInterviewQuestion | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

function stripTranscriptPrefixes(content: string): string {
  return content
    .split('\n')
    .map((line) => line.replace(TRANSCRIPT_PREFIX_PATTERN, ''))
    .join('\n')
    .trim()
}

function addCandidate(target: string[], seen: Set<string>, value: string | null | undefined) {
  const normalized = value?.trim()
  if (!normalized || seen.has(normalized)) return
  seen.add(normalized)
  target.push(normalized)
}

function collectStructuredCandidates(
  rawContent: string,
  options?: {
    tags?: string[]
    topLevelHints?: string[]
  },
): string[] {
  const raw = rawContent.trim()
  const stripped = stripTranscriptPrefixes(raw)
  const candidates: string[] = []
  const seen = new Set<string>()

  addCandidate(candidates, seen, raw)
  addCandidate(candidates, seen, stripped)

  for (const source of [raw, stripped]) {
    for (const match of source.matchAll(/```(?:yaml|yml|json|jsonl)?\s*([\s\S]*?)\s*```/gi)) {
      addCandidate(candidates, seen, stripTranscriptPrefixes(match[1] ?? ''))
      addCandidate(candidates, seen, match[1] ?? '')
    }

    for (const tag of options?.tags ?? []) {
      const tagPattern = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'gi')
      for (const match of source.matchAll(tagPattern)) {
        addCandidate(candidates, seen, stripTranscriptPrefixes(match[1] ?? ''))
        addCandidate(candidates, seen, match[1] ?? '')
      }
    }

    if (options?.topLevelHints?.length) {
      const lines = source.split('\n')
      const index = lines.findIndex((line) => {
        const trimmed = line.trim().toLowerCase()
        return options.topLevelHints!.some((hint) => trimmed.startsWith(`${hint.toLowerCase()}:`))
      })
      if (index >= 0) {
        addCandidate(candidates, seen, lines.slice(index).join('\n'))
      }
    }
  }

  return candidates
}

function collectTaggedCandidates(rawContent: string, tag: string): string[] {
  const raw = rawContent.trim()
  const stripped = stripTranscriptPrefixes(raw)
  const candidates: string[] = []
  const seen = new Set<string>()
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'gi')

  for (const source of [raw, stripped]) {
    for (const match of source.matchAll(pattern)) {
      const inner = match[1] ?? ''
      addCandidate(candidates, seen, inner)
      addCandidate(candidates, seen, stripTranscriptPrefixes(inner))
      for (const nested of collectStructuredCandidates(inner)) {
        addCandidate(candidates, seen, nested)
      }
    }
  }

  return candidates
}

function parseYamlOrJsonCandidate(content: string): unknown {
  const trimmed = content.trim()
  if (!trimmed) return null

  try {
    return JSON.parse(trimmed)
  } catch {
    try {
      return jsYaml.load(trimmed)
    } catch {
      const repaired = repairYamlIndentation(trimmed)
      return jsYaml.load(repaired)
    }
  }
}

function quoteYamlDoubleQuotedScalar(value: string): string {
  return JSON.stringify(value)
}

function repairCoverageGapStringList(content: string): {
  content: string
  repairApplied: boolean
  repairWarnings: string[]
} {
  const lines = content.split('\n')
  const repairedLines: string[] = []
  const topLevelKeyPattern = /^[A-Za-z_][A-Za-z0-9_-]*\s*:/
  let activeGapIndent = -1
  let directItemIndent = -1
  let repairApplied = false

  for (const line of lines) {
    const trimmed = line.trim()
    const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0

    if (activeGapIndent >= 0) {
      if (trimmed && !trimmed.startsWith('#') && indent <= activeGapIndent && topLevelKeyPattern.test(trimmed)) {
        activeGapIndent = -1
        directItemIndent = -1
      } else {
        if (indent === directItemIndent && trimmed.startsWith('- ')) {
          const itemValue = trimmed.slice(2).trim()
          if (itemValue && !/^(["']|[>|])/.test(itemValue)) {
            const repairedLine = `${' '.repeat(directItemIndent)}- ${quoteYamlDoubleQuotedScalar(itemValue)}`
            repairedLines.push(repairedLine)
            repairApplied = repairApplied || repairedLine !== line
            continue
          }
        }

        repairedLines.push(line)
        continue
      }
    }

    const gapBlockMatch = line.match(/^(\s*)(gaps|issues)\s*:\s*$/)
    if (gapBlockMatch) {
      activeGapIndent = gapBlockMatch[1]?.length ?? 0
      directItemIndent = activeGapIndent + 2
    }

    repairedLines.push(line)
  }

  return {
    content: repairedLines.join('\n'),
    repairApplied,
    repairWarnings: repairApplied
      ? ['Quoted coverage gap strings to recover malformed YAML scalars.']
      : [],
  }
}

function maybeUnwrapRecord(
  value: unknown,
  preferredKeys: string[],
  depth: number = 0,
): unknown {
  if (!isRecord(value) || depth > 4) return value

  for (const [key, nested] of Object.entries(value)) {
    if (!preferredKeys.includes(normalizeKey(key))) continue
    return maybeUnwrapRecord(nested, preferredKeys, depth + 1)
  }

  const keys = Object.keys(value)
  if (keys.length === 1) {
    return maybeUnwrapRecord(value[keys[0]!], preferredKeys, depth + 1)
  }

  return value
}

function unwrapExplicitWrapperRecord(
  value: unknown,
  preferredKeys: string[],
  depth: number = 0,
): unknown {
  if (!isRecord(value) || depth > 4) return value

  for (const [key, nested] of Object.entries(value)) {
    if (!preferredKeys.includes(normalizeKey(key))) continue
    return unwrapExplicitWrapperRecord(nested, preferredKeys, depth + 1)
  }

  return value
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => typeof entry === 'string' ? entry.trim() : String(entry ?? '').trim())
      .filter((entry) => entry.length > 0)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    if (trimmed.includes('\n')) {
      return trimmed
        .split('\n')
        .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
        .filter(Boolean)
    }
    return [trimmed]
  }
  return []
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function toInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null
  }
  return null
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null
  if (typeof value !== 'string') return null
  const normalized = normalizeKey(value)
  if (['true', 'yes', 'y', '1'].includes(normalized)) return true
  if (['false', 'no', 'n', '0'].includes(normalized)) return false
  return null
}

function getValueByAliases(record: Record<string, unknown>, aliases: string[]): unknown {
  for (const [key, value] of Object.entries(record)) {
    if (aliases.includes(normalizeKey(key))) return value
  }
  return undefined
}

function getNestedRecord(record: Record<string, unknown>, aliases: string[]): Record<string, unknown> {
  const value = getValueByAliases(record, aliases)
  return isRecord(value) ? value : {}
}

function getRequiredString(record: Record<string, unknown>, aliases: string[], label: string): string {
  const value = getValueByAliases(record, aliases)
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required ${label}`)
  }
  return value.trim()
}

function buildYamlDocument(value: unknown): string {
  return jsYaml.dump(value, { lineWidth: 120, noRefs: true }) as string
}

function buildJsonlDocument(records: Record<string, unknown>[]): string {
  return records.map((record) => JSON.stringify(record)).join('\n')
}

function normalizeInterviewPhase(value: string): 'foundation' | 'structure' | 'assembly' {
  const normalized = normalizeKey(value)
  if (normalized === 'foundation') return 'foundation'
  if (normalized === 'structure') return 'structure'
  if (normalized === 'assembly') return 'assembly'
  throw new Error(`Unknown question phase: ${value}`)
}

function normalizeInterviewId(rawId: string): string {
  const match = rawId.trim().match(/q?(\d+)/i)
  if (!match?.[1]) return rawId.trim()
  return `Q${match[1].padStart(2, '0')}`
}

function buildInterviewQuestionKey(question: NormalizedInterviewQuestion): string {
  return `${question.id}\u241f${question.phase}\u241f${question.question}`
}

function buildInterviewQuestionIdentityKey(question: NormalizedInterviewQuestion): string {
  return `${question.id}\u241f${question.phase}`
}

function buildInterviewQuestionLookup(questions: NormalizedInterviewQuestion[]) {
  const byFullKey = new Map<string, NormalizedInterviewQuestion>()
  const byIdentityKey = new Map<string, NormalizedInterviewQuestion[]>()

  for (const question of questions) {
    byFullKey.set(buildInterviewQuestionKey(question), question)
    const identityKey = buildInterviewQuestionIdentityKey(question)
    const matches = byIdentityKey.get(identityKey) ?? []
    matches.push(question)
    byIdentityKey.set(identityKey, matches)
  }

  return { byFullKey, byIdentityKey }
}

function normalizeParsedInterviewQuestionList(
  parsed: ParsedInterviewQuestion[],
  maxInitialQuestions: number,
): {
  questions: NormalizedInterviewQuestion[]
  reordered: boolean
} {
  const seenIds = new Set<string>()
  const normalized = parsed.map((question, index) => {
    const id = normalizeInterviewId(question.id)
    const phase = normalizeInterviewPhase(question.phase)
    const text = question.question.trim()
    if (!text) throw new Error(`Empty question text at index ${index}`)
    if (seenIds.has(id)) throw new Error(`Duplicate question id: ${id}`)
    seenIds.add(id)
    return { id, phase, question: text, originalIndex: index }
  })

  if (maxInitialQuestions > 0 && normalized.length > maxInitialQuestions) {
    throw new Error(`Question count ${normalized.length} exceeds max_initial_questions=${maxInitialQuestions}`)
  }

  const sorted = [...normalized].sort((left, right) => {
    const orderDiff = (PHASE_ORDER.get(left.phase) ?? 0) - (PHASE_ORDER.get(right.phase) ?? 0)
    return orderDiff !== 0 ? orderDiff : left.originalIndex - right.originalIndex
  })

  return {
    questions: sorted.map(({ originalIndex: _originalIndex, ...question }) => question),
    reordered: sorted.some((question, index) => question !== normalized[index]),
  }
}

function normalizeStructuredInterviewQuestionList(
  rawQuestions: unknown[],
  maxInitialQuestions: number,
): {
  questions: NormalizedInterviewQuestion[]
  questionCount: number
  reordered: boolean
} {
  const parsed = parseInterviewQuestions(buildYamlDocument({ questions: rawQuestions }))
  const normalized = normalizeParsedInterviewQuestionList(parsed, maxInitialQuestions)
  return {
    questions: normalized.questions,
    questionCount: normalized.questions.length,
    reordered: normalized.reordered,
  }
}

function normalizeInterviewChangeType(value: unknown, index: number): InterviewQuestionChangeType {
  const raw = toOptionalString(value)
  if (!raw) throw new Error(`Interview refinement change at index ${index} is missing type`)

  const normalized = normalizeKey(raw)
  if (normalized === 'modified') return 'modified'
  if (normalized === 'replaced') return 'replaced'
  if (normalized === 'added') return 'added'
  if (normalized === 'removed') return 'removed'

  throw new Error(`Interview refinement change at index ${index} has unknown type: ${raw}`)
}

function normalizeInterviewChangeQuestion(value: unknown, label: string): NormalizedInterviewQuestion {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`)
  }

  const id = normalizeInterviewId(getRequiredString(value, ['id'], `${label} id`))
  const phase = normalizeInterviewPhase(getRequiredString(value, ['phase', 'category', 'stage', 'section'], `${label} phase`))
  const question = getRequiredString(value, ['question', 'prompt', 'text', 'content'], `${label} question`).trim()

  if (!question) {
    throw new Error(`${label} question must not be empty`)
  }

  return { id, phase, question }
}

function parseInterviewRefinementChangeEntry(
  value: unknown,
  index: number,
): NormalizedInterviewRefinementChange {
  if (!isRecord(value)) {
    throw new Error(`Interview refinement change at index ${index} is not an object`)
  }

  const type = normalizeInterviewChangeType(getValueByAliases(value, ['type', 'change_type', 'changetype']), index)
  const hasBefore = Object.keys(value).some((key) => normalizeKey(key) === 'before')
  const hasAfter = Object.keys(value).some((key) => normalizeKey(key) === 'after')

  if (!hasBefore) throw new Error(`Interview refinement change at index ${index} is missing before`)
  if (!hasAfter) throw new Error(`Interview refinement change at index ${index} is missing after`)

  const rawBefore = getValueByAliases(value, ['before'])
  const rawAfter = getValueByAliases(value, ['after'])
  const before = rawBefore === null ? null : normalizeInterviewChangeQuestion(rawBefore, `Interview refinement change.before at index ${index}`)
  const after = rawAfter === null ? null : normalizeInterviewChangeQuestion(rawAfter, `Interview refinement change.after at index ${index}`)

  if ((type === 'modified' || type === 'replaced') && (!before || !after)) {
    throw new Error(`Interview refinement change at index ${index} requires both before and after for type ${type}`)
  }
  if (type === 'added' && (before !== null || !after)) {
    throw new Error(`Interview refinement change at index ${index} with type added must use before: null and a populated after`)
  }
  if (type === 'removed' && (!before || rawAfter !== null)) {
    throw new Error(`Interview refinement change at index ${index} with type removed must use after: null and a populated before`)
  }

  return { type, before, after }
}

function resolveCanonicalInterviewQuestion(
  question: NormalizedInterviewQuestion,
  lookup: ReturnType<typeof buildInterviewQuestionLookup>,
): {
  question: NormalizedInterviewQuestion
  repaired: boolean
} {
  const fullKey = buildInterviewQuestionKey(question)
  const canonicalByFullKey = lookup.byFullKey.get(fullKey)
  if (canonicalByFullKey) {
    return { question: canonicalByFullKey, repaired: false }
  }

  const identityKey = buildInterviewQuestionIdentityKey(question)
  const canonicalByIdentity = lookup.byIdentityKey.get(identityKey)
  if (canonicalByIdentity?.length === 1) {
    return {
      question: canonicalByIdentity[0]!,
      repaired: true,
    }
  }

  return { question, repaired: false }
}

function canonicalizeInterviewRefinementChanges(
  changes: NormalizedInterviewRefinementChange[],
  winnerQuestions: NormalizedInterviewQuestion[],
  finalQuestions: NormalizedInterviewQuestion[],
): {
  changes: NormalizedInterviewRefinementChange[]
  repairApplied: boolean
  repairWarnings: string[]
} {
  const winnerLookup = buildInterviewQuestionLookup(winnerQuestions)
  const finalLookup = buildInterviewQuestionLookup(finalQuestions)
  const normalizedChanges: NormalizedInterviewRefinementChange[] = []
  const repairWarnings: string[] = []
  let repairApplied = false

  for (const [index, change] of changes.entries()) {
    let before = change.before
    let after = change.after

    if (before) {
      const resolved = resolveCanonicalInterviewQuestion(before, winnerLookup)
      if (resolved.repaired) {
        before = resolved.question
        repairApplied = true
        repairWarnings.push(`Canonicalized interview refinement change.before at index ${index} to the winning draft record for ${before.id}.`)
      }
    }

    if (after) {
      const resolved = resolveCanonicalInterviewQuestion(after, finalLookup)
      if (resolved.repaired) {
        after = resolved.question
        repairApplied = true
        repairWarnings.push(`Canonicalized interview refinement change.after at index ${index} to the refined final record for ${after.id}.`)
      }
    }

    if (
      (change.type === 'modified' || change.type === 'replaced')
      && before
      && after
      && buildInterviewQuestionKey(before) === buildInterviewQuestionKey(after)
      && winnerLookup.byFullKey.has(buildInterviewQuestionKey(before))
      && finalLookup.byFullKey.has(buildInterviewQuestionKey(after))
    ) {
      repairApplied = true
      repairWarnings.push(`Dropped no-op interview refinement ${change.type} at index ${index} because the question is unchanged across the winning and final drafts.`)
      continue
    }

    normalizedChanges.push({
      type: change.type,
      before,
      after,
    })
  }

  return {
    changes: normalizedChanges,
    repairApplied,
    repairWarnings,
  }
}

function validateInterviewRefinementChangeEntry(
  change: NormalizedInterviewRefinementChange,
  index: number,
  winnerKeySet: Set<string>,
  finalKeySet: Set<string>,
  usedBeforeKeys: Set<string>,
  usedAfterKeys: Set<string>,
): NormalizedInterviewRefinementChange {
  const before = change.before
  const after = change.after

  if (before && after && buildInterviewQuestionKey(before) === buildInterviewQuestionKey(after)) {
    throw new Error(`Interview refinement change at index ${index} cannot use identical before and after question records`)
  }

  if (before) {
    const beforeKey = buildInterviewQuestionKey(before)
    if (!winnerKeySet.has(beforeKey)) {
      throw new Error(`Interview refinement change.before at index ${index} does not match any question from the winning draft`)
    }
    if (usedBeforeKeys.has(beforeKey)) {
      throw new Error(`Interview refinement change.before at index ${index} reuses a winning-draft question already referenced by another change`)
    }
    usedBeforeKeys.add(beforeKey)
  }

  if (after) {
    const afterKey = buildInterviewQuestionKey(after)
    if (!finalKeySet.has(afterKey)) {
      throw new Error(`Interview refinement change.after at index ${index} does not match any question from the refined final list`)
    }
    if (usedAfterKeys.has(afterKey)) {
      throw new Error(`Interview refinement change.after at index ${index} reuses a refined question already referenced by another change`)
    }
    usedAfterKeys.add(afterKey)
  }

  return change
}

function ensureQuestionChangeCoverage(
  winnerQuestions: NormalizedInterviewQuestion[],
  finalQuestions: NormalizedInterviewQuestion[],
  usedBeforeKeys: Set<string>,
  usedAfterKeys: Set<string>,
) {
  const winnerKeySet = new Set(winnerQuestions.map(buildInterviewQuestionKey))
  const finalKeySet = new Set(finalQuestions.map(buildInterviewQuestionKey))
  const expectedBeforeKeys = [...winnerKeySet].filter((key) => !finalKeySet.has(key))
  const expectedAfterKeys = [...finalKeySet].filter((key) => !winnerKeySet.has(key))

  const missingBefore = expectedBeforeKeys.filter((key) => !usedBeforeKeys.has(key))
  const missingAfter = expectedAfterKeys.filter((key) => !usedAfterKeys.has(key))
  const extraBefore = [...usedBeforeKeys].filter((key) => !winnerKeySet.has(key) || finalKeySet.has(key))
  const extraAfter = [...usedAfterKeys].filter((key) => !finalKeySet.has(key) || winnerKeySet.has(key))

  if (missingBefore.length > 0 || missingAfter.length > 0 || extraBefore.length > 0 || extraAfter.length > 0) {
    throw new Error('Interview refinement changes do not fully and exactly account for the differences between the winning draft and the refined final draft')
  }
}

function normalizeInterviewBatchPhase(value: unknown): string | undefined {
  const raw = toOptionalString(value)
  if (!raw) return undefined
  const normalized = normalizeKey(raw)
  if (normalized === 'foundation') return 'Foundation'
  if (normalized === 'structure') return 'Structure'
  if (normalized === 'assembly') return 'Assembly'
  return raw
}

function normalizeInterviewBatchPriority(value: unknown): string | undefined {
  const raw = toOptionalString(value)
  if (!raw) return undefined
  const normalized = normalizeKey(raw)
  if (['critical', 'high', 'medium', 'low'].includes(normalized)) {
    return normalized
  }
  return raw
}

function normalizeInterviewBatchQuestion(value: unknown, index: number): InterviewBatchPayloadQuestion {
  if (!isRecord(value)) throw new Error(`Interview batch question at index ${index} is not an object`)

  const id = getRequiredString(value, ['id', 'questionid', 'question_id'], `question id at index ${index}`)
  const question = getRequiredString(value, ['question', 'prompt', 'text'], `question text at index ${index}`)
  const phase = normalizeInterviewBatchPhase(getValueByAliases(value, ['phase', 'category', 'stage', 'section']))
  const priority = normalizeInterviewBatchPriority(getValueByAliases(value, ['priority']))
  const rationale = toOptionalString(getValueByAliases(value, ['rationale', 'reason']))

  return {
    id: id.trim(),
    question: question.trim(),
    ...(phase ? { phase } : {}),
    ...(priority ? { priority } : {}),
    ...(rationale ? { rationale } : {}),
  }
}

function normalizeInterviewBatchPayload(value: unknown): InterviewBatchPayload {
  const parsed = maybeUnwrapRecord(value, [
    'interviewbatch',
    'interview_batch',
    'batch',
    'payload',
    'output',
    'data',
  ])
  if (!isRecord(parsed)) throw new Error('Interview batch output is not a YAML/JSON object')

  const rawQuestions = getValueByAliases(parsed, ['questions', 'nextquestions', 'next_questions'])
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    throw new Error('Interview batch output is missing questions')
  }

  const progressRecord = getNestedRecord(parsed, ['progress'])
  const current = toInteger(getValueByAliases(progressRecord, ['current']))
  const total = toInteger(getValueByAliases(progressRecord, ['total']))
  const batchNumber = toInteger(getValueByAliases(parsed, ['batchnumber', 'batch_number']))

  if (batchNumber === null || batchNumber < 1) {
    throw new Error('Interview batch output is missing a valid batch_number')
  }
  if (current === null || current < 0) {
    throw new Error('Interview batch output is missing progress.current')
  }
  if (total === null || total < current) {
    throw new Error('Interview batch output is missing a valid progress.total')
  }

  const questions = rawQuestions.map((question, index) => normalizeInterviewBatchQuestion(question, index))

  // Enforce architecture batch size limit (1-3 questions per batch)
  const MAX_BATCH_SIZE = 3
  if (questions.length > MAX_BATCH_SIZE) {
    questions.length = MAX_BATCH_SIZE
  }

  return {
    batchNumber,
    progress: { current, total },
    isFinalFreeForm: toBoolean(getValueByAliases(parsed, ['isfinalfreeform', 'is_final_free_form'])) ?? false,
    aiCommentary: toOptionalString(getValueByAliases(parsed, ['aicommentary', 'ai_commentary', 'commentary', 'notes'])) ?? '',
    questions,
  }
}

function normalizeInterviewCompletePayload(value: unknown, allowQuestionsOnly: boolean): string {
  const parsed = maybeUnwrapRecord(value, [
    'interviewcomplete',
    'interview_complete',
    'interview',
    'result',
    'output',
    'data',
  ])
  if (!isRecord(parsed)) throw new Error('Interview complete output is not a YAML/JSON object')

  const hasQuestions = Array.isArray(getValueByAliases(parsed, ['questions']))
  const hasAnswers = Array.isArray(getValueByAliases(parsed, ['answers']))
  const hasFinalSchemaKeys = ['schemaversion', 'schema_version', 'artifact', 'generatedby', 'generated_by', 'approval', 'summary', 'followuprounds', 'follow_up_rounds']
    .some((alias) => getValueByAliases(parsed, [alias]) !== undefined)
  const hasAuditSummaryKeys = ['ticketid', 'ticket_id', 'status', 'derivedfindings', 'derived_findings', 'skippedquestionids', 'skipped_question_ids', 'assumptionsforprdgeneration', 'assumptions_for_prd_generation', 'confidence']
    .some((alias) => getValueByAliases(parsed, [alias]) !== undefined)

  if (!hasQuestions && !hasAnswers) {
    throw new Error('Interview complete output is missing questions or answers')
  }
  if (!allowQuestionsOnly && !hasFinalSchemaKeys && !hasAuditSummaryKeys) {
    throw new Error('Interview complete output is missing final interview schema fields')
  }

  return buildYamlDocument(parsed)
}

export function normalizeInterviewTurnOutput(rawContent: string): StructuredOutputResult<InterviewTurnOutput> {
  const repairWarnings: string[] = []
  const rawTrimmed = rawContent.trim()
  let lastError = 'No interview batch or completion content found'

  const completeCandidates = collectTaggedCandidates(rawContent, 'INTERVIEW_COMPLETE')
  for (const candidate of completeCandidates) {
    try {
      const normalizedContent = normalizeInterviewCompletePayload(parseYamlOrJsonCandidate(candidate), true)
      return {
        ok: true,
        value: {
          kind: 'complete',
          finalYaml: normalizedContent.trim(),
        },
        normalizedContent,
        repairApplied: candidate !== rawTrimmed,
        repairWarnings,
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  const batchCandidates = collectTaggedCandidates(rawContent, 'INTERVIEW_BATCH')
  for (const candidate of batchCandidates) {
    try {
      const batch = normalizeInterviewBatchPayload(parseYamlOrJsonCandidate(candidate))
      return {
        ok: true,
        value: {
          kind: 'batch',
          batch,
        },
        normalizedContent: buildYamlDocument({
          batch_number: batch.batchNumber,
          progress: batch.progress,
          is_final_free_form: batch.isFinalFreeForm,
          ai_commentary: batch.aiCommentary,
          questions: batch.questions,
        }),
        repairApplied: candidate !== rawTrimmed,
        repairWarnings,
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  const fallbackCandidates = collectStructuredCandidates(rawContent, {
    topLevelHints: ['batch_number', 'batchnumber', 'progress', 'schema_version', 'approval', 'generated_by', 'generatedby', 'ticket_id', 'ticketid', 'answers', 'status'],
  })

  for (const candidate of fallbackCandidates) {
    try {
      const parsed = parseYamlOrJsonCandidate(candidate)
      const normalizedContent = normalizeInterviewCompletePayload(parsed, false)
      return {
        ok: true,
        value: {
          kind: 'complete',
          finalYaml: normalizedContent.trim(),
        },
        normalizedContent,
        repairApplied: candidate !== rawTrimmed,
        repairWarnings,
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }

    try {
      const batch = normalizeInterviewBatchPayload(parseYamlOrJsonCandidate(candidate))
      return {
        ok: true,
        value: {
          kind: 'batch',
          batch,
        },
        normalizedContent: buildYamlDocument({
          batch_number: batch.batchNumber,
          progress: batch.progress,
          is_final_free_form: batch.isFinalFreeForm,
          ai_commentary: batch.aiCommentary,
          questions: batch.questions,
        }),
        repairApplied: candidate !== rawTrimmed,
        repairWarnings,
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    ok: false,
    error: lastError,
    repairApplied: false,
    repairWarnings: [],
  }
}

export function normalizeInterviewQuestionsOutput(
  rawContent: string,
  maxInitialQuestions: number,
): StructuredOutputResult<{
  questions: NormalizedInterviewQuestion[]
  questionCount: number
}> {
  const repairWarnings: string[] = []
  let repairApplied = false
  const candidates = collectStructuredCandidates(rawContent, {
    topLevelHints: ['questions'],
  })

  let lastError = 'No interview question content found'

  for (const candidate of candidates) {
    try {
      const parsed = parseInterviewQuestions(candidate)
      const normalized = normalizeParsedInterviewQuestionList(parsed, maxInitialQuestions)

      if (normalized.reordered) {
        repairApplied = true
        repairWarnings.push('Applied stable interview phase reordering (foundation -> structure -> assembly).')
      }

      const questions = normalized.questions
      return {
        ok: true,
        value: {
          questions,
          questionCount: questions.length,
        },
        normalizedContent: buildYamlDocument({ questions }),
        repairApplied: repairApplied || candidate !== rawContent.trim(),
        repairWarnings,
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    ok: false,
    error: lastError,
    repairApplied,
    repairWarnings,
  }
}

export function normalizeInterviewRefinementOutput(
  rawContent: string,
  winnerDraftContent: string,
  maxInitialQuestions: number,
): StructuredOutputResult<{
  questions: NormalizedInterviewQuestion[]
  questionCount: number
  changes: NormalizedInterviewRefinementChange[]
  questionsYaml: string
}> {
  const repairWarnings: string[] = []
  let repairApplied = false
  const candidates = collectStructuredCandidates(rawContent, {
    topLevelHints: ['questions', 'changes'],
  })

  let lastError = 'No interview refinement content found'

  for (const candidate of candidates) {
    try {
      const parsed = unwrapExplicitWrapperRecord(parseYamlOrJsonCandidate(candidate), [
        'interviewrefinement',
        'interview_refinement',
        'refinement',
        'output',
        'data',
      ])
      if (!isRecord(parsed)) {
        throw new Error('Interview refinement output is not a YAML/JSON object')
      }

      const rawQuestions = getValueByAliases(parsed, ['questions'])
      const rawChanges = getValueByAliases(parsed, ['changes'])

      if (!Array.isArray(rawQuestions)) {
        throw new Error('Interview refinement output is missing questions')
      }
      if (!Array.isArray(rawChanges)) {
        throw new Error('Interview refinement output is missing changes')
      }

      const normalizedQuestions = normalizeStructuredInterviewQuestionList(rawQuestions, maxInitialQuestions)
      if (normalizedQuestions.reordered) {
        repairApplied = true
        repairWarnings.push('Applied stable interview phase reordering (foundation -> structure -> assembly).')
      }

      const winnerDraftQuestions = normalizeParsedInterviewQuestionList(parseInterviewQuestions(winnerDraftContent), 0).questions
      const winnerKeySet = new Set(winnerDraftQuestions.map(buildInterviewQuestionKey))
      const finalKeySet = new Set(normalizedQuestions.questions.map(buildInterviewQuestionKey))
      const usedBeforeKeys = new Set<string>()
      const usedAfterKeys = new Set<string>()
      const parsedChanges = rawChanges.map((entry, index) => parseInterviewRefinementChangeEntry(
        entry,
        index,
      ))
      const canonicalizedChanges = canonicalizeInterviewRefinementChanges(
        parsedChanges,
        winnerDraftQuestions,
        normalizedQuestions.questions,
      )
      if (canonicalizedChanges.repairApplied) {
        repairApplied = true
        repairWarnings.push(...canonicalizedChanges.repairWarnings)
      }
      const changes = canonicalizedChanges.changes.map((change, index) => validateInterviewRefinementChangeEntry(
        change,
        index,
        winnerKeySet,
        finalKeySet,
        usedBeforeKeys,
        usedAfterKeys,
      ))

      ensureQuestionChangeCoverage(
        winnerDraftQuestions,
        normalizedQuestions.questions,
        usedBeforeKeys,
        usedAfterKeys,
      )

      const questionsYaml = buildYamlDocument({ questions: normalizedQuestions.questions })

      return {
        ok: true,
        value: {
          questions: normalizedQuestions.questions,
          questionCount: normalizedQuestions.questionCount,
          changes,
          questionsYaml,
        },
        normalizedContent: buildYamlDocument({
          questions: normalizedQuestions.questions,
          changes: changes.map((change) => ({
            type: change.type,
            before: change.before,
            after: change.after,
          })),
        }),
        repairApplied: repairApplied || candidate !== rawContent.trim(),
        repairWarnings,
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    ok: false,
    error: lastError,
    repairApplied,
    repairWarnings,
  }
}

function hashContent(content: string | undefined): string {
  return createHash('sha256').update(content ?? '').digest('hex')
}

function normalizeVerification(record: Record<string, unknown>): { required_commands: string[] } {
  const verification = getNestedRecord(record, ['verification'])
  return {
    required_commands: toStringArray(getValueByAliases(verification, ['requiredcommands', 'required_commands', 'commands'])),
  }
}

function normalizeUserStory(value: unknown, index: number): PrdDocument['epics'][number]['user_stories'][number] {
  if (!isRecord(value)) throw new Error(`Epic user story at index ${index} is not an object`)

  return {
    id: getRequiredString(value, ['id', 'storyid'], `user story id at index ${index}`),
    title: getRequiredString(value, ['title', 'name'], `user story title at index ${index}`),
    acceptance_criteria: toStringArray(getValueByAliases(value, ['acceptancecriteria', 'acceptance_criteria'])),
    implementation_steps: toStringArray(getValueByAliases(value, ['implementationsteps', 'implementation_steps', 'steps'])),
    verification: normalizeVerification(value),
  }
}

function normalizeEpic(value: unknown, index: number): PrdDocument['epics'][number] {
  if (!isRecord(value)) throw new Error(`Epic at index ${index} is not an object`)
  const rawStories = getValueByAliases(value, ['userstories', 'user_stories', 'stories'])
  const userStories = Array.isArray(rawStories)
    ? rawStories.map((story, storyIndex) => normalizeUserStory(story, storyIndex))
    : []

  if (userStories.length === 0) {
    throw new Error(`Epic at index ${index} is missing user stories`)
  }

  return {
    id: getRequiredString(value, ['id', 'epicid'], `epic id at index ${index}`),
    title: getRequiredString(value, ['title', 'name'], `epic title at index ${index}`),
    objective: getRequiredString(value, ['objective', 'goal'], `epic objective at index ${index}`),
    implementation_steps: toStringArray(getValueByAliases(value, ['implementationsteps', 'implementation_steps', 'steps'])),
    user_stories: userStories,
  }
}

export function normalizePrdYamlOutput(
  rawContent: string,
  options: {
    ticketId: string
    interviewContent?: string
  },
): StructuredOutputResult<PrdDocument> {
  const repairWarnings: string[] = []
  const candidates = collectStructuredCandidates(rawContent, {
    topLevelHints: ['schema_version', 'artifact', 'product', 'scope', 'epics'],
  })
  let lastError = 'No PRD content found'

  for (const candidate of candidates) {
    try {
      const parsed = unwrapExplicitWrapperRecord(parseYamlOrJsonCandidate(candidate), [
        'prd',
        'document',
        'output',
        'result',
        'data',
      ])
      if (!isRecord(parsed)) throw new Error('PRD output is not a YAML/JSON object')

      const product = getNestedRecord(parsed, ['product'])
      const scope = getNestedRecord(parsed, ['scope'])
      const technicalRequirements = getNestedRecord(parsed, ['technicalrequirements', 'technical_requirements'])
      const sourceInterview = getNestedRecord(parsed, ['sourceinterview', 'source_interview'])
      const approval = getNestedRecord(parsed, ['approval'])
      const rawEpics = getValueByAliases(parsed, ['epics'])
      const epics = Array.isArray(rawEpics)
        ? rawEpics.map((epic, index) => normalizeEpic(epic, index))
        : []

      if (epics.length === 0) {
        throw new Error('PRD is missing epics')
      }

      const document: PrdDocument = {
        schema_version: Number(getValueByAliases(parsed, ['schemaversion', 'schema_version']) ?? 1),
        ticket_id: typeof getValueByAliases(parsed, ['ticketid', 'ticket_id']) === 'string'
          ? String(getValueByAliases(parsed, ['ticketid', 'ticket_id'])).trim()
          : options.ticketId,
        artifact: 'prd',
        status: typeof getValueByAliases(parsed, ['status']) === 'string'
          ? String(getValueByAliases(parsed, ['status'])).trim()
          : 'draft',
        source_interview: {
          content_sha256: typeof getValueByAliases(sourceInterview, ['contentsha256', 'content_sha256']) === 'string'
            ? String(getValueByAliases(sourceInterview, ['contentsha256', 'content_sha256'])).trim()
            : hashContent(options.interviewContent),
        },
        product: {
          problem_statement: getRequiredString(product, ['problemstatement', 'problem_statement'], 'product.problem_statement'),
          target_users: toStringArray(getValueByAliases(product, ['targetusers', 'target_users'])),
        },
        scope: {
          in_scope: toStringArray(getValueByAliases(scope, ['inscope', 'in_scope'])),
          out_of_scope: toStringArray(getValueByAliases(scope, ['outofscope', 'out_of_scope'])),
        },
        technical_requirements: {
          architecture_constraints: toStringArray(getValueByAliases(technicalRequirements, ['architectureconstraints', 'architecture_constraints'])),
          data_model: toStringArray(getValueByAliases(technicalRequirements, ['datamodel', 'data_model'])),
          api_contracts: toStringArray(getValueByAliases(technicalRequirements, ['apicontracts', 'api_contracts'])),
          security_constraints: toStringArray(getValueByAliases(technicalRequirements, ['securityconstraints', 'security_constraints'])),
          performance_constraints: toStringArray(getValueByAliases(technicalRequirements, ['performanceconstraints', 'performance_constraints'])),
          reliability_constraints: toStringArray(getValueByAliases(technicalRequirements, ['reliabilityconstraints', 'reliability_constraints'])),
          error_handling_rules: toStringArray(getValueByAliases(technicalRequirements, ['errorhandlingrules', 'error_handling_rules'])),
          tooling_assumptions: toStringArray(getValueByAliases(technicalRequirements, ['toolingassumptions', 'tooling_assumptions'])),
        },
        epics,
        risks: toStringArray(getValueByAliases(parsed, ['risks'])),
        approval: {
          approved_by: typeof getValueByAliases(approval, ['approvedby', 'approved_by']) === 'string'
            ? String(getValueByAliases(approval, ['approvedby', 'approved_by'])).trim()
            : '',
          approved_at: typeof getValueByAliases(approval, ['approvedat', 'approved_at']) === 'string'
            ? String(getValueByAliases(approval, ['approvedat', 'approved_at'])).trim()
            : '',
        },
      }

      if (!document.ticket_id) {
        document.ticket_id = options.ticketId
        repairWarnings.push('Filled missing ticket_id from runtime context.')
      }

      return {
        ok: true,
        value: document,
        normalizedContent: buildYamlDocument(document),
        repairApplied: candidate !== rawContent.trim() || repairWarnings.length > 0,
        repairWarnings,
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    ok: false,
    error: lastError,
    repairApplied: false,
    repairWarnings: [],
  }
}

function normalizeBeadSubsetEntry(value: unknown, index: number): BeadSubset {
  if (!isRecord(value)) throw new Error(`Bead at index ${index} is not an object`)

  const idValue = getValueByAliases(value, ['id', 'beadid', 'bead_id'])
  const id = typeof idValue === 'string' && idValue.trim()
    ? idValue.trim()
    : `bead-${index + 1}`

  const subset: BeadSubset = {
    id,
    title: getRequiredString(value, ['title', 'name'], `bead title at index ${index}`),
    prdRefs: toStringArray(getValueByAliases(value, ['prdrefs', 'prd_refs', 'prdreferences', 'prd_references'])),
    description: getRequiredString(value, ['description', 'details'], `bead description at index ${index}`),
    contextGuidance: getRequiredString(value, ['contextguidance', 'context_guidance', 'architecturalguidance', 'guidance'], `bead context guidance at index ${index}`),
    acceptanceCriteria: toStringArray(getValueByAliases(value, ['acceptancecriteria', 'acceptance_criteria'])),
    tests: toStringArray(getValueByAliases(value, ['tests', 'testcases', 'test_cases'])),
    testCommands: toStringArray(getValueByAliases(value, ['testcommands', 'test_commands', 'commands'])),
  }

  if (subset.acceptanceCriteria.length === 0) {
    throw new Error(`Bead ${subset.id} is missing acceptance criteria`)
  }
  if (subset.tests.length === 0) {
    throw new Error(`Bead ${subset.id} is missing tests`)
  }
  if (subset.testCommands.length === 0) {
    throw new Error(`Bead ${subset.id} is missing test commands`)
  }

  return subset
}

export function normalizeBeadSubsetYamlOutput(rawContent: string): StructuredOutputResult<BeadSubset[]> {
  const repairWarnings: string[] = []
  const candidates = collectStructuredCandidates(rawContent, {
    topLevelHints: ['beads', 'tasks', 'items'],
  })
  let lastError = 'No bead subset content found'

  for (const candidate of candidates) {
    try {
      const parsed = maybeUnwrapRecord(parseYamlOrJsonCandidate(candidate), [
        'beads',
        'tasks',
        'items',
        'issues',
        'workitems',
        'work_items',
      ])
      const entries = Array.isArray(parsed)
        ? parsed
        : isRecord(parsed)
          ? Array.isArray(getValueByAliases(parsed, ['beads', 'tasks', 'items', 'issues']))
            ? getValueByAliases(parsed, ['beads', 'tasks', 'items', 'issues']) as unknown[]
            : []
          : []

      if (entries.length === 0) {
        throw new Error('Bead subset output is empty')
      }

      const subsets = entries.map((entry, index) => normalizeBeadSubsetEntry(entry, index))
      const normalizedContent = buildYamlDocument({ beads: subsets })
      return {
        ok: true,
        value: subsets,
        normalizedContent,
        repairApplied: candidate !== rawContent.trim() || repairWarnings.length > 0,
        repairWarnings,
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    ok: false,
    error: lastError,
    repairApplied: false,
    repairWarnings,
  }
}

function normalizeVoteDraftLabel(label: string): string | null {
  const match = label.trim().match(/draft\s*(\d+)/i)
  if (!match?.[1]) return null
  return `Draft ${Number(match[1])}`
}

export function normalizeVoteScorecardOutput(
  rawContent: string,
  draftLabels: string[],
  rubricCategories: string[],
): StructuredOutputResult<VoteScorecard> {
  const repairWarnings: string[] = []
  const candidates = collectStructuredCandidates(rawContent, {
    topLevelHints: ['draft_scores'],
  })
  let lastError = 'No vote scorecard content found'

  for (const candidate of candidates) {
    try {
      const parsed = unwrapExplicitWrapperRecord(parseYamlOrJsonCandidate(candidate), [
        'draftscores',
        'draft_scores',
        'scores',
        'scorecard',
      ])

      const root = isRecord(parsed) ? parsed : null
      const draftScoresRecord = root
        ? isRecord(getValueByAliases(root, ['draftscores', 'draft_scores']))
          ? getValueByAliases(root, ['draftscores', 'draft_scores']) as Record<string, unknown>
          : root
        : null

      if (!draftScoresRecord) throw new Error('Vote scorecard is not a YAML/JSON mapping')
      const expectedDraftLabels = new Set(draftLabels)
      const normalizedDraftEntries = new Map<string, Record<string, unknown>>()

      for (const [key, value] of Object.entries(draftScoresRecord)) {
        const normalizedLabel = normalizeVoteDraftLabel(key)
        if (!normalizedLabel || !expectedDraftLabels.has(normalizedLabel)) {
          throw new Error(`Unknown scorecard for ${key}`)
        }
        if (!isRecord(value)) {
          throw new Error(`Scorecard for ${normalizedLabel} is not a YAML/JSON mapping`)
        }
        if (normalizedDraftEntries.has(normalizedLabel)) {
          throw new Error(`Duplicate scorecard for ${normalizedLabel}`)
        }
        normalizedDraftEntries.set(normalizedLabel, value)
      }

      const normalized: VoteScorecard['draftScores'] = {}

      for (const draftLabel of draftLabels) {
        const draftRecord = normalizedDraftEntries.get(draftLabel)
        if (!draftRecord) {
          throw new Error(`Missing scorecard for ${draftLabel}`)
        }
        const scores: Record<string, number> = {}
        let total = 0

        for (const category of rubricCategories) {
          const rawValue = getValueByAliases(draftRecord, [normalizeKey(category)])
          if (typeof rawValue !== 'number' || !Number.isInteger(rawValue) || rawValue < 0 || rawValue > 20) {
            throw new Error(`Invalid score for ${draftLabel} / ${category}`)
          }
          scores[category] = rawValue
          total += rawValue
        }

        const totalScore = getValueByAliases(draftRecord, ['totalscore', 'total_score'])
        if (totalScore === undefined) {
          repairWarnings.push(`Filled missing total_score for ${draftLabel} from rubric category totals.`)
        } else if (typeof totalScore !== 'number' || !Number.isInteger(totalScore)) {
          throw new Error(`Invalid total_score for ${draftLabel}`)
        } else if (totalScore !== total) {
          repairWarnings.push(`Recomputed total_score for ${draftLabel}: expected ${total}, received ${totalScore}.`)
        }
        scores.total_score = total
        normalized[draftLabel] = scores
      }

      return {
        ok: true,
        value: { draftScores: normalized },
        normalizedContent: buildYamlDocument({ draft_scores: normalized }),
        repairApplied: candidate !== rawContent.trim() || repairWarnings.length > 0,
        repairWarnings,
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    ok: false,
    error: lastError,
    repairApplied: false,
    repairWarnings,
  }
}

function normalizeCoverageFollowUpQuestions(value: unknown): CoverageFollowUpQuestion[] {
  if (!Array.isArray(value)) return []
  return value.map((entry, index) => {
    if (typeof entry === 'string') {
      return {
        id: `FU${index + 1}`,
        question: entry.trim(),
      }
    }

    const record = isRecord(entry) ? entry : {}
    const question = typeof record.question === 'string'
      ? record.question
      : typeof record.prompt === 'string'
        ? record.prompt
        : typeof record.text === 'string'
          ? record.text
          : ''
    return {
      id: typeof record.id === 'string' ? record.id : `FU${index + 1}`,
      question: question.trim(),
      phase: typeof record.phase === 'string' ? record.phase : undefined,
      priority: typeof record.priority === 'string' ? record.priority : undefined,
      rationale: typeof record.rationale === 'string' ? record.rationale : undefined,
    }
  }).filter((entry) => entry.question.length > 0)
}

function parseCoverageResultCandidate(candidate: string): CoverageResultEnvelope {
  const parsed = maybeUnwrapRecord(parseYamlOrJsonCandidate(candidate), [
    'coverage',
    'result',
    'output',
    'data',
  ])
  if (!isRecord(parsed)) throw new Error('Coverage output is not a YAML/JSON object')

  const rawStatus = typeof getValueByAliases(parsed, ['status']) === 'string'
    ? String(getValueByAliases(parsed, ['status'])).trim().toLowerCase()
    : ''
  const gaps = toStringArray(getValueByAliases(parsed, ['gaps', 'issues']))
  const followUpQuestions = normalizeCoverageFollowUpQuestions(
    getValueByAliases(parsed, ['followupquestions', 'follow_up_questions']),
  )

  const status: CoverageResultEnvelope['status'] = rawStatus === 'clean'
    || rawStatus === 'pass'
    || rawStatus === 'coverage_complete'
    || rawStatus === 'coverage_pass'
    ? 'clean'
    : rawStatus === 'gaps'
      || rawStatus === 'fail'
      || rawStatus === 'coverage_gaps'
      || rawStatus === 'coverage_fail'
      ? 'gaps'
      : followUpQuestions.length > 0 || gaps.length > 0
        ? 'gaps'
        : (() => { throw new Error('Coverage output missing valid status') })()

  return {
    status,
    gaps,
    followUpQuestions,
  }
}

export function normalizeCoverageResultOutput(rawContent: string): StructuredOutputResult<CoverageResultEnvelope> {
  const candidates = collectStructuredCandidates(rawContent, {
    topLevelHints: ['status', 'gaps', 'follow_up_questions', 'followUpQuestions'],
  })
  let lastError = 'No coverage result content found'

  for (const candidate of candidates) {
    let repairWarnings: string[] = []
    let repairApplied = false

    try {
      const value = parseCoverageResultCandidate(candidate)

      return {
        ok: true,
        value,
        normalizedContent: buildYamlDocument({
          status: value.status,
          gaps: value.gaps,
          follow_up_questions: value.followUpQuestions,
        }),
        repairApplied: candidate !== rawContent.trim(),
        repairWarnings,
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)

      const repairedCandidate = repairCoverageGapStringList(candidate)
      if (!repairedCandidate.repairApplied) {
        continue
      }

      try {
        const value = parseCoverageResultCandidate(repairedCandidate.content)
        repairApplied = true
        repairWarnings = [...repairedCandidate.repairWarnings]

        return {
          ok: true,
          value,
          normalizedContent: buildYamlDocument({
            status: value.status,
            gaps: value.gaps,
            follow_up_questions: value.followUpQuestions,
          }),
          repairApplied: candidate !== rawContent.trim() || repairApplied,
          repairWarnings,
        }
      } catch (repairError) {
        lastError = repairError instanceof Error ? repairError.message : String(repairError)
      }
    }
  }

  return {
    ok: false,
    error: lastError,
    repairApplied: false,
    repairWarnings: [],
  }
}

function normalizeCompletionStatus(value: unknown): 'completed' | 'failed' {
  const raw = getRequiredString({ status: value }, ['status'], 'status')
  const normalized = normalizeKey(raw)
  if (['completed', 'complete', 'done', 'success', 'succeeded'].includes(normalized)) {
    return 'completed'
  }
  if (['failed', 'fail', 'error'].includes(normalized)) {
    return 'failed'
  }
  throw new Error(`Invalid completion status: ${raw}`)
}

function normalizeCompletionCheckValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'pass' : 'fail'
  if (typeof value === 'number') {
    if (value === 1) return 'pass'
    if (value === 0) return 'fail'
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Completion marker check value must be a non-empty string')
  }

  const normalized = normalizeKey(value)
  if (['pass', 'passed', 'ok', 'success', 'true', 'complete', 'completed'].includes(normalized)) {
    return 'pass'
  }
  if (['fail', 'failed', 'false', 'error', 'timeout', 'timedout', 'notrun', 'skipped', 'pending'].includes(normalized)) {
    return 'fail'
  }
  return value.trim().toLowerCase()
}

function normalizeCompletionChecks(value: unknown): BeadChecks {
  if (!isRecord(value)) throw new Error('Completion marker missing checks object')

  const tests = getValueByAliases(value, ['tests', 'test'])
  const lint = getValueByAliases(value, ['lint', 'linter'])
  const typecheck = getValueByAliases(value, ['typecheck', 'type_check', 'type-check', 'typechecks', 'typescript'])
  const qualitative = getValueByAliases(value, ['qualitative', 'quality', 'qualitativereview', 'qualitative_review', 'review'])

  if (tests === undefined) throw new Error('Missing quality gate: tests')
  if (lint === undefined) throw new Error('Missing quality gate: lint')
  if (typecheck === undefined) throw new Error('Missing quality gate: typecheck')
  if (qualitative === undefined) throw new Error('Missing quality gate: qualitative')

  return {
    tests: normalizeCompletionCheckValue(tests),
    lint: normalizeCompletionCheckValue(lint),
    typecheck: normalizeCompletionCheckValue(typecheck),
    qualitative: normalizeCompletionCheckValue(qualitative),
  }
}

export function normalizeBeadCompletionMarkerOutput(rawContent: string): StructuredOutputResult<BeadCompletionPayload> {
  const repairWarnings: string[] = []
  const rawTrimmed = rawContent.trim()
  const candidates = collectTaggedCandidates(rawContent, 'BEAD_STATUS')
  let lastError = 'No completion marker found'

  if (candidates.length === 0) {
    return {
      ok: false,
      error: lastError,
      repairApplied: false,
      repairWarnings,
    }
  }

  for (const candidate of candidates) {
    try {
      const parsed = maybeUnwrapRecord(parseYamlOrJsonCandidate(candidate), [
        'beadstatus',
        'bead_status',
        'statusmarker',
        'marker',
        'result',
        'output',
        'data',
      ])
      if (!isRecord(parsed)) throw new Error('Completion marker payload is not a YAML/JSON object')

      const beadId = getRequiredString(parsed, ['beadid', 'bead_id', 'id'], 'bead_id')
      const status = normalizeCompletionStatus(getValueByAliases(parsed, ['status']))
      const checks = normalizeCompletionChecks(getValueByAliases(parsed, ['checks', 'gates', 'qualitygates', 'quality_gates']))
      const reason = toOptionalString(getValueByAliases(parsed, ['reason', 'details', 'message']))

      return {
        ok: true,
        value: {
          beadId,
          status,
          checks,
          ...(reason ? { reason } : {}),
        },
        normalizedContent: JSON.stringify({
          bead_id: beadId,
          status,
          checks,
          ...(reason ? { reason } : {}),
        }),
        repairApplied: candidate !== rawTrimmed,
        repairWarnings,
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    ok: false,
    error: lastError,
    repairApplied: false,
    repairWarnings,
  }
}

export function normalizeFinalTestCommandsOutput(rawContent: string): StructuredOutputResult<FinalTestCommandPayload> {
  const repairWarnings: string[] = []
  const rawTrimmed = rawContent.trim()
  const candidates = collectTaggedCandidates(rawContent, 'FINAL_TEST_COMMANDS')
  let lastError = 'No final test command marker found'

  if (candidates.length === 0) {
    return {
      ok: false,
      error: lastError,
      repairApplied: false,
      repairWarnings,
    }
  }

  for (const candidate of candidates) {
    try {
      const parsed = unwrapExplicitWrapperRecord(parseYamlOrJsonCandidate(candidate), [
        'finaltestcommands',
        'final_test_commands',
        'commandplan',
        'command_plan',
        'plan',
        'result',
        'output',
        'data',
      ])
      if (!isRecord(parsed)) throw new Error('Final test command payload is not a YAML/JSON object')

      const commands = toStringArray(getValueByAliases(parsed, ['commands', 'commandlist', 'command_list', 'cmds', 'cmd']))
      if (commands.length === 0) {
        throw new Error('No executable final test commands were provided')
      }

      const summary = toOptionalString(getValueByAliases(parsed, ['summary', 'reason', 'notes'])) ?? null

      return {
        ok: true,
        value: {
          commands,
          summary,
        },
        normalizedContent: JSON.stringify(summary
          ? { commands, summary }
          : { commands }),
        repairApplied: candidate !== rawTrimmed,
        repairWarnings,
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    ok: false,
    error: lastError,
    repairApplied: false,
    repairWarnings,
  }
}

function parseJsonLines(content: string): unknown[] {
  const trimmed = content.trim()
  if (!trimmed) return []

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed)
    return Array.isArray(parsed) ? parsed : []
  }

  return trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function normalizeBeadRecord(value: unknown, index: number): Bead {
  if (!isRecord(value)) throw new Error(`Bead JSONL entry at index ${index} is not an object`)

  const dependenciesValue = getValueByAliases(value, ['dependencies'])
  const blockedBy = isRecord(dependenciesValue)
    ? toStringArray(getValueByAliases(dependenciesValue, ['blockedby', 'blocked_by']))
    : toStringArray(dependenciesValue)
  const bead: Bead = {
    id: getRequiredString(value, ['id'], `bead id at index ${index}`),
    title: getRequiredString(value, ['title'], `bead title at index ${index}`),
    prdRefs: toStringArray(getValueByAliases(value, ['prdrefs', 'prd_refs', 'prdreferences', 'prd_references'])),
    description: getRequiredString(value, ['description'], `bead description at index ${index}`),
    contextGuidance: typeof getValueByAliases(value, ['contextguidance', 'context_guidance']) === 'string'
      ? String(getValueByAliases(value, ['contextguidance', 'context_guidance'])).trim()
      : '',
    acceptanceCriteria: toStringArray(getValueByAliases(value, ['acceptancecriteria', 'acceptance_criteria'])),
    tests: toStringArray(getValueByAliases(value, ['tests'])),
    testCommands: toStringArray(getValueByAliases(value, ['testcommands', 'test_commands'])),
    priority: Number(getValueByAliases(value, ['priority']) ?? index + 1),
    status: (typeof getValueByAliases(value, ['status']) === 'string'
      ? String(getValueByAliases(value, ['status'])).trim()
      : 'pending') as Bead['status'],
    labels: toStringArray(getValueByAliases(value, ['labels'])),
    dependencies: [...new Set(blockedBy)],
    targetFiles: toStringArray(getValueByAliases(value, ['targetfiles', 'target_files'])),
    notes: toStringArray(getValueByAliases(value, ['notes'])),
    iteration: Number(getValueByAliases(value, ['iteration']) ?? 1),
    createdAt: typeof getValueByAliases(value, ['createdat', 'created_at']) === 'string'
      ? String(getValueByAliases(value, ['createdat', 'created_at'])).trim()
      : '',
    updatedAt: typeof getValueByAliases(value, ['updatedat', 'updated_at']) === 'string'
      ? String(getValueByAliases(value, ['updatedat', 'updated_at'])).trim()
      : '',
    beadStartCommit: typeof getValueByAliases(value, ['beadstartcommit', 'bead_start_commit']) === 'string'
      ? String(getValueByAliases(value, ['beadstartcommit', 'bead_start_commit'])).trim() || null
      : null,
    estimatedComplexity: (typeof getValueByAliases(value, ['estimatedcomplexity', 'estimated_complexity']) === 'string'
      ? String(getValueByAliases(value, ['estimatedcomplexity', 'estimated_complexity'])).trim()
      : 'moderate') as Bead['estimatedComplexity'],
    epicId: typeof getValueByAliases(value, ['epicid', 'epic_id']) === 'string'
      ? String(getValueByAliases(value, ['epicid', 'epic_id'])).trim()
      : '',
    storyId: typeof getValueByAliases(value, ['storyid', 'story_id']) === 'string'
      ? String(getValueByAliases(value, ['storyid', 'story_id'])).trim()
      : '',
  }

  if (!Number.isInteger(bead.priority) || bead.priority <= 0) {
    throw new Error(`Bead ${bead.id} has invalid priority`)
  }
  if (bead.acceptanceCriteria.length === 0) {
    throw new Error(`Bead ${bead.id} is missing acceptance criteria`)
  }
  if (bead.tests.length === 0) {
    throw new Error(`Bead ${bead.id} is missing tests`)
  }

  return bead
}

export function normalizeBeadsJsonlOutput(rawContent: string): StructuredOutputResult<Bead[]> {
  const repairWarnings: string[] = []
  const candidates = collectStructuredCandidates(rawContent)
  let lastError = 'No beads JSONL content found'

  for (const candidate of candidates) {
    try {
      const parsedEntries = parseJsonLines(candidate)
      if (parsedEntries.length === 0) throw new Error('Beads JSONL output is empty')

      const beads = parsedEntries.map((entry, index) => normalizeBeadRecord(entry, index))
      const beadIds = new Set<string>()
      for (const bead of beads) {
        if (beadIds.has(bead.id)) throw new Error(`Duplicate bead id: ${bead.id}`)
        beadIds.add(bead.id)
        if (bead.dependencies.includes(bead.id)) {
          throw new Error(`Bead ${bead.id} has a self-dependency`)
        }
        for (const dependency of bead.dependencies) {
          if (!beadIds.has(dependency) && !beads.some((candidateBead) => candidateBead.id === dependency)) {
            throw new Error(`Bead ${bead.id} depends on unknown bead ${dependency}`)
          }
        }
      }

      return {
        ok: true,
        value: beads,
        normalizedContent: buildJsonlDocument(beads as unknown as Record<string, unknown>[]),
        repairApplied: candidate !== rawContent.trim() || repairWarnings.length > 0,
        repairWarnings,
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    ok: false,
    error: lastError,
    repairApplied: false,
    repairWarnings,
  }
}

export function buildStructuredRetryPrompt(
  baseParts: PromptPart[],
  options: {
    validationError: string
    rawResponse: string
    schemaReminder?: string
  },
): PromptPart[] {
  return [
    ...baseParts,
    {
      type: 'text',
      content: [
        '## Structured Output Retry',
        `Your previous response failed machine validation: ${options.validationError}`,
        'Return only a corrected artifact in the required structured format.',
        options.schemaReminder ? `Schema reminder:\n${options.schemaReminder}` : '',
        'Previous invalid response:',
        '```',
        options.rawResponse.trim() || '[empty response]',
        '```',
      ].filter(Boolean).join('\n\n'),
    },
  ]
}
