import type {
  InterviewAnswerUpdate,
  InterviewDocument,
  InterviewDocumentAnswer,
  InterviewDocumentFollowUpRound,
  InterviewDocumentGeneratedBy,
  InterviewDocumentQuestion,
} from '@shared/interviewArtifact'
import type {
  InterviewBatchSource,
  InterviewQuestionAnswerType,
  InterviewQuestionOption,
  InterviewQuestionSource,
} from '@shared/interviewSession'
import type { StructuredOutputResult } from './types'
import {
  buildYamlDocument,
  collectStructuredCandidates,
  getNestedRecord,
  getRequiredString,
  getValueByAliases,
  isRecord,
  normalizeKey,
  parseYamlOrJsonCandidate,
  toBoolean,
  toInteger,
  toOptionalString,
  toStringArray,
  unwrapExplicitWrapperRecord,
} from './yamlUtils'

const INTERVIEW_DOCUMENT_NESTED_MAPPING_CHILDREN = {
  generated_by: ['winner_model', 'generated_at', 'canonicalization'],
  answer: ['skipped', 'selected_option_ids', 'free_text', 'answered_by', 'answered_at'],
  summary: ['goals', 'constraints', 'non_goals', 'final_free_form_answer'],
  approval: ['approved_by', 'approved_at'],
} as const

function normalizePhaseLabel(value: string): string {
  const trimmed = value.trim()
  const normalized = normalizeKey(trimmed)
  if (normalized === 'foundation') return 'Foundation'
  if (normalized === 'structure') return 'Structure'
  if (normalized === 'assembly') return 'Assembly'
  return trimmed
}

function normalizeQuestionSource(value: unknown): InterviewQuestionSource {
  const raw = toOptionalString(value)
  const normalized = normalizeKey(raw ?? '')
  if (normalized === 'compiled') return 'compiled'
  if (normalized === 'promptfollowup' || normalized === 'prompt_follow_up') return 'prompt_follow_up'
  if (normalized === 'coveragefollowup' || normalized === 'coverage_follow_up') return 'coverage_follow_up'
  if (normalized === 'finalfreeform' || normalized === 'final_free_form') return 'final_free_form'
  return 'compiled'
}

function normalizeOption(value: unknown, index: number): InterviewQuestionOption | null {
  if (typeof value === 'string') {
    const label = value.trim()
    if (!label) return null
    return { id: `opt${index + 1}`, label }
  }
  if (!isRecord(value)) return null

  const id = toOptionalString(getValueByAliases(value, ['id', 'key', 'value'])) ?? `opt${index + 1}`
  const label = toOptionalString(getValueByAliases(value, ['label', 'text', 'name', 'option', 'description']))
  if (!label) return null

  return {
    id: id.trim(),
    label: label.trim(),
  }
}

function normalizeAnswerType(
  value: unknown,
  warnings: string[],
  label: string,
): { answerType: InterviewQuestionAnswerType; impliedOptions: InterviewQuestionOption[] | null } {
  const raw = toOptionalString(value)
  const normalized = normalizeKey(raw ?? '')
  if (!raw || normalized === 'freetext' || normalized === 'free_text' || normalized === 'text') {
    return { answerType: 'free_text', impliedOptions: null }
  }
  if (normalized === 'singlechoice' || normalized === 'single_choice' || normalized === 'radio') {
    return { answerType: 'single_choice', impliedOptions: null }
  }
  if (normalized === 'multiplechoice' || normalized === 'multiple_choice' || normalized === 'multichoice' || normalized === 'checkbox') {
    return { answerType: 'multiple_choice', impliedOptions: null }
  }
  if (normalized === 'yesno' || normalized === 'yes_no' || normalized === 'boolean' || normalized === 'bool') {
    warnings.push(`${label}: normalized yes/no answer_type to single_choice with Yes/No options.`)
    return {
      answerType: 'single_choice',
      impliedOptions: [
        { id: 'yes', label: 'Yes' },
        { id: 'no', label: 'No' },
      ],
    }
  }

  throw new Error(`${label}: unsupported answer_type "${raw}"`)
}

