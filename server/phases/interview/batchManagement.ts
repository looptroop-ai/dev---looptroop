import type { ParsedInterviewQuestion } from './questions'
import type { BatchQuestion, BatchResponse } from './qa'
import type {
  InterviewBatchHistoryEntry,
  InterviewBatchSource,
  InterviewFollowUpRound,
  InterviewQuestionSource,
  InterviewSessionAnswer,
  InterviewSessionQuestion,
  InterviewSessionSnapshot,
  PersistedInterviewBatch,
} from '@shared/interviewSession'

function nowIso(): string {
  return new Date().toISOString()
}

function normalizeQuestion(input: BatchQuestion | ParsedInterviewQuestion, source: InterviewQuestionSource, roundNumber?: number): InterviewSessionQuestion {
  const priority = 'priority' in input && typeof input.priority === 'string' && input.priority.trim()
    ? input.priority.trim()
    : undefined
  const rationale = 'rationale' in input && typeof input.rationale === 'string' && input.rationale.trim()
    ? input.rationale.trim()
    : undefined
  const answerType = 'answerType' in input && (input.answerType === 'single_choice' || input.answerType === 'multiple_choice')
    ? input.answerType
    : undefined
  const options = 'options' in input && Array.isArray(input.options) && input.options.length > 0
    ? input.options
    : undefined

  return {
    id: input.id.trim(),
    question: input.question.trim(),
    phase: input.phase?.trim() || 'Structure',
    ...(priority ? { priority } : {}),
    ...(rationale ? { rationale } : {}),
    source,
    ...(roundNumber !== undefined ? { roundNumber } : {}),
    ...(answerType ? { answerType } : {}),
    ...(options ? { options } : {}),
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
    progress: {
      current: batch.batchNumber,
      total: Math.max(batch.progress.total, batch.batchNumber),
    },
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
  selectedOptions: Record<string, string[]> = {},
): InterviewSessionSnapshot {
  const next = cloneSnapshot(snapshot)
  const currentBatch = next.currentBatch
  if (!currentBatch) return next

  const submittedAt = nowIso()
  for (const question of currentBatch.questions) {
    const rawAnswer = batchAnswers[question.id] ?? ''
    const selectedIds = selectedOptions[question.id] ?? []
    const isChoiceQuestion = question.answerType === 'single_choice' || question.answerType === 'multiple_choice'
    const hasSelection = selectedIds.length > 0
    const hasText = rawAnswer.trim().length > 0
    const skipped = isChoiceQuestion ? (!hasSelection && !hasText) : !hasText
    next.answers[question.id] = {
      answer: rawAnswer,
      skipped,
      answeredAt: skipped ? null : submittedAt,
      batchNumber: currentBatch.batchNumber,
      ...(selectedIds.length > 0 ? { selectedOptionIds: selectedIds } : {}),
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

export function clearInterviewSessionBatch(snapshot: InterviewSessionSnapshot): InterviewSessionSnapshot {
  const next = cloneSnapshot(snapshot)
  next.currentBatch = null
  next.updatedAt = nowIso()
  return next
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
