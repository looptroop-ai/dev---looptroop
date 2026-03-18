import type { ParsedInterviewQuestion } from './questions'
import { parseInterviewQuestions } from './questions'
import type { BatchQuestion, BatchResponse } from './qa'
import type {
  InterviewBatchHistoryEntry,
  InterviewBatchSource,
  InterviewFollowUpRound,
  InterviewQuestionSource,
  InterviewQuestionView,
  InterviewSessionAnswer,
  InterviewSessionQuestion,
  InterviewSessionSnapshot,
  PersistedInterviewBatch,
} from '@shared/interviewSession'
// @ts-expect-error no type declarations for js-yaml
import jsYaml from 'js-yaml'
import { repairYamlIndentation } from '@shared/yamlRepair'

export const INTERVIEW_SESSION_ARTIFACT = 'interview_session'
export const INTERVIEW_PROM4_FINAL_ARTIFACT = 'interview_prom4_final'
export const INTERVIEW_QA_SESSION_ARTIFACT = 'interview_qa_session'
export const INTERVIEW_CURRENT_BATCH_ARTIFACT = 'interview_current_batch'
export const INTERVIEW_BATCH_HISTORY_ARTIFACT = 'interview_batch_history'
export const INTERVIEW_COVERAGE_FOLLOWUPS_ARTIFACT = 'interview_coverage_followups'

function calculateFollowUpLimit(totalQuestions: number): number {
  return Math.max(1, Math.floor(totalQuestions * 0.2))
}