function normalizeGeneratedBy(record: Record<string, unknown>): InterviewDocumentGeneratedBy {
  const winnerModel = getRequiredString(record, ['winnermodel', 'winner_model'], 'generated_by.winner_model')
  const generatedAt = getRequiredString(record, ['generatedat', 'generated_at'], 'generated_by.generated_at')
  const canonicalization = toOptionalString(getValueByAliases(record, ['canonicalization']))

  return {
    winner_model: winnerModel,
    generated_at: generatedAt,
    ...(canonicalization ? { canonicalization } : {}),
  }
}

function normalizeQuestionAnswer(
  value: unknown,
  answerType: InterviewQuestionAnswerType,
  warnings: string[],
  questionId: string,
): InterviewDocumentAnswer {
  if (!isRecord(value)) {
    throw new Error(`Question ${questionId} is missing answer`)
  }

  const selectedOptionIds = Array.from(new Set(toStringArray(
    getValueByAliases(value, ['selectedoptionids', 'selected_option_ids', 'selected']),
  )))
  const freeText = typeof getValueByAliases(value, ['freetext', 'free_text', 'text']) === 'string'
    ? String(getValueByAliases(value, ['freetext', 'free_text', 'text']))
    : ''
  const explicitSkipped = toBoolean(getValueByAliases(value, ['skipped']))

  let nextSelectedOptionIds = selectedOptionIds
  if (answerType === 'free_text' && selectedOptionIds.length > 0) {
    warnings.push(`Question ${questionId}: dropped selected_option_ids for free_text answer_type.`)
    nextSelectedOptionIds = []
  }
  if (answerType === 'single_choice' && selectedOptionIds.length > 1) {
    warnings.push(`Question ${questionId}: kept only the first selected option for single_choice answer_type.`)
    nextSelectedOptionIds = selectedOptionIds.slice(0, 1)
  }

  const skipped = explicitSkipped ?? (freeText.trim().length === 0 && nextSelectedOptionIds.length === 0)
  const answeredByRaw = toOptionalString(getValueByAliases(value, ['answeredby', 'answered_by'])) ?? ''
  const answeredByNormalized = normalizeKey(answeredByRaw)
  const answeredBy = skipped
    ? 'ai_skip'
    : answeredByNormalized === 'aiskip' || answeredByNormalized === 'ai_skip'
      ? 'ai_skip'
      : 'user'
  const answeredAt = skipped
    ? ''
    : (toOptionalString(getValueByAliases(value, ['answeredat', 'answered_at'])) ?? '')

  return {
    skipped,
    selected_option_ids: nextSelectedOptionIds,
    free_text: freeText,
    answered_by: answeredBy,
    answered_at: answeredAt,
  }
}

function compareStringArrays(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function compareQuestionMetadata(
  left: InterviewDocumentQuestion,
  right: InterviewDocumentQuestion,
): boolean {
  return left.id === right.id
    && left.phase === right.phase
    && left.prompt === right.prompt
    && left.source === right.source
    && left.follow_up_round === right.follow_up_round
    && left.answer_type === right.answer_type
    && left.options.length === right.options.length
    && left.options.every((option, index) => (
      option.id === right.options[index]?.id
      && option.label === right.options[index]?.label
    ))
}

function compareQuestionAnswers(
  left: InterviewDocumentQuestion['answer'],
  right: InterviewDocumentQuestion['answer'],
): boolean {
  return left.skipped === right.skipped
    && left.free_text === right.free_text
    && left.answered_by === right.answered_by
    && left.answered_at === right.answered_at
    && compareStringArrays(left.selected_option_ids, right.selected_option_ids)
}

function answerHasContent(answer: InterviewDocumentQuestion['answer']): boolean {
  return answer.free_text.trim().length > 0 || answer.selected_option_ids.length > 0
}

function compareSummary(
  left: InterviewDocument['summary'],
  right: InterviewDocument['summary'],
): boolean {
  return compareStringArrays(left.goals, right.goals)
    && compareStringArrays(left.constraints, right.constraints)
    && compareStringArrays(left.non_goals, right.non_goals)
    && left.final_free_form_answer === right.final_free_form_answer
}

function parseExactOptionLabelSelections(
  answerText: string,
  answerType: InterviewQuestionAnswerType,
): string[] {
  const trimmed = answerText.trim()
  if (!trimmed) return []

  if (answerType === 'single_choice') {
    return [trimmed]
  }

  const newlineTokens = trimmed
    .split('\n')
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean)
  if (newlineTokens.length > 1) {
    return newlineTokens
  }

  const commaTokens = trimmed
    .split(/[;,]/)
    .map((token) => token.trim())
    .filter(Boolean)
  if (commaTokens.length > 1) {
    return commaTokens
  }

  return [trimmed]
}

