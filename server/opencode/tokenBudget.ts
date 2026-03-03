// Token estimation and budget management

export const TOKEN_BUDGETS: Record<string, number> = {
  interview_draft: 80000,
  interview_vote: 100000,
  interview_refine: 100000,
  interview_qa: 60000,
  interview_coverage: 80000,
  prd_draft: 100000,
  prd_vote: 100000,
  prd_refine: 100000,
  prd_coverage: 80000,
  beads_draft: 100000,
  beads_vote: 100000,
  beads_refine: 100000,
  beads_coverage: 80000,
  coding: 60000,
  final_test: 80000,
  preflight: 40000,
}

export function estimateTokenCount(text: string): number {
  // Approximate: 1 token ≈ 4 characters for English text
  return Math.ceil(text.length / 4)
}

export function getTokenBudget(phase: string): number {
  return TOKEN_BUDGETS[phase] ?? 100000
}
