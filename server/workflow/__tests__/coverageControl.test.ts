import { describe, expect, it } from 'vitest'
import { resolveCoverageGapDisposition, resolveCoverageRunState } from '../coverageControl'

describe.concurrent('coverage control', () => {
  it('treats maxCoveragePasses as a total execution cap', () => {
    expect(resolveCoverageRunState(0, 5)).toEqual({
      coverageRunNumber: 1,
      isFinalAllowedRun: false,
      limitAlreadyReached: false,
    })
    expect(resolveCoverageRunState(4, 5)).toEqual({
      coverageRunNumber: 5,
      isFinalAllowedRun: true,
      limitAlreadyReached: false,
    })
    expect(resolveCoverageRunState(5, 5)).toEqual({
      coverageRunNumber: 6,
      isFinalAllowedRun: true,
      limitAlreadyReached: true,
    })
  })

  it('loops back on early PRD and beads gaps but stops on the final pass', () => {
    expect(resolveCoverageGapDisposition({
      phase: 'prd',
      hasGaps: true,
      isFinalAllowedRun: false,
      hasFollowUpQuestions: false,
    })).toMatchObject({
      shouldLoopBack: true,
      limitReached: false,
      terminationReason: 'gaps',
    })

    expect(resolveCoverageGapDisposition({
      phase: 'beads',
      hasGaps: true,
      isFinalAllowedRun: true,
      hasFollowUpQuestions: false,
    })).toMatchObject({
      shouldLoopBack: false,
      limitReached: true,
      terminationReason: 'coverage_pass_limit_reached',
    })
  })

  it('routes interview gaps to approval when the follow-up budget is exhausted', () => {
    expect(resolveCoverageGapDisposition({
      phase: 'interview',
      hasGaps: true,
      isFinalAllowedRun: false,
      hasFollowUpQuestions: false,
      remainingInterviewBudget: 0,
    })).toMatchObject({
      shouldLoopBack: false,
      limitReached: true,
      terminationReason: 'follow_up_budget_exhausted',
    })
  })

  it('routes interview gaps to approval when the final pass is reached even if follow-up questions exist', () => {
    expect(resolveCoverageGapDisposition({
      phase: 'interview',
      hasGaps: true,
      isFinalAllowedRun: true,
      hasFollowUpQuestions: true,
      remainingInterviewBudget: 3,
    })).toMatchObject({
      shouldLoopBack: false,
      limitReached: true,
      terminationReason: 'coverage_pass_limit_reached',
    })
  })

  it('uses manual review when interview gaps remain but follow-up questions cannot be recovered', () => {
    expect(resolveCoverageGapDisposition({
      phase: 'interview',
      hasGaps: true,
      isFinalAllowedRun: false,
      hasFollowUpQuestions: false,
      remainingInterviewBudget: 2,
    })).toMatchObject({
      shouldLoopBack: false,
      limitReached: false,
      terminationReason: 'follow_up_generation_failed',
    })
  })
})
