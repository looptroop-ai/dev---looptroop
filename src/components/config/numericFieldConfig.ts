import { PROFILE_DEFAULTS } from '@server/db/defaults'

interface NumericFieldConfig {
  min: number
  max: number
  label: string
  docsPath: string
  fromStore: (value: number) => string
  toStore: (value: number) => number
}

export const numericFields = {
  perIterationTimeout: {
    min: 0,
    max: 3600,
    label: 'Per-Iteration Timeout',
    docsPath: '/configuration#per-iteration-timeout',
    fromStore: (v: number) => String(Math.round(v / 1000)),
    toStore: (v: number) => v * 1000,
  },
  executionSetupTimeout: {
    min: 0,
    max: 3600,
    label: 'Execution Setup Timeout',
    docsPath: '/configuration#execution-setup-timeout',
    fromStore: (v: number) => String(Math.round(v / 1000)),
    toStore: (v: number) => v * 1000,
  },
  councilResponseTimeout: {
    min: 10,
    max: 3600,
    label: 'AI Response Timeout',
    docsPath: '/configuration#council-response-timeout',
    fromStore: (v: number) => String(Math.round(v / 1000)),
    toStore: (v: number) => v * 1000,
  },
  maxIterations: {
    min: 0,
    max: 20,
    label: 'Max Bead Retries',
    docsPath: '/configuration#max-bead-retries',
    fromStore: (v: number) => String(v),
    toStore: (v: number) => v,
  },
  minCouncilQuorum: {
    min: 1,
    max: 4,
    label: 'Min Council Quorum',
    docsPath: '/configuration#min-council-quorum',
    fromStore: (v: number) => String(v),
    toStore: (v: number) => v,
  },
  interviewQuestions: {
    min: 0,
    max: 50,
    label: 'Max Interview Questions',
    docsPath: '/configuration#max-interview-questions',
    fromStore: (v: number) => String(v),
    toStore: (v: number) => v,
  },
  coverageFollowUpBudgetPercent: {
    min: 0,
    max: 100,
    label: 'Coverage Follow-Up Budget',
    docsPath: '/configuration#coverage-follow-up-budget',
    fromStore: (v: number) => String(v),
    toStore: (v: number) => v,
  },
  maxCoveragePasses: {
    min: 1,
    max: 10,
    label: 'Interview Coverage Passes',
    docsPath: '/configuration#interview-coverage-passes',
    fromStore: (v: number) => String(v),
    toStore: (v: number) => v,
  },
  maxPrdCoveragePasses: {
    min: 2,
    max: 20,
    label: 'PRD Coverage Passes',
    docsPath: '/configuration#prd-coverage-passes',
    fromStore: (v: number) => String(v),
    toStore: (v: number) => v,
  },
  maxBeadsCoveragePasses: {
    min: 2,
    max: 20,
    label: 'Beads Coverage Passes',
    docsPath: '/configuration#beads-coverage-passes',
    fromStore: (v: number) => String(v),
    toStore: (v: number) => v,
  },
  toolInputMaxChars: {
    min: 500,
    max: 50_000,
    label: 'Tool Input Max Chars',
    docsPath: '/configuration#tool-input-max-chars',
    fromStore: (v: number) => String(v),
    toStore: (v: number) => v,
  },
  toolOutputMaxChars: {
    min: 1000,
    max: 100_000,
    label: 'Tool Output Max Chars',
    docsPath: '/configuration#tool-output-max-chars',
    fromStore: (v: number) => String(v),
    toStore: (v: number) => v,
  },
  toolErrorMaxChars: {
    min: 500,
    max: 50_000,
    label: 'Tool Error Max Chars',
    docsPath: '/configuration#tool-error-max-chars',
    fromStore: (v: number) => String(v),
    toStore: (v: number) => v,
  },
} as const satisfies Record<string, NumericFieldConfig>

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
    maxPrdCoveragePasses: String(data.maxPrdCoveragePasses ?? PROFILE_DEFAULTS.maxPrdCoveragePasses),
    maxBeadsCoveragePasses: String(data.maxBeadsCoveragePasses ?? PROFILE_DEFAULTS.maxBeadsCoveragePasses),
    toolInputMaxChars: String(data.toolInputMaxChars ?? PROFILE_DEFAULTS.toolInputMaxChars),
    toolOutputMaxChars: String(data.toolOutputMaxChars ?? PROFILE_DEFAULTS.toolOutputMaxChars),
    toolErrorMaxChars: String(data.toolErrorMaxChars ?? PROFILE_DEFAULTS.toolErrorMaxChars),
  }
}
