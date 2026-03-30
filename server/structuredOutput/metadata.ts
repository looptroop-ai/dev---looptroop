import {
  deriveStructuredInterventions,
  mergeStructuredInterventions,
  normalizeStructuredInterventions,
} from '@shared/structuredInterventions'
import type { StructuredOutputMetadata } from './types'
import { isRecord } from './yamlUtils'

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []
}

export function normalizeStructuredOutputMetadata(value: unknown): StructuredOutputMetadata | undefined {
  if (!isRecord(value)) return undefined

  const repairApplied = typeof value.repairApplied === 'boolean' ? value.repairApplied : false
  const repairWarnings = normalizeStringArray(value.repairWarnings)
  const autoRetryCount = typeof value.autoRetryCount === 'number' && Number.isInteger(value.autoRetryCount)
    ? value.autoRetryCount
    : 0
  const validationError = typeof value.validationError === 'string' && value.validationError.trim()
    ? value.validationError
    : undefined
  const interventions = normalizeStructuredInterventions(value.interventions)

  return {
    repairApplied,
    repairWarnings,
    autoRetryCount,
    ...(validationError ? { validationError } : {}),
    ...(interventions.length > 0 ? { interventions } : {}),
  }
}

export function buildStructuredOutputMetadata(
  base: Partial<StructuredOutputMetadata> | null | undefined,
  extra?: Partial<StructuredOutputMetadata>,
): StructuredOutputMetadata {
  const merged: StructuredOutputMetadata = {
    repairApplied: Boolean(base?.repairApplied || extra?.repairApplied),
    repairWarnings: [...normalizeStringArray(base?.repairWarnings), ...normalizeStringArray(extra?.repairWarnings)],
    autoRetryCount: Math.max(base?.autoRetryCount ?? 0, extra?.autoRetryCount ?? 0),
    ...(extra?.validationError
      ? { validationError: extra.validationError }
      : base?.validationError
        ? { validationError: base.validationError }
        : {}),
  }

  const interventions = mergeStructuredInterventions(
    normalizeStructuredInterventions(base?.interventions),
    normalizeStructuredInterventions(extra?.interventions),
    deriveStructuredInterventions({
      repairWarnings: merged.repairWarnings,
      autoRetryCount: merged.autoRetryCount,
      validationError: merged.validationError,
    }),
  )

  return interventions.length > 0
    ? { ...merged, interventions }
    : merged
}
