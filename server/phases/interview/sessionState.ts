// Core session state logic with barrel re-exports from extracted modules.
//
// Batch lifecycle (build, record, submit, clear) → ./batchManagement
// Serialization, YAML canonicalization, coverage extraction, question views → ./sessionSerializer

export {
  buildPersistedBatch,
  recordPreparedBatch,
  recordBatchAnswers,
  clearInterviewSessionBatch,
  buildCoverageFollowUpBatch,
} from './batchManagement'

export {
  createInterviewSessionSnapshot,
  parseInterviewSessionSnapshot,
  serializeInterviewSessionSnapshot,
  buildCanonicalInterviewYaml,
  extractCoverageFollowUpQuestions,
  buildInterviewQuestionViews,
} from './sessionSerializer'

import type {
  InterviewBatchHistoryEntry,
  InterviewFollowUpRound,
  InterviewSessionAnswer,
  InterviewSessionSnapshot,
} from '@shared/interviewSession'
import { recordBatchAnswers } from './batchManagement'

export const INTERVIEW_SESSION_ARTIFACT = 'interview_session'
export const INTERVIEW_PROM4_FINAL_ARTIFACT = 'interview_prom4_final'
export const INTERVIEW_QA_SESSION_ARTIFACT = 'interview_qa_session'
export const INTERVIEW_CURRENT_BATCH_ARTIFACT = 'interview_current_batch'
export const INTERVIEW_BATCH_HISTORY_ARTIFACT = 'interview_batch_history'
export const INTERVIEW_COVERAGE_FOLLOWUPS_ARTIFACT = 'interview_coverage_followups'

function nowIso(): string {
  return new Date().toISOString()
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

export function countCoverageFollowUpQuestions(snapshot: InterviewSessionSnapshot): number {
  return snapshot.followUpRounds
    .filter((round) => round.source === 'coverage')
    .reduce((sum, round) => sum + round.questionIds.length, 0)
}
