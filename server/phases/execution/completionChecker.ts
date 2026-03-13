import type { BeadChecks } from './completionSchema'
import { REQUIRED_GATES } from './completionSchema'
import { normalizeBeadCompletionMarkerOutput } from '../../structuredOutput'

export interface CompletionResult {
  complete: boolean
  markerFound: boolean
  gatesValid: boolean
  beadId?: string
  checks?: BeadChecks
  errors: string[]
  repairApplied?: boolean
  repairWarnings?: string[]
  validationError?: string
}

export function parseCompletionMarker(output: string): CompletionResult {
  const errors: string[] = []
  const normalized = normalizeBeadCompletionMarkerOutput(output)
  if (!normalized.ok) {
    return {
      complete: false,
      markerFound: normalized.error !== 'No completion marker found',
      gatesValid: false,
      errors: [normalized.error],
      repairApplied: normalized.repairApplied,
      repairWarnings: normalized.repairWarnings,
      validationError: normalized.error,
    }
  }
  const isComplete = normalized.value.status === 'completed'
  const isFailed = normalized.value.status === 'failed'

  // Validate quality gates
  const checks = normalized.value.checks
  let gatesValid = true

  for (const gate of REQUIRED_GATES) {
    if (typeof checks[gate] !== 'string') {
      errors.push(`Missing quality gate: ${gate}`)
      gatesValid = false
    } else if (checks[gate] !== 'pass') {
      errors.push(`Quality gate failed: ${gate} = ${checks[gate]}`)
      gatesValid = false
    }
  }

  if (isFailed) {
    errors.push(`Bead reported status: ${normalized.value.status}`)
  }

  // Marker says complete but gates fail → treat as incomplete per spec
  if (isComplete && !gatesValid) {
    errors.push('Marker says completed but quality gates failed — treating as incomplete')
  }

  return {
    complete: isComplete && gatesValid,
    markerFound: true,
    gatesValid,
    beadId: normalized.value.beadId,
    checks,
    errors,
    repairApplied: normalized.repairApplied,
    repairWarnings: normalized.repairWarnings,
  }
}
