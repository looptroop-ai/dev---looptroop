import { PROFILE_DEFAULTS } from '../../db/defaults'

export function calculateFollowUpLimit(
  totalQuestions: number,
  budgetPercent: number = PROFILE_DEFAULTS.coverageFollowUpBudgetPercent,
): number {
  return Math.max(1, Math.floor(totalQuestions * (budgetPercent / 100)))
}