function normalizeChoiceQuestionAnswer(
  canonicalQuestion: InterviewDocumentQuestion,
  candidateQuestion: InterviewDocumentQuestion,
): { selectedOptionIds: string[]; freeText: string } {
  const optionIdSet = new Set(canonicalQuestion.options.map((option) => option.id))
  const explicitSelections = Array.from(new Set(candidateQuestion.answer.selected_option_ids))

  if (explicitSelections.length > 0) {
    const invalidSelection = explicitSelections.find((optionId) => !optionIdSet.has(optionId))
    if (invalidSelection) {
      throw new Error(`Resolved interview selected unknown option id "${invalidSelection}" for canonical question ${canonicalQuestion.id}`)
    }
    if (canonicalQuestion.answer_type === 'single_choice' && explicitSelections.length !== 1) {
      throw new Error(`Resolved interview must select exactly one option for canonical question ${canonicalQuestion.id}`)
    }
    return {
      selectedOptionIds: explicitSelections,
      freeText: candidateQuestion.answer.free_text,
    }
  }

  const labels = parseExactOptionLabelSelections(candidateQuestion.answer.free_text, canonicalQuestion.answer_type)
  if (labels.length === 0) {
    throw new Error(`Resolved interview left skipped question unanswered: ${canonicalQuestion.id}`)
  }

  const normalizedOptionLabels = new Map<string, string>()
  for (const option of canonicalQuestion.options) {
    const normalized = normalizeKey(option.label)
    if (normalizedOptionLabels.has(normalized)) {
      throw new Error(`Canonical question ${canonicalQuestion.id} has ambiguous option labels after normalization`)
    }
    normalizedOptionLabels.set(normalized, option.id)
  }

  const selectedOptionIds = labels.map((label) => {
    const optionId = normalizedOptionLabels.get(normalizeKey(label))
    if (!optionId) {
      throw new Error(`Resolved interview answer for canonical question ${canonicalQuestion.id} does not map exactly to canonical options`)
    }
    return optionId
  })

  const uniqueSelections = Array.from(new Set(selectedOptionIds))
  if (canonicalQuestion.answer_type === 'single_choice' && uniqueSelections.length !== 1) {
    throw new Error(`Resolved interview must select exactly one option for canonical question ${canonicalQuestion.id}`)
  }

  return {
    selectedOptionIds: uniqueSelections,
    freeText: candidateQuestion.answer.free_text,
  }
}

function normalizeQuestion(
  value: unknown,
  index: number,
  warnings: string[],
): InterviewDocumentQuestion {
  if (!isRecord(value)) {
    throw new Error(`Question at index ${index} is not an object`)
  }

  const id = getRequiredString(value, ['id'], `questions[${index}].id`)
  const prompt = getRequiredString(value, ['prompt', 'question', 'text'], `questions[${index}].prompt`)
  const phase = normalizePhaseLabel(getRequiredString(value, ['phase'], `questions[${index}].phase`))
  const source = normalizeQuestionSource(getValueByAliases(value, ['source']))
  const followUpRound = toInteger(getValueByAliases(value, ['followupround', 'follow_up_round']))
  const { answerType, impliedOptions } = normalizeAnswerType(
    getValueByAliases(value, ['answertype', 'answer_type', 'type']),
    warnings,
    `Question ${id}`,
  )
  const rawOptions = getValueByAliases(value, ['options'])
  const normalizedOptions = Array.isArray(rawOptions)
    ? rawOptions
      .map((option, optionIndex) => normalizeOption(option, optionIndex))
      .filter((option): option is InterviewQuestionOption => option !== null)
    : []
  const options = impliedOptions ?? normalizedOptions
  if (answerType !== 'free_text' && options.length === 0) {
    throw new Error(`Question ${id} requires options for answer_type ${answerType}`)
  }
  const answer = normalizeQuestionAnswer(getValueByAliases(value, ['answer']), answerType, warnings, id)

  return {
    id,
    phase,
    prompt,
    source,
    follow_up_round: followUpRound === null ? null : followUpRound,
    answer_type: answerType,
    options,
    answer,
  }
}

