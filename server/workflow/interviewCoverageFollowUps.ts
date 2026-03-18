import type { InterviewSessionQuestion, InterviewSessionSnapshot } from '@shared/interviewSession'
import { countCoverageFollowUpQuestions, extractCoverageFollowUpQuestions } from '../phases/interview/sessionState'
import type { CoverageFollowUpQuestion, CoverageResultEnvelope } from '../structuredOutput'

export const INTERVIEW_COVERAGE_FOLLOW_UP_VALIDATION_ERROR = 'Coverage returned `status: gaps` but no machine-parseable follow-up question objects in `follow_up_questions`. Return `follow_up_questions` as YAML objects with `id`, `question`, `phase`, `priority`, and `rationale`.'
export const INTERVIEW_COVERAGE_FOLLOW_UP_BUDGET_ERROR = 'Coverage returned more follow-up questions than the remaining interview coverage budget allows.'

export interface InterviewCoverageFollowUpResolution {
  followUpQuestions: InterviewSessionQuestion[]
  shouldRetry: boolean
  validationError: string | null
}

function normalizeCoverageQuestionsToYaml(questions: CoverageFollowUpQuestion[]): string {
  return questions.length > 0
    ? JSON.stringify({ follow_up_questions: questions })
    : ''
}

function buildCoverageBudgetValidationError(snapshot: InterviewSessionSnapshot, requestedFollowUps: number): string {
  const usedFollowUps = countCoverageFollowUpQuestions(snapshot)
  const remainingBudget = Math.max(0, snapshot.maxFollowUps - usedFollowUps)
  return `${INTERVIEW_COVERAGE_FOLLOW_UP_BUDGET_ERROR} Remaining budget=${remainingBudget}, requested=${requestedFollowUps}, already_used=${usedFollowUps}, max_follow_ups=${snapshot.maxFollowUps}.`
}

export function resolveInterviewCoverageFollowUpResolution(input: {
  status: CoverageResultEnvelope['status']
  structuredFollowUps: CoverageFollowUpQuestion[]
  rawResponse: string
  snapshot: InterviewSessionSnapshot
  attempt: number
  maxRetries?: number
}): InterviewCoverageFollowUpResolution {
  if (input.status !== 'gaps') {
    return {
      followUpQuestions: [],
      shouldRetry: false,
      validationError: null,
    }
  }

  const structuredFollowUps = input.structuredFollowUps.length > 0
    ? extractCoverageFollowUpQuestions(
        normalizeCoverageQuestionsToYaml(input.structuredFollowUps),
        input.snapshot,
      )
    : []
  const followUpQuestions = structuredFollowUps.length > 0
    ? structuredFollowUps
    : extractCoverageFollowUpQuestions(input.rawResponse, input.snapshot)

  const remainingBudget = Math.max(0, input.snapshot.maxFollowUps - countCoverageFollowUpQuestions(input.snapshot))
  if (followUpQuestions.length > remainingBudget) {
    const maxRetries = input.maxRetries ?? 1
    return {
      followUpQuestions: [],
      shouldRetry: input.attempt < maxRetries,
      validationError: buildCoverageBudgetValidationError(input.snapshot, followUpQuestions.length),
    }
  }

  if (followUpQuestions.length > 0) {
    return {
      followUpQuestions,
      shouldRetry: false,
      validationError: null,
    }
  }

  const maxRetries = input.maxRetries ?? 1
  return {
    followUpQuestions: [],
    shouldRetry: input.attempt < maxRetries,
    validationError: INTERVIEW_COVERAGE_FOLLOW_UP_VALIDATION_ERROR,
  }
}
