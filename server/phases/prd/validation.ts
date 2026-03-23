import type { PrdDocument, PrdDraftMetrics } from '../../structuredOutput'
import { getPrdDraftMetrics, normalizePrdYamlOutput } from '../../structuredOutput'

export interface ValidatedPrdDraft {
  document: PrdDocument
  metrics: PrdDraftMetrics
  normalizedContent: string
  repairApplied: boolean
  repairWarnings: string[]
}

export function validatePrdDraft(
  content: string,
  options: {
    ticketId: string
    interviewContent?: string
  },
): ValidatedPrdDraft {
  const result = normalizePrdYamlOutput(content, options)
  if (!result.ok) {
    throw new Error(result.error)
  }

  return {
    document: result.value,
    metrics: getPrdDraftMetrics(result.value),
    normalizedContent: result.normalizedContent,
    repairApplied: result.repairApplied,
    repairWarnings: result.repairWarnings,
  }
}
