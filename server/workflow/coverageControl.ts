export type CoveragePhase = 'interview' | 'prd' | 'beads'

export type CoverageTerminationReason =
  | 'clean'
  | 'gaps'
  | 'coverage_pass_limit_reached'
  | 'follow_up_budget_exhausted'
  | 'follow_up_generation_failed'

export interface CoverageRunState {
  coverageRunNumber: number
  isFinalAllowedRun: boolean
  limitAlreadyReached: boolean
}

export function resolveCoverageRunState(
  completedCoveragePasses: number,
  maxCoveragePasses: number,
): CoverageRunState {
  return {
    coverageRunNumber: completedCoveragePasses + 1,
    isFinalAllowedRun: completedCoveragePasses + 1 >= maxCoveragePasses,
    limitAlreadyReached: completedCoveragePasses >= maxCoveragePasses,
  }
}

export function resolveCoverageGapDisposition(input: {
  phase: CoveragePhase
  hasGaps: boolean
  isFinalAllowedRun: boolean
  hasFollowUpQuestions: boolean
  remainingInterviewBudget?: number
}): {
  shouldLoopBack: boolean
  limitReached: boolean
  terminationReason: CoverageTerminationReason
} {
  if (!input.hasGaps) {
    return {
      shouldLoopBack: false,
      limitReached: false,
      terminationReason: 'clean',
    }
  }

  if (input.phase === 'interview') {
    const remainingInterviewBudget = input.remainingInterviewBudget ?? 0
    if (remainingInterviewBudget === 0) {
      return {
        shouldLoopBack: false,
        limitReached: true,
        terminationReason: 'follow_up_budget_exhausted',
      }
    }
    if (input.isFinalAllowedRun) {
      return {
        shouldLoopBack: false,
        limitReached: true,
        terminationReason: 'coverage_pass_limit_reached',
      }
    }
    if (!input.hasFollowUpQuestions) {
      return {
        shouldLoopBack: false,
        limitReached: false,
        terminationReason: 'follow_up_generation_failed',
      }
    }
    return {
      shouldLoopBack: true,
      limitReached: false,
      terminationReason: 'gaps',
    }
  }

  if (input.isFinalAllowedRun) {
    return {
      shouldLoopBack: false,
      limitReached: true,
      terminationReason: 'coverage_pass_limit_reached',
    }
  }

  return {
    shouldLoopBack: true,
    limitReached: false,
    terminationReason: 'gaps',
  }
}
