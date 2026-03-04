export type CheckResult = 'pass' | 'fail' | 'warning'

export interface DiagnosticCheck {
  name: string
  category: 'connectivity' | 'git' | 'artifacts' | 'config' | 'graph'
  result: CheckResult
  message: string
  details?: string
}

export interface PreFlightReport {
  passed: boolean
  checks: DiagnosticCheck[]
  criticalFailures: DiagnosticCheck[]
  warnings: DiagnosticCheck[]
}
