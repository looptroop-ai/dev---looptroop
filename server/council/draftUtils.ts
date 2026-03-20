import type { MemberOutcome } from './types'

export const PHASE_DEADLINE_ERROR = 'CouncilPhaseDeadlineReached'

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export function isPhaseDeadlineError(error: unknown): boolean {
  return error instanceof Error && error.message === PHASE_DEADLINE_ERROR
}

export function classifyDraftFailure(error: unknown, hasResponse: boolean): {
  outcome: MemberOutcome & ('invalid_output' | 'failed')
  errorDetail: string
} {
  return {
    outcome: hasResponse ? 'invalid_output' as const : 'failed' as const,
    errorDetail: error instanceof Error ? error.message : String(error),
  }
}
