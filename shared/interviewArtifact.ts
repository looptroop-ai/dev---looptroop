import type {
  InterviewBatchSource,
  InterviewQuestionAnswerType,
  InterviewQuestionOption,
  InterviewQuestionSource,
} from './interviewSession'

export interface InterviewDocumentGeneratedBy {
  winner_model: string
  generated_at: string
  canonicalization?: string
}

export interface InterviewDocumentAnswer {
  skipped: boolean
  selected_option_ids: string[]
  free_text: string
  answered_by: 'user' | 'ai_skip'
  answered_at: string
}

export interface InterviewDocumentQuestion {
  id: string
  phase: string
  prompt: string
  source: InterviewQuestionSource
  follow_up_round: number | null
  answer_type: InterviewQuestionAnswerType
  options: InterviewQuestionOption[]
  answer: InterviewDocumentAnswer
}

export interface InterviewDocumentFollowUpRound {
  round_number: number
  source: InterviewBatchSource
  question_ids: string[]
}

export interface InterviewDocumentSummary {
  goals: string[]
  constraints: string[]
  non_goals: string[]
  final_free_form_answer: string
}

export interface InterviewDocumentApproval {
  approved_by: string
  approved_at: string
}

export interface InterviewDocument {
  schema_version: number
  ticket_id: string
  artifact: 'interview'
  status: 'draft' | 'approved'
  generated_by: InterviewDocumentGeneratedBy
  questions: InterviewDocumentQuestion[]
  follow_up_rounds: InterviewDocumentFollowUpRound[]
  summary: InterviewDocumentSummary
  approval: InterviewDocumentApproval
}

export interface InterviewAnswerUpdate {
  id: string
  answer: {
    skipped: boolean
    selected_option_ids: string[]
    free_text: string
  }
}
