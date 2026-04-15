import { EXECUTION_SETUP_RESULT_END, EXECUTION_SETUP_RESULT_MARKER } from './types'
import { normalizeExecutionSetupResultOutput } from '../../structuredOutput'
import type { ExecutionSetupParseResult } from './types'

export function parseExecutionSetupResult(output: string): ExecutionSetupParseResult {
  const normalized = normalizeExecutionSetupResultOutput(output)
  if (!normalized.ok) {
    const markerFound = output.includes(EXECUTION_SETUP_RESULT_MARKER) && output.includes(EXECUTION_SETUP_RESULT_END)
    return {
      markerFound,
      result: null,
      errors: [normalized.error],
      repairApplied: normalized.repairApplied,
      repairWarnings: normalized.repairWarnings,
      validationError: normalized.error,
      retryDiagnostic: normalized.retryDiagnostic,
    }
  }

  return {
    markerFound: true,
    result: normalized.value,
    errors: [],
    repairApplied: normalized.repairApplied,
    repairWarnings: normalized.repairWarnings,
  }
}