function nowIso(): string {
  return new Date().toISOString()
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function normalizeQuestion(input: BatchQuestion | ParsedInterviewQuestion, source: InterviewQuestionSource, roundNumber?: number): InterviewSessionQuestion {
  const priority = 'priority' in input && typeof input.priority === 'string' && input.priority.trim()
    ? input.priority.trim()
    : undefined
  const rationale = 'rationale' in input && typeof input.rationale === 'string' && input.rationale.trim()
    ? input.rationale.trim()
    : undefined

  return {
    id: input.id.trim(),
    question: input.question.trim(),
    phase: input.phase?.trim() || 'Structure',
    ...(priority ? { priority } : {}),
    ...(rationale ? { rationale } : {}),
    source,
    ...(roundNumber !== undefined ? { roundNumber } : {}),
  }
}

function cloneSnapshot(snapshot: InterviewSessionSnapshot): InterviewSessionSnapshot {
  return {
    ...snapshot,
    questions: snapshot.questions.map((question) => ({ ...question })),
    answers: Object.fromEntries(
      Object.entries(snapshot.answers).map(([id, answer]) => [id, { ...answer } satisfies InterviewSessionAnswer]),
    ),
    currentBatch: snapshot.currentBatch
      ? {
          ...snapshot.currentBatch,
          questions: snapshot.currentBatch.questions.map((question) => ({ ...question })),
        }
      : null,
    batchHistory: snapshot.batchHistory.map((entry) => ({ ...entry } satisfies InterviewBatchHistoryEntry)),
    followUpRounds: snapshot.followUpRounds.map((round) => ({ ...round } satisfies InterviewFollowUpRound)),
  }
}

function determinePromptQuestionSource(
  snapshot: InterviewSessionSnapshot,
  questionId: string,
  isFinalFreeForm: boolean,
): { source: InterviewQuestionSource; roundNumber?: number } {
  if (isFinalFreeForm) {
    return { source: 'final_free_form' }
  }

  const existing = snapshot.questions.find((question) => question.id === questionId)
  if (existing) {
    return {
      source: existing.source,
      ...(existing.roundNumber !== undefined ? { roundNumber: existing.roundNumber } : {}),
    }
  }

  const nextRoundNumber = snapshot.followUpRounds
    .filter((round) => round.source === 'prom4')
    .reduce((max, round) => Math.max(max, round.roundNumber), 0) + 1

  return { source: 'prompt_follow_up', roundNumber: nextRoundNumber }
}

function upsertQuestion(
  snapshot: InterviewSessionSnapshot,
  question: InterviewSessionQuestion,
) {
  const existingIndex = snapshot.questions.findIndex((entry) => entry.id === question.id)
  if (existingIndex >= 0) {
    snapshot.questions[existingIndex] = {
      ...snapshot.questions[existingIndex],
      ...question,
    }
    return
  }
  snapshot.questions.push(question)
}

function upsertFollowUpRound(
  snapshot: InterviewSessionSnapshot,
  source: InterviewBatchSource,
  roundNumber: number | undefined,
  questionIds: string[],
) {
  if (roundNumber === undefined || questionIds.length === 0) return
  const existing = snapshot.followUpRounds.find((round) => round.source === source && round.roundNumber === roundNumber)
  if (existing) {
    const nextIds = new Set([...existing.questionIds, ...questionIds])
    existing.questionIds = Array.from(nextIds)
    return
  }
  snapshot.followUpRounds.push({
    roundNumber,
    source,
    questionIds: [...questionIds],
  })
}

function countAnsweredQuestions(snapshot: InterviewSessionSnapshot): number {
  return Object.values(snapshot.answers).filter((answer) => !answer.skipped).length
}

export function createInterviewSessionSnapshot(input: {
  winnerId: string
  compiledQuestions: ParsedInterviewQuestion[]
  maxInitialQuestions: number
  userBackground?: string | null
  disableAnalogies?: boolean
}): InterviewSessionSnapshot {
  const updatedAt = nowIso()

  return {
    schemaVersion: 1,
    winnerId: input.winnerId,
    maxInitialQuestions: input.maxInitialQuestions,
    maxFollowUps: calculateFollowUpLimit(input.maxInitialQuestions),
    userBackground: input.userBackground?.trim() || null,
    disableAnalogies: Boolean(input.disableAnalogies),
    questions: input.compiledQuestions.map((question) => normalizeQuestion(question, 'compiled')),
    answers: {},
    currentBatch: null,
    batchHistory: [],
    followUpRounds: [],
    rawFinalYaml: null,
    completedAt: null,
    updatedAt,
  }
}

export function parseInterviewSessionSnapshot(content: string | null | undefined): InterviewSessionSnapshot | null {
  if (!content?.trim()) return null

  try {
    const parsed = JSON.parse(content) as InterviewSessionSnapshot
    if (parsed.schemaVersion !== 1 || typeof parsed.winnerId !== 'string') return null
    if (!Array.isArray(parsed.questions) || !parsed.answers || typeof parsed.answers !== 'object') return null
    return cloneSnapshot(parsed)
  } catch {
    return null
  }
}

export function serializeInterviewSessionSnapshot(snapshot: InterviewSessionSnapshot): string {
  return JSON.stringify(snapshot)
}

export function buildPersistedBatch(
  batch: BatchResponse,
  source: InterviewBatchSource,
  snapshot: InterviewSessionSnapshot,
  explicitRoundNumber?: number,
): PersistedInterviewBatch {
  const batchQuestions = batch.questions.map((question) => {
    const promptSource = source === 'coverage'
      ? { source: 'coverage_follow_up' as const, roundNumber: explicitRoundNumber }
      : determinePromptQuestionSource(snapshot, question.id, batch.isFinalFreeForm)

    return normalizeQuestion(question, promptSource.source, promptSource.roundNumber)
  })

  return {
    questions: batchQuestions,
    progress: batch.progress,
    isComplete: batch.isComplete,
    isFinalFreeForm: batch.isFinalFreeForm,
    aiCommentary: batch.aiCommentary,
    ...(batch.finalYaml ? { finalYaml: batch.finalYaml } : {}),
    batchNumber: batch.batchNumber,
    source,
    ...(explicitRoundNumber !== undefined ? { roundNumber: explicitRoundNumber } : {}),
  }
}

export function recordPreparedBatch(
  snapshot: InterviewSessionSnapshot,
  batch: PersistedInterviewBatch,
): InterviewSessionSnapshot {
  const next = cloneSnapshot(snapshot)

  const followUpIds: string[] = []
  for (const question of batch.questions) {
    upsertQuestion(next, question)
    if (question.source === 'prompt_follow_up' || question.source === 'coverage_follow_up') {
      followUpIds.push(question.id)
    }
  }

  if (batch.source === 'prom4') {
    const promptRoundNumber = batch.questions
      .filter((question) => question.source === 'prompt_follow_up')
      .reduce((max, question) => Math.max(max, question.roundNumber ?? 0), 0)
    if (promptRoundNumber > 0) {
      upsertFollowUpRound(
        next,
        'prom4',
        promptRoundNumber,
        batch.questions
          .filter((question) => question.source === 'prompt_follow_up' && question.roundNumber === promptRoundNumber)
          .map((question) => question.id),
      )
    }
  }

  if (batch.source === 'coverage') {
    upsertFollowUpRound(next, 'coverage', batch.roundNumber, followUpIds)
  }

  next.currentBatch = {
    ...batch,
    questions: batch.questions.map((question) => ({ ...question })),
  }
  next.updatedAt = nowIso()
  return next
}

export function recordBatchAnswers(
  snapshot: InterviewSessionSnapshot,
  batchAnswers: Record<string, string>,
): InterviewSessionSnapshot {
  const next = cloneSnapshot(snapshot)
  const currentBatch = next.currentBatch
  if (!currentBatch) return next

  const submittedAt = nowIso()
  for (const question of currentBatch.questions) {
    const rawAnswer = batchAnswers[question.id] ?? ''
    next.answers[question.id] = {
      answer: rawAnswer,
      skipped: rawAnswer.trim().length === 0,
      answeredAt: rawAnswer.trim().length === 0 ? null : submittedAt,
      batchNumber: currentBatch.batchNumber,
    }
  }

  next.batchHistory.push({
    batchNumber: currentBatch.batchNumber,
    source: currentBatch.source,
    ...(currentBatch.roundNumber !== undefined ? { roundNumber: currentBatch.roundNumber } : {}),
    questionIds: currentBatch.questions.map((question) => question.id),
    isFinalFreeForm: currentBatch.isFinalFreeForm,
    submittedAt,
  })
  next.currentBatch = null
  next.updatedAt = submittedAt
  return next
}

export function completeInterviewBySkippingRemaining(
  snapshot: InterviewSessionSnapshot,
  batchAnswers: Record<string, string>,
): InterviewSessionSnapshot {
  const currentBatchNumber = snapshot.currentBatch?.batchNumber ?? null
  const answeredSnapshot = snapshot.currentBatch
    ? recordBatchAnswers(snapshot, batchAnswers)
    : cloneSnapshot(snapshot)

  for (const question of answeredSnapshot.questions) {
    if (answeredSnapshot.answers[question.id]) continue
    answeredSnapshot.answers[question.id] = {
      answer: '',
      skipped: true,
      answeredAt: null,
      batchNumber: currentBatchNumber,
    }
  }

  return markInterviewSessionComplete(answeredSnapshot)
}

export function markInterviewSessionComplete(
  snapshot: InterviewSessionSnapshot,
  rawFinalYaml?: string,
): InterviewSessionSnapshot {
  const next = cloneSnapshot(snapshot)
  next.currentBatch = null
  next.completedAt = nowIso()
  next.updatedAt = next.completedAt
  if (rawFinalYaml?.trim()) {
    next.rawFinalYaml = rawFinalYaml.trim()
  }
  return next
}

export function updateInterviewAnswer(
  snapshot: InterviewSessionSnapshot,
  questionId: string,
  newAnswer: string,
): InterviewSessionSnapshot {
  const next = cloneSnapshot(snapshot)
  const existing = next.answers[questionId]
  if (!existing) {
    throw new Error(`No existing answer for question ${questionId}`)
  }

  const trimmed = newAnswer.trim()
  next.answers[questionId] = {
    answer: newAnswer,
    skipped: trimmed.length === 0,
    answeredAt: trimmed.length === 0 ? null : nowIso(),
    batchNumber: existing.batchNumber,
  }
  next.updatedAt = nowIso()
  return next
}

export function clearInterviewSessionBatch(snapshot: InterviewSessionSnapshot): InterviewSessionSnapshot {
  const next = cloneSnapshot(snapshot)
  next.currentBatch = null
  next.updatedAt = nowIso()
  return next
}

export function countCoverageFollowUpQuestions(snapshot: InterviewSessionSnapshot): number {
  return snapshot.followUpRounds
    .filter((round) => round.source === 'coverage')
    .reduce((sum, round) => sum + round.questionIds.length, 0)
}

function emptyAnswer(): {
  skipped: boolean
  selected_option_ids: string[]
  free_text: string
  answered_by: string
  answered_at: string
} {
  return {
    skipped: true,
    selected_option_ids: [],
    free_text: '',
    answered_by: 'ai_skip',
    answered_at: '',
  }
}

function extractRawFinalInterviewSummary(rawFinalYaml: string | null | undefined): {
  goals: string[]
  constraints: string[]
  nonGoals: string[]
  finalFreeFormAnswer: string | null
} | null {
  if (!rawFinalYaml?.trim()) return null

  try {
    const parsed = jsYaml.load(repairYamlIndentation(rawFinalYaml)) as Record<string, unknown> | null
    if (!parsed || typeof parsed !== 'object') return null

    const summary = parsed.summary
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null

    const record = summary as Record<string, unknown>
    const finalFreeFormAnswer = typeof record.final_free_form_answer === 'string' && record.final_free_form_answer.trim()
      ? record.final_free_form_answer.trim()
      : null

    return {
      goals: toStringArray(record.goals),
      constraints: toStringArray(record.constraints),
      nonGoals: toStringArray(record.non_goals),
      finalFreeFormAnswer,
    }
  } catch {
    return null
  }
}

export function buildCanonicalInterviewYaml(
  ticketId: string,
  snapshot: InterviewSessionSnapshot,
): string {
  const generatedAt = snapshot.updatedAt || nowIso()
  const questions = snapshot.questions.map((question) => {
    const answer = snapshot.answers[question.id]
    return {
      id: question.id,
      phase: question.phase,
      prompt: question.question,
      source: question.source,
      follow_up_round: question.roundNumber ?? null,
      answer_type: 'free_text',
      options: [],
      answer: answer
        ? {
            skipped: answer.skipped,
            selected_option_ids: [],
            free_text: answer.answer,
            answered_by: answer.skipped ? 'ai_skip' : 'user',
            answered_at: answer.skipped ? '' : answer.answeredAt ?? '',
          }
        : emptyAnswer(),
    }
  })

  const followUpRounds = snapshot.followUpRounds.map((round) => ({
    round_number: round.roundNumber,
    source: round.source,
    question_ids: [...round.questionIds],
  }))

  const finalFreeFormAnswerFromQuestions = questions.find((question) => question.source === 'final_free_form')?.answer.free_text ?? ''
  const rawFinalSummary = extractRawFinalInterviewSummary(snapshot.rawFinalYaml)

  const interviewData = {
    schema_version: 1,
    ticket_id: ticketId,
    artifact: 'interview',
    status: 'draft',
    generated_by: {
      winner_model: snapshot.winnerId,
      generated_at: generatedAt,
      canonicalization: 'server_normalized',
    },
    questions,
    follow_up_rounds: followUpRounds,
    summary: {
      goals: rawFinalSummary?.goals ?? [],
      constraints: rawFinalSummary?.constraints ?? [],
      non_goals: rawFinalSummary?.nonGoals ?? [],
      final_free_form_answer: rawFinalSummary?.finalFreeFormAnswer ?? finalFreeFormAnswerFromQuestions,
    },
    approval: {
      approved_by: '',
      approved_at: '',
    },
  }

  return jsYaml.dump(interviewData, { lineWidth: 120, noRefs: true }) as string
}

function normalizeCoverageQuestion(question: BatchQuestion, roundNumber: number): InterviewSessionQuestion {
  return normalizeQuestion(question, 'coverage_follow_up', roundNumber)
}

function parseCoverageYamlQuestions(response: string): BatchQuestion[] {
  try {
    const parsed = jsYaml.load(repairYamlIndentation(response)) as Record<string, unknown> | null
    if (!parsed || typeof parsed !== 'object') return []

    const rawFollowUps = Array.isArray(parsed.follow_up_questions)
      ? parsed.follow_up_questions
      : Array.isArray(parsed.followUpQuestions)
        ? parsed.followUpQuestions
        : []

    if (rawFollowUps.length === 0) return []
    return rawFollowUps.map((entry, index) => {
      if (typeof entry === 'string') {
        return {
          id: `FU${index + 1}`,
          question: entry.trim(),
          phase: 'Structure',
          priority: 'high',
          rationale: 'Coverage follow-up required to close interview gaps.',
        }
      }

      const record = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
      return {
        id: typeof record.id === 'string' ? record.id : `FU${index + 1}`,
        question: typeof record.question === 'string'
          ? record.question
          : typeof record.prompt === 'string'
            ? record.prompt
            : String(record.text ?? ''),
        phase: typeof record.phase === 'string' ? record.phase : 'Structure',
        priority: typeof record.priority === 'string' ? record.priority : 'high',
        rationale: typeof record.rationale === 'string' ? record.rationale : 'Coverage follow-up required to close interview gaps.',
      }
    }).filter((question) => question.question.trim().length > 0)
  } catch {
    return []
  }
}

export function extractCoverageFollowUpQuestions(
  response: string,
  snapshot: InterviewSessionSnapshot,
): InterviewSessionQuestion[] {
  const parsedYamlQuestions = parseCoverageYamlQuestions(response)
  if (parsedYamlQuestions.length > 0) {
    const roundNumber = snapshot.followUpRounds
      .filter((round) => round.source === 'coverage')
      .reduce((max, round) => Math.max(max, round.roundNumber), 0) + 1
    return parsedYamlQuestions.map((question) => normalizeCoverageQuestion(question, roundNumber))
  }

  try {
    const parsedQuestions = parseInterviewQuestions(response, { allowTopLevelArray: true })
    const roundNumber = snapshot.followUpRounds
      .filter((round) => round.source === 'coverage')
      .reduce((max, round) => Math.max(max, round.roundNumber), 0) + 1
    return parsedQuestions.map((question) => normalizeQuestion(question, 'coverage_follow_up', roundNumber))
  } catch {
    return []
  }
}

export function buildCoverageFollowUpBatch(
  snapshot: InterviewSessionSnapshot,
  questions: InterviewSessionQuestion[],
  aiCommentary: string,
): PersistedInterviewBatch {
  const answeredCount = countAnsweredQuestions(snapshot)
  const roundNumber = questions.reduce((max, question) => Math.max(max, question.roundNumber ?? 0), 0)

  return {
    questions: questions.map((question) => ({ ...question })),
    progress: {
      current: answeredCount,
      total: answeredCount + questions.length,
    },
    isComplete: false,
    isFinalFreeForm: false,
    aiCommentary,
    batchNumber: snapshot.batchHistory.length + 1,
    source: 'coverage',
    ...(roundNumber > 0 ? { roundNumber } : {}),
  }
}

export function buildInterviewQuestionViews(
  snapshot: InterviewSessionSnapshot,
): InterviewQuestionView[] {
  const currentIds = new Set(snapshot.currentBatch?.questions.map((question) => question.id) ?? [])

  return snapshot.questions.map((question) => {
    const answer = snapshot.answers[question.id]
    let status: InterviewQuestionView['status'] = 'pending'
    if (currentIds.has(question.id)) status = 'current'
    else if (answer?.skipped) status = 'skipped'
    else if (answer && !answer.skipped) status = 'answered'

    return {
      ...question,
      status,
      answer: answer ? answer.answer : null,
    }
  })
}
