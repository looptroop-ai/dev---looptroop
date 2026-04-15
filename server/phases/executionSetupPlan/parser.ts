import { EXECUTION_SETUP_PLAN_RESULT_END, EXECUTION_SETUP_PLAN_RESULT_MARKER } from './types'
import { normalizeExecutionSetupPlanOutput } from '../../structuredOutput'
import type { ExecutionSetupPlanParseResult } from './types'

export function parseExecutionSetupPlanResult(output: string): ExecutionSetupPlanParseResult {
  const normalized = normalizeExecutionSetupPlanOutput(output)
  if (!normalized.ok) {
    const markerFound = output.includes(EXECUTION_SETUP_PLAN_RESULT_MARKER) && output.includes(EXECUTION_SETUP_PLAN_RESULT_END)
    return {
      markerFound,
      plan: null,
      errors: [normalized.error],
      repairApplied: normalized.repairApplied,
      repairWarnings: normalized.repairWarnings,
      validationError: normalized.error,
      retryDiagnostic: normalized.retryDiagnostic,
    }
  }

  return {
    markerFound: true,
    plan: normalized.value,
    errors: [],
    repairApplied: normalized.repairApplied,
    repairWarnings: normalized.repairWarnings,
  }
}
