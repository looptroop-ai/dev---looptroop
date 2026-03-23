import type { InterviewDocument } from '@shared/interviewArtifact'
import type { PrdDocument, PrdDraftMetrics } from '../../structuredOutput'
import {
  getPrdDraftMetrics,
  normalizePrdYamlOutput,
  normalizeResolvedInterviewDocumentOutput,
} from '../../structuredOutput'

export interface ValidatedResolvedInterview {
  document: InterviewDocument
  questionCount: number
  normalizedContent: string
  repairApplied: boolean
  repairWarnings: string[]
}

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

export function validateResolvedInterview(
  content: string,
  options: {
    ticketId: string
    canonicalInterviewContent: string
    memberId?: string
  },
): ValidatedResolvedInterview {
  const result = normalizeResolvedInterviewDocumentOutput(content, options)
  if (!result.ok) {
    throw new Error(result.error)
  }

  return {
    document: result.value,
    questionCount: result.value.questions.length,
    normalizedContent: result.normalizedContent,
    repairApplied: result.repairApplied,
    repairWarnings: result.repairWarnings,
  }
}
