export type ErrorSeverity = 'critical' | 'recoverable' | 'warning'

export interface LoopTroopError {
  code: string
  severity: ErrorSeverity
  message: string
  phase: string
  details?: Record<string, unknown>
  remediation: string
}

export const ERROR_CODES: Record<string, { severity: ErrorSeverity; remediation: string }> = {
  OPENCODE_UNREACHABLE: {
    severity: 'critical',
    remediation: 'Ensure OpenCode server is running: opencode serve',
  },
  OPENCODE_SESSION_LOST: {
    severity: 'recoverable',
    remediation: 'Session will be recreated automatically on retry',
  },
  GIT_DIRTY_WORKTREE: {
    severity: 'critical',
    remediation: 'Clean working directory before starting',
  },
  GIT_PUSH_FAILED: {
    severity: 'recoverable',
    remediation: 'Check git remote configuration and retry',
  },
  GIT_MERGE_CONFLICT: {
    severity: 'critical',
    remediation: 'Resolve merge conflicts manually and retry',
  },
  SQLITE_LOCKED: {
    severity: 'recoverable',
    remediation: 'Will retry automatically with busy_timeout',
  },
  QUORUM_NOT_MET: {
    severity: 'critical',
    remediation: 'Check model availability in OpenCode configuration',
  },
  MAX_ITERATIONS: {
    severity: 'critical',
    remediation: 'Bead exceeded max iterations. Review and adjust bead scope.',
  },
  YAML_PARSE_ERROR: {
    severity: 'recoverable',
    remediation: 'Check artifact file for syntax errors',
  },
  TIMEOUT: {
    severity: 'recoverable',
    remediation: 'Increase timeout in profile settings or retry',
  },
  INVALID_OUTPUT: {
    severity: 'recoverable',
    remediation: 'AI produced non-conforming output. Will retry with fresh session.',
  },
  COVERAGE_FAILED: {
    severity: 'recoverable',
    remediation: 'Coverage gaps detected. Review and retry phase.',
  },
  PREFLIGHT_FAILED: {
    severity: 'critical',
    remediation: 'Fix pre-flight issues before proceeding',
  },
  CIRCUIT_BREAKER: {
    severity: 'critical',
    remediation: '3 consecutive failures. Manual intervention required.',
  },
}
