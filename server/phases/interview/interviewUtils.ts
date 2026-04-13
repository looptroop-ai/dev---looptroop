import type { ParsedInterviewQuestion } from './questions'
import type { BatchQuestion } from './qa'
import type {
  InterviewBatchHistoryEntry,
  InterviewFollowUpRound,
  InterviewQuestionSource,
  InterviewSessionAnswer,
  InterviewSessionQuestion,
  InterviewSessionSnapshot,
} from '@shared/interviewSession'
import { nowIso } from '../../lib/dateUtils'

export { nowIso }

export function normalizeQuestion(input: BatchQuestion | ParsedInterviewQuestion, source: InterviewQuestionSource, roundNumber?: number): InterviewSessionQuestion {
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

export function cloneSnapshot(snapshot: InterviewSessionSnapshot): InterviewSessionSnapshot {
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
