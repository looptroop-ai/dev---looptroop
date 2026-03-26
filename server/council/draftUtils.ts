import type { MemberOutcome } from './types'
import type { StructuredFailureClass } from '../lib/structuredOutputRetry'
import { classifyStructuredFailureFromError } from '../lib/structuredOutputRetry'

export const PHASE_DEADLINE_ERROR = 'CouncilPhaseDeadlineReached'

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export function isPhaseDeadlineError(error: unknown): boolean {
  return error instanceof Error && error.message === PHASE_DEADLINE_ERROR
}

export function classifyDraftFailure(
  error: unknown,
  options?: {
    content?: string
    failureClass?: StructuredFailureClass
  },
): {
  outcome: MemberOutcome & ('invalid_output' | 'failed')
  errorDetail: string
  failureClass: StructuredFailureClass
} {
  const failureClass = options?.failureClass
    ?? (options?.content?.trim()
      ? 'validation_error'
      : classifyStructuredFailureFromError(error))

  return {
    outcome: failureClass === 'validation_error' ? 'invalid_output' as const : 'failed' as const,
    errorDetail: error instanceof Error ? error.message : String(error),
    failureClass,
  }
}
