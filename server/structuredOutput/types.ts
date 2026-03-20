import type { BeadChecks } from '../phases/execution/completionSchema'

export interface StructuredOutputSuccess<T> {
  ok: true
  value: T
  normalizedContent: string
  repairApplied: boolean
  repairWarnings: string[]
}

export interface StructuredOutputFailure {
  ok: false
  error: string
  repairApplied: boolean
  repairWarnings: string[]
}

export type StructuredOutputResult<T> = StructuredOutputSuccess<T> | StructuredOutputFailure

export interface StructuredOutputMetadata {
  repairApplied: boolean
  repairWarnings: string[]
  autoRetryCount: number
  validationError?: string
}

export interface CoverageFollowUpQuestion {
  id?: string
  question: string
  phase?: string
  priority?: string
  rationale?: string
}

export interface CoverageResultEnvelope {
  status: 'clean' | 'gaps'
  gaps: string[]
  followUpQuestions: CoverageFollowUpQuestion[]
}

export interface InterviewQuestionOption {
  id: string
  label: string
}

export interface InterviewBatchPayloadQuestion {
  id: string
  question: string
  phase?: string
  priority?: string
  rationale?: string
  answerType?: 'free_text' | 'single_choice' | 'multiple_choice'
  options?: InterviewQuestionOption[]
}

export interface InterviewBatchPayload {
  batchNumber: number
  progress: {
    current: number
    total: number
  }
  isFinalFreeForm: boolean
  aiCommentary: string
  questions: InterviewBatchPayloadQuestion[]
}

export type InterviewTurnOutput =
  | {
      kind: 'batch'
      batch: InterviewBatchPayload
    }
  | {
      kind: 'complete'
      finalYaml: string
    }

export interface BeadCompletionPayload {
  beadId: string
  status: 'completed' | 'failed'
  checks: BeadChecks
  reason?: string
}

export interface FinalTestCommandPayload {
  commands: string[]
  summary: string | null
}

export interface VoteScorecard {
  draftScores: Record<string, Record<string, number>>
}

export interface PrdDocument {
  schema_version: number
  ticket_id: string
  artifact: 'prd'
  status: string
  source_interview: {
    content_sha256: string
  }
  product: {
    problem_statement: string
    target_users: string[]
  }
  scope: {
    in_scope: string[]
    out_of_scope: string[]
  }
  technical_requirements: {
    architecture_constraints: string[]
    data_model: string[]
    api_contracts: string[]
    security_constraints: string[]
    performance_constraints: string[]
    reliability_constraints: string[]
    error_handling_rules: string[]
    tooling_assumptions: string[]
  }
  epics: Array<{
    id: string
    title: string
    objective: string
    implementation_steps: string[]
    user_stories: Array<{
      id: string
      title: string
      acceptance_criteria: string[]
      implementation_steps: string[]
      verification: {
        required_commands: string[]
      }
    }>
  }>
  risks: string[]
  approval: {
    approved_by: string
    approved_at: string
  }
}

export interface RelevantFilesOutputEntry {
  path: string
  rationale: string
  relevance: string
  likely_action: string
  content: string
  content_preview: string
}

export interface RelevantFilesOutputPayload {
  file_count: number
  files: RelevantFilesOutputEntry[]
}
