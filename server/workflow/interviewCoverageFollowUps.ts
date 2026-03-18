import type { InterviewSessionQuestion, InterviewSessionSnapshot } from '@shared/interviewSession'
import { extractCoverageFollowUpQuestions } from '../phases/interview/sessionState'
import type { CoverageFollowUpQuestion, CoverageResultEnvelope } from '../structuredOutput'

export const INTERVIEW_COVERAGE_FOLLOW_UP_VALIDATION_ERROR = 'Coverage returned `status: gaps` but no machine-parseable follow-up question objects in `follow_up_questions`. Return `follow_up_questions` as YAML objects with `id`, `question`, `phase`, `priority`, and `rationale`.'

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
