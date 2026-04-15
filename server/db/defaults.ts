import { COUNCIL_RESPONSE_TIMEOUT_MS } from '../lib/constants'

export const PROFILE_DEFAULTS = {
  minCouncilQuorum: 2,
  perIterationTimeout: 1200000,
  executionSetupTimeout: 1200000,
  councilResponseTimeout: COUNCIL_RESPONSE_TIMEOUT_MS,
  interviewQuestions: 50,
  coverageFollowUpBudgetPercent: 20,
  maxCoveragePasses: 2,
  maxIterations: 5,
} as const
