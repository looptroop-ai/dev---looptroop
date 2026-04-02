import type { StructuredOutputFailure } from './types'
import type { StructuredFailureClass, StructuredRetryDiagnostic } from '@shared/structuredRetryDiagnostics'
import { buildStructuredRetryDiagnostic } from '../lib/structuredRetryDiagnostics'

export function buildStructuredOutputFailure(
  rawContent: string,
  error: string,
  options?: {
    repairApplied?: boolean
    repairWarnings?: string[]
    failureClass?: StructuredFailureClass
    cause?: unknown
    retryDiagnostic?: StructuredRetryDiagnostic
  },
): StructuredOutputFailure {
  return {
    ok: false,
    error,
    repairApplied: Boolean(options?.repairApplied),
    repairWarnings: options?.repairWarnings ?? [],
    retryDiagnostic: options?.retryDiagnostic ?? buildStructuredRetryDiagnostic({
      attempt: 1,
      rawResponse: rawContent,
      validationError: error,
      failureClass: options?.failureClass,
      error: options?.cause,
    }),
  }
}
