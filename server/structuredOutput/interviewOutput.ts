import { parseInterviewQuestions, type ParsedInterviewQuestion } from '../phases/interview/questions'
import type { InterviewQuestionChangeType } from '@shared/interviewQuestions'
import { MAX_SINGLE_CHOICE_OPTIONS, MAX_MULTIPLE_CHOICE_OPTIONS } from '../lib/constants'
import type {
  InterviewBatchPayload,
  InterviewBatchPayloadQuestion,
  InterviewTurnOutput,
  CoverageFollowUpQuestion,
  CoverageResultEnvelope,
  StructuredOutputResult,
} from './types'
import {
  isRecord,
  normalizeKey,
  collectStructuredCandidates,
  collectTaggedCandidates,
  parseYamlOrJsonCandidate,
  repairCoverageGapStringList,
  maybeUnwrapRecord,
  unwrapExplicitWrapperRecord,
  toStringArray,
  toOptionalString,
  toInteger,
  toBoolean,
  getValueByAliases,
  getNestedRecord,
  getRequiredString,
  buildYamlDocument,
} from './yamlUtils'
import { MAX_INTERVIEW_BATCH_SIZE } from '../lib/constants'

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
  repairApplied: boolean
  repairWarnings: string[]
} {
  const repairWarnings: string[] = []
  let repairApplied = false

  // Find the maximum numeric ID across all questions so duplicates can be
  // renumbered above the current ceiling instead of throwing.
  let maxNumericId = 0
  for (const question of parsed) {
    const match = question.id.trim().match(/q?(\d+)/i)
    if (match?.[1]) {
      maxNumericId = Math.max(maxNumericId, Number(match[1]))
    }
  }
  let nextAvailableId = maxNumericId + 1

  const seenIds = new Set<string>()
  const normalized = parsed.map((question, index) => {
    let id = normalizeInterviewId(question.id)
    const phase = normalizeInterviewPhase(question.phase)
    const text = question.question.trim()
    if (!text) throw new Error(`Empty question text at index ${index}`)

    if (seenIds.has(id)) {
      const newId = `Q${String(nextAvailableId).padStart(2, '0')}`
      repairWarnings.push(`Renumbered duplicate question id ${id} at index ${index} to ${newId}.`)
      id = newId
      nextAvailableId += 1
      repairApplied = true
    }
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
    repairApplied,
    repairWarnings,
  }
}

function normalizeStructuredInterviewQuestionList(
  rawQuestions: unknown[],
  maxInitialQuestions: number,
): {
  questions: NormalizedInterviewQuestion[]
  questionCount: number
  reordered: boolean
  repairApplied: boolean
  repairWarnings: string[]
} {
  const parsed = parseInterviewQuestions(buildYamlDocument({ questions: rawQuestions }))
  const normalized = normalizeParsedInterviewQuestionList(parsed, maxInitialQuestions)
  return {
    questions: normalized.questions,
    questionCount: normalized.questions.length,
    reordered: normalized.reordered,
    repairApplied: normalized.repairApplied,
    repairWarnings: normalized.repairWarnings,
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

  // Repair added → replaced where the model reused a winner-draft question ID
  // but declared the change as "added" instead of "replaced"
  const accountedWinnerIds = new Set(
    normalizedChanges.filter(c => c.before).map(c => c.before!.id),
  )
  const winnerById = new Map(
    winnerQuestions
      .filter(q => !accountedWinnerIds.has(q.id))
      .map(q => [q.id, q] as const),
  )
  for (const [i, change] of normalizedChanges.entries()) {
    if (change.type === 'added' && change.before === null && change.after) {
      const orphanedWinner = winnerById.get(change.after.id)
      if (orphanedWinner && buildInterviewQuestionKey(orphanedWinner) !== buildInterviewQuestionKey(change.after)) {
        normalizedChanges[i] = { type: 'replaced', before: orphanedWinner, after: change.after }
        winnerById.delete(change.after.id)
        repairApplied = true
        repairWarnings.push(
          `Converted interview refinement change at index ${i} from "added" to "replaced" because ${change.after.id} already existed in the winning draft with different content.`,
        )
      }
    }
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

function normalizeInterviewBatchAnswerType(value: unknown): 'free_text' | 'single_choice' | 'multiple_choice' | 'yes_no' | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = normalizeKey(value)
  if (normalized === 'yesno' || normalized === 'yes_no' || normalized === 'boolean' || normalized === 'bool') return 'yes_no'
  if (normalized === 'singlechoice' || normalized === 'singlechoice' || normalized === 'radio' || normalized === 'single') return 'single_choice'
  if (normalized === 'multiplechoice' || normalized === 'multchoice' || normalized === 'multi' || normalized === 'checkbox' || normalized === 'multichoice') return 'multiple_choice'
  if (normalized === 'freetext' || normalized === 'free' || normalized === 'text' || normalized === 'open') return 'free_text'
  return undefined
}

function normalizeInterviewBatchOption(value: unknown, index: number): { id: string; label: string } | null {
  if (typeof value === 'string') {
    const label = value.trim()
    if (!label) return null
    return { id: `opt${index + 1}`, label }
  }
  if (!isRecord(value)) return null
  const id = toOptionalString(getValueByAliases(value, ['id', 'key', 'value'])) ?? `opt${index + 1}`
  const label = toOptionalString(getValueByAliases(value, ['label', 'text', 'name', 'option', 'description']))
  if (!label) return null
  return { id: id.trim(), label: label.trim() }
}

function dedupeQuestionOptions<T extends { id: string; label: string }>(
  options: T[] | undefined,
  contextLabel: string,
): {
  options: T[] | undefined
  repairWarnings: string[]
} {
  if (!options || options.length === 0) {
    return { options, repairWarnings: [] }
  }

  const deduped: T[] = []
  const seenIds = new Set<string>()
  const duplicateIds = new Set<string>()

  for (const option of options) {
    if (seenIds.has(option.id)) {
      duplicateIds.add(option.id)
      continue
    }
    seenIds.add(option.id)
    deduped.push(option)
  }

  if (duplicateIds.size === 0) {
    return { options, repairWarnings: [] }
  }

  return {
    options: deduped,
    repairWarnings: [
      `${contextLabel}: removed duplicate option ids ${Array.from(duplicateIds).join(', ')} and kept the first occurrence.`,
    ],
  }
}

function normalizeInterviewBatchQuestion(value: unknown, index: number): {
  question: InterviewBatchPayloadQuestion
  repairWarnings: string[]
} {
  if (!isRecord(value)) throw new Error(`Interview batch question at index ${index} is not an object`)

  const repairWarnings: string[] = []
  const id = getRequiredString(value, ['id', 'questionid', 'question_id'], `question id at index ${index}`).trim()
  const question = getRequiredString(value, ['question', 'prompt', 'text'], `question text at index ${index}`)
  const phase = normalizeInterviewBatchPhase(getValueByAliases(value, ['phase', 'category', 'stage', 'section']))
  const priority = normalizeInterviewBatchPriority(getValueByAliases(value, ['priority']))
  const rationale = toOptionalString(getValueByAliases(value, ['rationale', 'reason']))
  const rawAnswerType = getValueByAliases(value, ['answertype', 'answer_type', 'type', 'inputtype', 'input_type'])
  const rawNormAnswerType = normalizeInterviewBatchAnswerType(rawAnswerType)
  const rawOptions = getValueByAliases(value, ['options', 'choices', 'answers'])
  const parsedOptions = Array.isArray(rawOptions)
    ? rawOptions.map((opt, i) => normalizeInterviewBatchOption(opt, i)).filter((opt): opt is { id: string; label: string } => opt !== null)
    : undefined

  // Handle yes_no → single_choice expansion
  let finalAnswerType: 'free_text' | 'single_choice' | 'multiple_choice' | undefined = rawNormAnswerType === 'yes_no' ? 'single_choice' : rawNormAnswerType
  let finalOptions = rawNormAnswerType === 'yes_no'
    ? [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }]
    : parsedOptions

  const dedupedOptions = dedupeQuestionOptions(finalOptions, `Interview batch question ${id}`)
  finalOptions = dedupedOptions.options
  repairWarnings.push(...dedupedOptions.repairWarnings)

  // Enforce option limits and downgrade empty-option choice types
  if (finalAnswerType === 'single_choice') {
    if (!finalOptions || finalOptions.length === 0) {
      finalAnswerType = undefined
      finalOptions = undefined
    } else if (finalOptions.length > MAX_SINGLE_CHOICE_OPTIONS) {
      finalOptions = finalOptions.slice(0, MAX_SINGLE_CHOICE_OPTIONS)
    }
  } else if (finalAnswerType === 'multiple_choice') {
    if (!finalOptions || finalOptions.length === 0) {
      finalAnswerType = undefined
      finalOptions = undefined
    } else if (finalOptions.length > MAX_MULTIPLE_CHOICE_OPTIONS) {
      finalOptions = finalOptions.slice(0, MAX_MULTIPLE_CHOICE_OPTIONS)
    }
  }

  return {
    question: {
      id,
      question: question.trim(),
      ...(phase ? { phase } : {}),
      ...(priority ? { priority } : {}),
      ...(rationale ? { rationale } : {}),
      ...(finalAnswerType && finalAnswerType !== 'free_text' ? { answerType: finalAnswerType } : {}),
      ...(finalOptions && finalOptions.length > 0 ? { options: finalOptions } : {}),
    },
    repairWarnings,
  }
}

function normalizeInterviewBatchPayload(value: unknown): {
  batch: InterviewBatchPayload
  repairWarnings: string[]
} {
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

  const normalizedQuestions = rawQuestions.map((question, index) => normalizeInterviewBatchQuestion(question, index))
  const repairWarnings = normalizedQuestions.flatMap((question) => question.repairWarnings)
  const questions = normalizedQuestions.map((question) => question.question)

  // Enforce architecture batch size limit (1-3 questions per batch)
  if (questions.length > MAX_INTERVIEW_BATCH_SIZE) {
    questions.length = MAX_INTERVIEW_BATCH_SIZE
  }

  return {
    batch: {
      batchNumber,
      progress: { current, total },
      isFinalFreeForm: toBoolean(getValueByAliases(parsed, ['isfinalfreeform', 'is_final_free_form'])) ?? false,
      aiCommentary: toOptionalString(getValueByAliases(parsed, ['aicommentary', 'ai_commentary', 'commentary', 'notes'])) ?? '',
      questions,
    },
    repairWarnings,
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
      const normalizedBatch = normalizeInterviewBatchPayload(parseYamlOrJsonCandidate(candidate))
      const candidateWarnings = [...repairWarnings, ...normalizedBatch.repairWarnings]
      return {
        ok: true,
        value: {
          kind: 'batch',
          batch: normalizedBatch.batch,
        },
        normalizedContent: buildYamlDocument({
          batch_number: normalizedBatch.batch.batchNumber,
          progress: normalizedBatch.batch.progress,
          is_final_free_form: normalizedBatch.batch.isFinalFreeForm,
          ai_commentary: normalizedBatch.batch.aiCommentary,
          questions: normalizedBatch.batch.questions,
        }),
        repairApplied: candidate !== rawTrimmed || candidateWarnings.length > 0,
        repairWarnings: candidateWarnings,
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
      const normalizedBatch = normalizeInterviewBatchPayload(parseYamlOrJsonCandidate(candidate))
      const candidateWarnings = [...repairWarnings, ...normalizedBatch.repairWarnings]
      return {
        ok: true,
        value: {
          kind: 'batch',
          batch: normalizedBatch.batch,
        },
        normalizedContent: buildYamlDocument({
          batch_number: normalizedBatch.batch.batchNumber,
          progress: normalizedBatch.batch.progress,
          is_final_free_form: normalizedBatch.batch.isFinalFreeForm,
          ai_commentary: normalizedBatch.batch.aiCommentary,
          questions: normalizedBatch.batch.questions,
        }),
        repairApplied: candidate !== rawTrimmed || candidateWarnings.length > 0,
        repairWarnings: candidateWarnings,
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

      if (normalized.repairApplied) {
        repairApplied = true
        repairWarnings.push(...normalized.repairWarnings)
      }
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
      if (normalizedQuestions.repairApplied) {
        repairApplied = true
        repairWarnings.push(...normalizedQuestions.repairWarnings)
      }
      if (normalizedQuestions.reordered) {
        repairApplied = true
        repairWarnings.push('Applied stable interview phase reordering (foundation -> structure -> assembly).')
      }

      const winnerDraftNormalized = normalizeParsedInterviewQuestionList(parseInterviewQuestions(winnerDraftContent), 0)
      if (winnerDraftNormalized.repairApplied) {
        repairApplied = true
        repairWarnings.push(...winnerDraftNormalized.repairWarnings)
      }
      const winnerDraftQuestions = winnerDraftNormalized.questions
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

function normalizeCoverageFollowUpQuestions(value: unknown): {
  questions: CoverageFollowUpQuestion[]
  repairWarnings: string[]
} {
  if (!Array.isArray(value)) return { questions: [], repairWarnings: [] }

  const repairWarnings: string[] = []
  const questions = value.map((entry, index) => {
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

    // Normalize answer type and options for coverage follow-ups
    const rawAnswerType = getValueByAliases(record, ['answertype', 'answer_type', 'type', 'inputtype', 'input_type'])
    const rawNormAnswerType = normalizeInterviewBatchAnswerType(rawAnswerType)
    const rawOptions = getValueByAliases(record, ['options', 'choices', 'answers'])
    const parsedOptions = Array.isArray(rawOptions)
      ? rawOptions.map((opt, i) => normalizeInterviewBatchOption(opt, i)).filter((opt): opt is { id: string; label: string } => opt !== null)
      : undefined

    // Handle yes_no → single_choice expansion
    let finalAnswerType: 'free_text' | 'single_choice' | 'multiple_choice' | undefined = rawNormAnswerType === 'yes_no' ? 'single_choice' : rawNormAnswerType
    let finalOptions = rawNormAnswerType === 'yes_no'
      ? [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }]
      : parsedOptions
    const questionId = typeof record.id === 'string' ? record.id : `FU${index + 1}`

    const dedupedOptions = dedupeQuestionOptions(finalOptions, `Coverage follow-up question ${questionId}`)
    finalOptions = dedupedOptions.options
    repairWarnings.push(...dedupedOptions.repairWarnings)

    // Enforce option limits and downgrade empty-option choice types
    if (finalAnswerType === 'single_choice') {
      if (!finalOptions || finalOptions.length === 0) {
        finalAnswerType = undefined
        finalOptions = undefined
      } else if (finalOptions.length > MAX_SINGLE_CHOICE_OPTIONS) {
        finalOptions = finalOptions.slice(0, MAX_SINGLE_CHOICE_OPTIONS)
      }
    } else if (finalAnswerType === 'multiple_choice') {
      if (!finalOptions || finalOptions.length === 0) {
        finalAnswerType = undefined
        finalOptions = undefined
      } else if (finalOptions.length > MAX_MULTIPLE_CHOICE_OPTIONS) {
        finalOptions = finalOptions.slice(0, MAX_MULTIPLE_CHOICE_OPTIONS)
      }
    }

    return {
      id: questionId,
      question: question.trim(),
      phase: typeof record.phase === 'string' ? record.phase : undefined,
      priority: typeof record.priority === 'string' ? record.priority : undefined,
      rationale: typeof record.rationale === 'string' ? record.rationale : undefined,
      ...(finalAnswerType && finalAnswerType !== 'free_text' ? { answerType: finalAnswerType } : {}),
      ...(finalOptions && finalOptions.length > 0 ? { options: finalOptions } : {}),
    }
  }).filter((entry) => entry.question.length > 0)

  return { questions, repairWarnings }
}

function parseCoverageResultCandidate(candidate: string): {
  value: CoverageResultEnvelope
  repairWarnings: string[]
} {
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
  const normalizedFollowUps = normalizeCoverageFollowUpQuestions(
    getValueByAliases(parsed, ['followupquestions', 'follow_up_questions']),
  )
  const followUpQuestions = normalizedFollowUps.questions

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
    value: {
      status,
      gaps,
      followUpQuestions,
    },
    repairWarnings: normalizedFollowUps.repairWarnings,
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
      const normalized = parseCoverageResultCandidate(candidate)

      return {
        ok: true,
        value: normalized.value,
        normalizedContent: buildYamlDocument({
          status: normalized.value.status,
          gaps: normalized.value.gaps,
          follow_up_questions: normalized.value.followUpQuestions,
        }),
        repairApplied: candidate !== rawContent.trim() || normalized.repairWarnings.length > 0,
        repairWarnings: normalized.repairWarnings,
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)

      const repairedCandidate = repairCoverageGapStringList(candidate)
      if (!repairedCandidate.repairApplied) {
        continue
      }

      try {
        const normalized = parseCoverageResultCandidate(repairedCandidate.content)
        repairApplied = true
        repairWarnings = [...repairedCandidate.repairWarnings, ...normalized.repairWarnings]

        return {
          ok: true,
          value: normalized.value,
          normalizedContent: buildYamlDocument({
            status: normalized.value.status,
            gaps: normalized.value.gaps,
            follow_up_questions: normalized.value.followUpQuestions,
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
