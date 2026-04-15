import { PROFILE_DEFAULTS } from '@server/db/defaults'

export const numericFields = {
  perIterationTimeout: { min: 0, max: 3600, label: 'Per-Iteration Timeout', fromStore: (v: number) => String(Math.round(v / 1000)), toStore: (v: number) => v * 1000 },
  executionSetupTimeout: { min: 0, max: 3600, label: 'Execution Setup Timeout', fromStore: (v: number) => String(Math.round(v / 1000)), toStore: (v: number) => v * 1000 },
  councilResponseTimeout: { min: 10, max: 3600, label: 'AI Response Timeout', fromStore: (v: number) => String(Math.round(v / 1000)), toStore: (v: number) => v * 1000 },
  maxIterations: { min: 0, max: 20, label: 'Max Bead Retries', fromStore: (v: number) => String(v), toStore: (v: number) => v },
  minCouncilQuorum: { min: 1, max: 4, label: 'Min Council Quorum', fromStore: (v: number) => String(v), toStore: (v: number) => v },
  interviewQuestions: { min: 0, max: 50, label: 'Max Interview Questions', fromStore: (v: number) => String(v), toStore: (v: number) => v },
  coverageFollowUpBudgetPercent: { min: 0, max: 100, label: 'Coverage Follow-Up Budget', fromStore: (v: number) => String(v), toStore: (v: number) => v },
  maxCoveragePasses: { min: 1, max: 10, label: 'Interview Coverage Passes', fromStore: (v: number) => String(v), toStore: (v: number) => v },
} as const

export type NumericFieldKey = keyof typeof numericFields

export function getFieldError(key: NumericFieldKey, rawNumeric: Record<string, string>): string | null {
  const raw = rawNumeric[key]
  const cfg = numericFields[key]
  if (raw === '' || raw === undefined) return `Required (${cfg.min}–${cfg.max})`
  const n = Number(raw)
  if (isNaN(n) || !Number.isInteger(n)) return `Must be a whole number (${cfg.min}–${cfg.max})`
  if (n < cfg.min) return `Minimum is ${cfg.min}`
  if (n > cfg.max) return `Maximum is ${cfg.max}`
  return null
}

export function hasNumericErrors(rawNumeric: Record<string, string>): boolean {
  return (Object.keys(numericFields) as NumericFieldKey[]).some(k => getFieldError(k, rawNumeric) !== null)
}

export function buildInitialRawNumeric(data: Record<string, unknown>): Record<string, string> {
  return {
    perIterationTimeout: numericFields.perIterationTimeout.fromStore((data.perIterationTimeout ?? PROFILE_DEFAULTS.perIterationTimeout) as number),
    executionSetupTimeout: numericFields.executionSetupTimeout.fromStore((data.executionSetupTimeout ?? PROFILE_DEFAULTS.executionSetupTimeout) as number),
    councilResponseTimeout: numericFields.councilResponseTimeout.fromStore((data.councilResponseTimeout ?? PROFILE_DEFAULTS.councilResponseTimeout) as number),
    maxIterations: String(data.maxIterations ?? PROFILE_DEFAULTS.maxIterations),
    minCouncilQuorum: String(data.minCouncilQuorum ?? PROFILE_DEFAULTS.minCouncilQuorum),
    interviewQuestions: String(data.interviewQuestions ?? PROFILE_DEFAULTS.interviewQuestions),
    coverageFollowUpBudgetPercent: String(data.coverageFollowUpBudgetPercent ?? PROFILE_DEFAULTS.coverageFollowUpBudgetPercent),
    maxCoveragePasses: String(data.maxCoveragePasses ?? PROFILE_DEFAULTS.maxCoveragePasses),
  }
}