function normalizeFollowUpRound(value: unknown, index: number): InterviewDocumentFollowUpRound {
  if (!isRecord(value)) {
    throw new Error(`follow_up_rounds[${index}] is not an object`)
  }

  const roundNumber = toInteger(getValueByAliases(value, ['roundnumber', 'round_number']))
  if (roundNumber === null || roundNumber < 1) {
    throw new Error(`follow_up_rounds[${index}] is missing round_number`)
  }

  const sourceRaw = toOptionalString(getValueByAliases(value, ['source'])) ?? 'prom4'
  const sourceNormalized = normalizeKey(sourceRaw)
  let source: InterviewBatchSource
  if (sourceNormalized === 'coverage') {
    source = 'coverage'
  } else if (sourceNormalized === 'prom4') {
    source = 'prom4'
  } else {
    throw new Error(`follow_up_rounds[${index}] has unsupported source "${sourceRaw}"`)
  }

  return {
    round_number: roundNumber,
    source,
    question_ids: Array.from(new Set(toStringArray(getValueByAliases(value, ['questionids', 'question_ids'])))),
  }
}

function syncFinalFreeFormSummary(document: InterviewDocument): InterviewDocument {
  const finalFreeFormQuestion = document.questions.find((question) => question.source === 'final_free_form')
  if (!finalFreeFormQuestion) return document

  return {
    ...document,
    summary: {
      ...document.summary,
      final_free_form_answer: finalFreeFormQuestion.answer.skipped
        ? ''
        : finalFreeFormQuestion.answer.free_text,
    },
  }
}

export function buildInterviewDocumentYaml(document: InterviewDocument): string {
  return buildYamlDocument(document)
}

