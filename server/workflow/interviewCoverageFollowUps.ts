import type { InterviewSessionQuestion, InterviewSessionSnapshot } from '@shared/interviewSession'
import { countCoverageFollowUpQuestions, extractCoverageFollowUpQuestions } from '../phases/interview/sessionState'
import type { CoverageFollowUpQuestion, CoverageResultEnvelope } from '../structuredOutput'

export const INTERVIEW_COVERAGE_FOLLOW_UP_VALIDATION_ERROR = 'Coverage returned `status: gaps` but no machine-parseable follow-up question objects in `follow_up_questions`. Return `follow_up_questions` as YAML objects with `id`, `question`, `phase`, `priority`, and `rationale`.'
export const INTERVIEW_COVERAGE_FOLLOW_UP_BUDGET_ERROR = 'Coverage returned more follow-up questions than the remaining interview coverage budget allows.'

export interface InterviewCoverageFollowUpResolution {
  followUpQuestions: InterviewSessionQuestion[]
  shouldRetry: boolean
  validationError: string | null
  repairWarnings: string[]
  budget: {
    total: number
    used: number
    remaining: number
  }
}

function normalizeCoverageQuestionsToYaml(questions: CoverageFollowUpQuestion[]): string {
  return questions.length > 0
    ? JSON.stringify({ follow_up_questions: questions })
    : ''
}

export function resolveInterviewCoverageFollowUpResolution(input: {
  status: CoverageResultEnvelope['status']
  structuredFollowUps: CoverageFollowUpQuestion[]
  rawResponse: string
  snapshot: InterviewSessionSnapshot
  attempt: number
  maxRetries?: number
  maxFollowUps?: number
}): InterviewCoverageFollowUpResolution {
  const maxFollowUps = input.maxFollowUps ?? input.snapshot.maxFollowUps
  const usedFollowUps = countCoverageFollowUpQuestions(input.snapshot)
  const remainingBudget = Math.max(0, maxFollowUps - usedFollowUps)
  const budget = {
    total: maxFollowUps,
    used: usedFollowUps,
    remaining: remainingBudget,
  }

  if (input.status !== 'gaps') {
    return {
      followUpQuestions: [],
      shouldRetry: false,
      validationError: null,
      repairWarnings: [],
      budget,
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

  if (remainingBudget === 0) {
    return {
      followUpQuestions: [],
      shouldRetry: false,
      validationError: null,
      repairWarnings: [],
      budget,
    }
  }

  if (followUpQuestions.length > remainingBudget) {
    return {
      followUpQuestions: followUpQuestions.slice(0, remainingBudget),
      shouldRetry: false,
      validationError: `${INTERVIEW_COVERAGE_FOLLOW_UP_BUDGET_ERROR} Remaining budget=${remainingBudget}, requested=${followUpQuestions.length}, already_used=${usedFollowUps}, max_follow_ups=${maxFollowUps}.`,
      repairWarnings: [
        `Coverage follow-up questions exceeded the remaining budget and were truncated to ${remainingBudget}.`,
      ],
      budget,
    }
  }

  if (followUpQuestions.length > 0) {
    return {
      followUpQuestions,
      shouldRetry: false,
      validationError: null,
      repairWarnings: [],
      budget,
    }
  }

  const maxRetries = input.maxRetries ?? 1
  return {
    followUpQuestions: [],
    shouldRetry: input.attempt < maxRetries,
    validationError: INTERVIEW_COVERAGE_FOLLOW_UP_VALIDATION_ERROR,
    repairWarnings: [],
    budget,
  }
}