export function normalizeInterviewDocumentOutput(
  rawContent: string,
  options?: {
    ticketId?: string
    allowTrailingTerminalNoise?: boolean
  },
): StructuredOutputResult<InterviewDocument> {
  const candidates = collectStructuredCandidates(rawContent, {
    topLevelHints: ['schema_version', 'ticket_id', 'artifact', 'questions'],
  })
  let lastError = 'No interview document content found'

  for (const candidate of candidates) {
    try {
      const warnings: string[] = []
      const parsed = unwrapExplicitWrapperRecord(parseYamlOrJsonCandidate(candidate, {
        nestedMappingChildren: INTERVIEW_DOCUMENT_NESTED_MAPPING_CHILDREN,
        allowTrailingTerminalNoise: options?.allowTrailingTerminalNoise,
        repairWarnings: warnings,
      }), [
        'interview',
        'output',
        'result',
        'data',
      ])
      if (!isRecord(parsed)) {
        throw new Error('Interview document is not a YAML/JSON object')
      }

      const rawQuestions = getValueByAliases(parsed, ['questions'])
      if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
        throw new Error('Interview document is missing questions')
      }

      const schemaVersion = toInteger(getValueByAliases(parsed, ['schemaversion', 'schema_version'])) ?? 1
      const ticketId = toOptionalString(getValueByAliases(parsed, ['ticketid', 'ticket_id'])) ?? options?.ticketId ?? ''
      if (!ticketId) {
        throw new Error('Interview document is missing ticket_id')
      }
      if (!toOptionalString(getValueByAliases(parsed, ['ticketid', 'ticket_id'])) && options?.ticketId) {
        warnings.push('Filled missing ticket_id from runtime context.')
      }

      const artifactRaw = toOptionalString(getValueByAliases(parsed, ['artifact'])) ?? 'interview'
      if (artifactRaw !== 'interview') {
        warnings.push(`Normalized artifact "${artifactRaw}" to "interview".`)
      }

      const statusRaw = toOptionalString(getValueByAliases(parsed, ['status'])) ?? 'draft'
      const status = normalizeKey(statusRaw) === 'approved' ? 'approved' : 'draft'
      if (statusRaw !== status) {
        warnings.push(`Normalized status "${statusRaw}" to "${status}".`)
      }

      const generatedBy = normalizeGeneratedBy(getNestedRecord(parsed, ['generatedby', 'generated_by']))
      const seenQuestionIds = new Set<string>()
      const questions = rawQuestions.map((question, index) => normalizeQuestion(question, index, warnings))

      // Find max numeric ID for duplicate renumbering.
      let maxNumericId = 0
      for (const question of questions) {
        const match = question.id.match(/q?(\d+)/i)
        if (match?.[1]) maxNumericId = Math.max(maxNumericId, Number(match[1]))
      }
      let nextAvailableId = maxNumericId + 1

      for (const question of questions) {
        if (seenQuestionIds.has(question.id)) {
          const newId = `Q${String(nextAvailableId).padStart(2, '0')}`
          warnings.push(`Renumbered duplicate question id "${question.id}" to "${newId}".`)
          question.id = newId
          nextAvailableId += 1
        }
        seenQuestionIds.add(question.id)
      }

      const rawFollowUpRounds = getValueByAliases(parsed, ['followuprounds', 'follow_up_rounds'])
      const followUpRounds = Array.isArray(rawFollowUpRounds)
        ? rawFollowUpRounds.map((round, index) => normalizeFollowUpRound(round, index))
        : []

      const summary = getNestedRecord(parsed, ['summary'])
      const approval = getNestedRecord(parsed, ['approval'])
      const document = syncFinalFreeFormSummary({
        schema_version: schemaVersion,
        ticket_id: ticketId,
        artifact: 'interview',
        status,
        generated_by: generatedBy,
        questions,
        follow_up_rounds: followUpRounds,
        summary: {
          goals: toStringArray(getValueByAliases(summary, ['goals'])),
          constraints: toStringArray(getValueByAliases(summary, ['constraints'])),
          non_goals: toStringArray(getValueByAliases(summary, ['nongoals', 'non_goals'])),
          final_free_form_answer: typeof getValueByAliases(summary, ['finalfreeformanswer', 'final_free_form_answer']) === 'string'
            ? String(getValueByAliases(summary, ['finalfreeformanswer', 'final_free_form_answer']))
            : '',
        },
        approval: {
          approved_by: toOptionalString(getValueByAliases(approval, ['approvedby', 'approved_by'])) ?? '',
          approved_at: toOptionalString(getValueByAliases(approval, ['approvedat', 'approved_at'])) ?? '',
        },
      })

      return {
        ok: true,
        value: document,
        normalizedContent: buildInterviewDocumentYaml(document),
        repairApplied: candidate !== rawContent.trim() || warnings.length > 0,
        repairWarnings: warnings,
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

export function normalizeResolvedInterviewDocumentOutput(
  rawContent: string,
  options: {
    ticketId: string
    canonicalInterviewContent: string
    memberId?: string
  },
): StructuredOutputResult<InterviewDocument> {
  const canonicalResult = normalizeInterviewDocumentOutput(options.canonicalInterviewContent, {
    ticketId: options.ticketId,
  })
  if (!canonicalResult.ok) {
    return {
      ok: false,
      error: `Canonical interview artifact is invalid: ${canonicalResult.error}`,
      repairApplied: false,
      repairWarnings: [],
    }
  }

  const candidates = collectStructuredCandidates(rawContent, {
    topLevelHints: ['schema_version', 'ticket_id', 'artifact', 'questions'],
  })
  let lastError = 'No resolved interview document content found'

  for (const candidateContent of candidates) {
    const candidateResult = normalizeInterviewDocumentOutput(candidateContent, {
      ticketId: options.ticketId,
      allowTrailingTerminalNoise: true,
    })
    if (!candidateResult.ok) {
      lastError = candidateResult.error
      continue
    }

    try {
      const repairWarnings = [...candidateResult.repairWarnings]
      const canonical = canonicalResult.value
      const candidate = candidateResult.value

      if (candidate.questions.length !== canonical.questions.length) {
        throw new Error(`Resolved interview must preserve all ${canonical.questions.length} canonical questions`)
      }

      const canonicalIds = canonical.questions.map((question) => question.id)
      const candidateIds = candidate.questions.map((question) => question.id)
      const candidateIdSet = new Set(candidateIds)
      const canonicalIdSet = new Set(canonicalIds)
      const missingCanonicalIds = canonicalIds.filter((id) => !candidateIdSet.has(id))
      const unexpectedIds = candidateIds.filter((id) => !canonicalIdSet.has(id))

      if (missingCanonicalIds.length > 0 || unexpectedIds.length > 0) {
        const parts: string[] = []
        if (missingCanonicalIds.length > 0) {
          parts.push(`missing canonical ids: ${missingCanonicalIds.join(', ')}`)
        }
        if (unexpectedIds.length > 0) {
          parts.push(`unexpected ids: ${unexpectedIds.join(', ')}`)
        }
        throw new Error(`Resolved interview must preserve canonical question ids (${parts.join('; ')})`)
      }

      if (candidateIds.some((id, index) => id !== canonicalIds[index])) {
        repairWarnings.push('Canonicalized question order to match the approved Interview Results artifact.')
      }

      const candidateQuestionsById = new Map(candidate.questions.map((question) => [question.id, question]))

      const questions = canonical.questions.map((canonicalQuestion) => {
        const candidateQuestion = candidateQuestionsById.get(canonicalQuestion.id)
        if (!candidateQuestion) {
          throw new Error(`Resolved interview is missing canonical question ${canonicalQuestion.id}`)
        }

        if (!compareQuestionMetadata(candidateQuestion, canonicalQuestion)) {
          repairWarnings.push(`Canonicalized metadata for canonical question ${canonicalQuestion.id}.`)
        }

        if (!canonicalQuestion.answer.skipped) {
          if (!compareQuestionAnswers(candidateQuestion.answer, canonicalQuestion.answer)) {
            repairWarnings.push(`Restored answered canonical question ${canonicalQuestion.id} from the approved Interview Results artifact.`)
          }
          return canonicalQuestion
        }

        if (candidateQuestion.answer.skipped || !answerHasContent(candidateQuestion.answer)) {
          throw new Error(`Resolved interview left skipped question unanswered: ${canonicalQuestion.id}`)
        }

        if (!candidateQuestion.answer.answered_at.trim()) {
          throw new Error(`Resolved interview is missing answered_at for AI-filled question ${canonicalQuestion.id}`)
        }

        if (candidateQuestion.answer.answered_by !== 'ai_skip') {
          repairWarnings.push(`Canonicalized answered_by to ai_skip for AI-filled question ${canonicalQuestion.id}.`)
        }

        if (canonicalQuestion.answer_type === 'free_text') {
          return {
            ...canonicalQuestion,
            answer: {
              skipped: false,
              selected_option_ids: [],
              free_text: candidateQuestion.answer.free_text,
              answered_by: 'ai_skip' as const,
              answered_at: candidateQuestion.answer.answered_at,
            },
          }
        }

        const normalizedChoiceAnswer = normalizeChoiceQuestionAnswer(canonicalQuestion, candidateQuestion)
        if (candidateQuestion.answer.selected_option_ids.length === 0) {
          repairWarnings.push(`Mapped free_text to canonical option ids for AI-filled question ${canonicalQuestion.id}.`)
        }

        return {
          ...canonicalQuestion,
          answer: {
            skipped: false,
            selected_option_ids: normalizedChoiceAnswer.selectedOptionIds,
            free_text: normalizedChoiceAnswer.freeText,
            answered_by: 'ai_skip' as const,
            answered_at: candidateQuestion.answer.answered_at,
          },
        }
      })

      if (candidate.follow_up_rounds.length !== canonical.follow_up_rounds.length) {
        repairWarnings.push('Canonicalized follow_up_rounds to match the approved Interview Results artifact.')
      } else {
        const followUpChanged = candidate.follow_up_rounds.some((round, index) => (
          round.round_number !== canonical.follow_up_rounds[index]?.round_number
          || round.source !== canonical.follow_up_rounds[index]?.source
          || !compareStringArrays(round.question_ids, canonical.follow_up_rounds[index]?.question_ids ?? [])
        ))
        if (followUpChanged) {
          repairWarnings.push('Canonicalized follow_up_rounds to match the approved Interview Results artifact.')
        }
      }

      const approvalChanged = candidate.approval.approved_by || candidate.approval.approved_at
      if (!compareSummary(candidate.summary, canonical.summary)) {
        repairWarnings.push('Canonicalized summary to match the approved Interview Results artifact.')
      }
      if (candidate.ticket_id !== canonical.ticket_id) {
        repairWarnings.push(`Canonicalized ticket_id from "${candidate.ticket_id}" to "${canonical.ticket_id}".`)
      }
      if (candidate.status !== 'draft') {
        repairWarnings.push(`Canonicalized resolved interview status from "${candidate.status}" to "draft".`)
      }
      if (approvalChanged) {
        repairWarnings.push('Cleared approval fields for the AI-generated Full Answers artifact.')
      }
      if (options.memberId && candidate.generated_by.winner_model !== options.memberId) {
        repairWarnings.push(`Canonicalized generated_by.winner_model from "${candidate.generated_by.winner_model}" to "${options.memberId}".`)
      }

      const document = syncFinalFreeFormSummary({
        ...canonical,
        ticket_id: canonical.ticket_id,
        status: 'draft',
        generated_by: {
          ...candidate.generated_by,
          ...(options.memberId ? { winner_model: options.memberId } : {}),
          canonicalization: 'server_normalized',
        },
        questions,
        follow_up_rounds: canonical.follow_up_rounds,
        summary: canonical.summary,
        approval: {
          approved_by: '',
          approved_at: '',
        },
      })

      return {
        ok: true,
        value: document,
        normalizedContent: buildInterviewDocumentYaml(document),
        repairApplied: candidateResult.repairApplied || repairWarnings.length > 0,
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

export function toDraftInterviewDocument(document: InterviewDocument): InterviewDocument {
  return {
    ...document,
    status: 'draft',
    approval: {
      approved_by: '',
      approved_at: '',
    },
  }
}

export function updateInterviewDocumentAnswers(
  document: InterviewDocument,
  updates: InterviewAnswerUpdate[],
  answeredAt: string,
): InterviewDocument {
  const updatesById = new Map(updates.map((update) => [update.id, update]))

  const next = syncFinalFreeFormSummary({
    ...toDraftInterviewDocument(document),
    questions: document.questions.map((question) => {
      const update = updatesById.get(question.id)
      if (!update) return question

      let selectedOptionIds = Array.from(new Set(update.answer.selected_option_ids))
      if (question.answer_type === 'free_text') {
        selectedOptionIds = []
      } else if (question.answer_type === 'single_choice' && selectedOptionIds.length > 1) {
        selectedOptionIds = selectedOptionIds.slice(0, 1)
      }

      const freeText = update.answer.free_text
      const skipped = update.answer.skipped || (freeText.trim().length === 0 && selectedOptionIds.length === 0)

      return {
        ...question,
        answer: {
          skipped,
          selected_option_ids: skipped ? [] : selectedOptionIds,
          free_text: skipped ? '' : freeText,
          answered_by: skipped ? 'ai_skip' : 'user',
          answered_at: skipped ? '' : answeredAt,
        },
      }
    }),
  })

  return syncFinalFreeFormSummary(next)
}

export function buildApprovedInterviewDocument(
  document: InterviewDocument,
  approvedAt: string,
): InterviewDocument {
  return {
    ...document,
    status: 'approved',
    approval: {
      approved_by: 'user',
      approved_at: approvedAt,
    },
  }
}
