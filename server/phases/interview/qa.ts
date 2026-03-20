import type { InterviewQuestion, InterviewAnswer } from './types'
import type { OpenCodeAdapter } from '../../opencode/adapter'
import type { PromptPart, StreamEvent } from '../../opencode/types'
import { buildMinimalContext, type TicketState } from '../../opencode/contextBuilder'
import { buildConversationalPrompt, PROM4, PROM4_FINAL_INTERVIEW_SCHEMA } from '../../prompts/index'
import {
  runOpenCodePrompt,
  runOpenCodeSessionPrompt,
  type OpenCodePromptDispatchEvent,
} from '../../workflow/runOpenCodePrompt'
import { throwIfAborted } from '../../council/types'
import { throwIfCancelled } from '../../lib/abort'
import {
  buildStructuredRetryPrompt,
  normalizeInterviewTurnOutput,
  type InterviewTurnOutput,
} from '../../structuredOutput'
import { calculateFollowUpLimit } from './followUpBudget'
import { MAX_INTERVIEW_BATCH_SIZE, COUNCIL_RESPONSE_TIMEOUT_MS } from '../../lib/constants'

export { calculateFollowUpLimit } from './followUpBudget'

export interface QABatch {
  questions: InterviewQuestion[]
  batchNumber: number
  totalBatches: number
}

export interface BatchQuestion {
  id: string
  question: string
  phase?: string
  priority?: string
  rationale?: string
  answerType?: 'free_text' | 'single_choice' | 'multiple_choice'
  options?: Array<{ id: string; label: string }>
}

export interface BatchResponse {
  questions: BatchQuestion[]
  progress: { current: number; total: number }
  isComplete: boolean
  isFinalFreeForm: boolean
  aiCommentary: string
  finalYaml?: string
  batchNumber: number
}

const PROM4_SCHEMA_REMINDER = [
  'Return exactly one structured tag block and nothing else.',
  'If the interview should continue, return exactly one <INTERVIEW_BATCH>...</INTERVIEW_BATCH> block.',
  'Inside <INTERVIEW_BATCH>, return YAML with: batch_number, progress.current, progress.total, is_final_free_form, ai_commentary, questions[].',
  'Each question item must include: id, question, phase, priority, rationale.',
  'Each question item MAY optionally include: answer_type (free_text|single_choice|multiple_choice) and options[] with id and label fields.',
  'If the interview is complete, return exactly one <INTERVIEW_COMPLETE>...</INTERVIEW_COMPLETE> block.',
  'Inside <INTERVIEW_COMPLETE>, return YAML with these exact top-level keys: schema_version, ticket_id, artifact, status, generated_by, questions, follow_up_rounds, summary, approval.',
  'Each `questions` item must include: id, phase, prompt, source, follow_up_round, answer_type, options, answer.',
  'Each `answer` item must include: skipped, selected_option_ids, free_text, answered_by, answered_at.',
  PROM4_FINAL_INTERVIEW_SCHEMA,
].join('\n')

export function createBatches(questions: InterviewQuestion[], batchSize: number = MAX_INTERVIEW_BATCH_SIZE): QABatch[] {
  const batches: QABatch[] = []
  const totalBatches = Math.ceil(questions.length / batchSize)

  for (let i = 0; i < questions.length; i += batchSize) {
    batches.push({
      questions: questions.slice(i, i + batchSize),
      batchNumber: Math.floor(i / batchSize) + 1,
      totalBatches,
    })
  }

  return batches
}

export function processAnswers(
  questions: InterviewQuestion[],
  answers: Record<string, string>,
): InterviewAnswer[] {
  return questions.map(q => {
    const raw = answers[q.id]
    return {
      questionId: q.id,
      answer: raw ?? '',
      skipped: !raw || raw.trim() === '',
    }
  })
}

/**
 * Start a new PROM4 interview session with the winning AI model.
 * Creates an OpenCode session, sends the initial prompt with compiled questions,
 * and returns the first batch of questions from the AI.
 */
export async function startInterviewSession(
  adapter: OpenCodeAdapter,
  projectPath: string,
  winnerId: string,
  compiledQuestions: string,
  ticketState: TicketState,
  maxQuestions: number,
  followUpBudgetPercent: number,
  signal?: AbortSignal,
  onOpenCodeStreamEvent?: (entry: { sessionId: string; event: StreamEvent }) => void,
  onPromptDispatched?: (entry: { sessionId: string; event: OpenCodePromptDispatchEvent }) => void,
  ticketId?: string,
  timeoutMs: number = COUNCIL_RESPONSE_TIMEOUT_MS,
): Promise<{ sessionId: string; firstBatch: BatchResponse }> {
  const contextParts = buildMinimalContext('interview_qa', ticketState)
  const prompt = buildConversationalPrompt(PROM4, contextParts)

  const fullPrompt = [
    prompt,
    '',
    `## Configuration`,
    `max_initial_questions: ${maxQuestions}`,
    `coverage_follow_up_budget_percent: ${followUpBudgetPercent}`,
    `max_follow_ups: ${calculateFollowUpLimit(maxQuestions, followUpBudgetPercent)}`,
    '',
    `## Compiled Questions (from council)`,
    compiledQuestions,
    '',
    `Begin the interview now. Present the first batch of questions.`,
  ].join('\n')

  let sessionId = ''
  throwIfAborted(signal)
  let result: Awaited<ReturnType<typeof runOpenCodePrompt>>
  try {
    result = await runOpenCodePrompt({
      adapter,
      projectPath,
      parts: [{ type: 'text', content: fullPrompt }] as PromptPart[],
      signal,
      timeoutMs,
      model: winnerId,
      ...(ticketId
        ? {
            sessionOwnership: {
              ticketId,
              phase: 'WAITING_INTERVIEW_ANSWERS',
              memberId: winnerId,
              keepActive: true,
            },
          }
        : {}),
      onSessionCreated: (session) => {
        sessionId = session.id
      },
      onStreamEvent: (event) => {
        onOpenCodeStreamEvent?.({
          sessionId,
          event,
        })
      },
      onPromptDispatched: (event) => {
        onPromptDispatched?.({
          sessionId: event.session.id,
          event,
        })
      },
    })
  } catch (error) {
    throwIfCancelled(error, signal)
    throw error
  }

  throwIfAborted(signal)
  const firstBatch = await parseBatchResponseWithRetry({
    adapter,
    sessionId: result.session.id,
    response: result.response,
    signal,
    timeoutMs,
    model: winnerId,
    onOpenCodeStreamEvent,
    onPromptDispatched,
    ticketId,
  })
  return { sessionId: result.session.id, firstBatch }
}

/**
 * Submit a batch of user answers to an existing PROM4 session.
 * Formats answers as a message and sends to the AI for processing.
 */
export async function submitBatchToSession(
  adapter: OpenCodeAdapter,
  sessionId: string,
  batchAnswers: Record<string, string>,
  signal?: AbortSignal,
  model?: string,
  onOpenCodeStreamEvent?: (entry: { sessionId: string; event: StreamEvent }) => void,
  onPromptDispatched?: (entry: { sessionId: string; event: OpenCodePromptDispatchEvent }) => void,
  ticketId?: string,
  timeoutMs: number = COUNCIL_RESPONSE_TIMEOUT_MS,
): Promise<BatchResponse> {
  const answerLines = Object.entries(batchAnswers).map(([id, answer]) => {
    const text = answer.trim() || '[SKIPPED]'
    return `${id}: ${text}`
  })

  const message = [
    `Here are my answers:`,
    '',
    ...answerLines,
    '',
    `Please continue with the next batch of questions, or finalize the interview if complete.`,
  ].join('\n')

  throwIfAborted(signal)
  let result: Awaited<ReturnType<typeof runOpenCodeSessionPrompt>>
  try {
    result = await runOpenCodeSessionPrompt({
      adapter,
      session: { id: sessionId },
      parts: [{ type: 'text', content: message }] as PromptPart[],
      signal,
      timeoutMs,
      model,
      onStreamEvent: (event) => {
        onOpenCodeStreamEvent?.({
          sessionId,
          event,
        })
      },
      onPromptDispatched: (event) => {
        onPromptDispatched?.({
          sessionId: event.session.id,
          event,
        })
      },
    })
  } catch (error) {
    throwIfCancelled(error, signal)
    throw error
  }

  throwIfAborted(signal)
  return await parseBatchResponseWithRetry({
    adapter,
    sessionId,
    response: result.response,
    signal,
    timeoutMs,
    model,
    onOpenCodeStreamEvent,
    onPromptDispatched,
    ticketId,
  })
}

/**
 * Parse an AI response to extract batch data from structured tags.
 * Supports <INTERVIEW_BATCH> for intermediate batches and <INTERVIEW_COMPLETE> for final output.
 */
export function parseBatchResponse(response: string): BatchResponse {
  const normalized = normalizeInterviewTurnOutput(response)
  if (!normalized.ok) {
    throw new Error(normalized.error)
  }
  return toBatchResponse(normalized.value)
}

function toBatchResponse(output: InterviewTurnOutput): BatchResponse {
  if (output.kind === 'complete') {
    return {
      questions: [],
      progress: { current: 0, total: 0 },
      isComplete: true,
      isFinalFreeForm: false,
      aiCommentary: 'Interview complete.',
      finalYaml: output.finalYaml.trim(),
      batchNumber: -1,
    }
  }

  return {
    questions: output.batch.questions.map((question) => ({
      id: question.id,
      question: question.question,
      phase: question.phase,
      priority: question.priority,
      rationale: question.rationale,
      ...(question.answerType ? { answerType: question.answerType } : {}),
      ...(question.options && question.options.length > 0 ? { options: question.options } : {}),
    })),
    progress: output.batch.progress,
    isComplete: false,
    isFinalFreeForm: output.batch.isFinalFreeForm,
    aiCommentary: output.batch.aiCommentary,
    batchNumber: output.batch.batchNumber,
  }
}

async function parseBatchResponseWithRetry(input: {
  adapter: OpenCodeAdapter
  sessionId: string
  response: string
  signal?: AbortSignal
  timeoutMs?: number
  model?: string
  onOpenCodeStreamEvent?: (entry: { sessionId: string; event: StreamEvent }) => void
  onPromptDispatched?: (entry: { sessionId: string; event: OpenCodePromptDispatchEvent }) => void
  ticketId?: string
}): Promise<BatchResponse> {
  const normalized = normalizeInterviewTurnOutput(input.response)
  if (normalized.ok) {
    return toBatchResponse(normalized.value)
  }

  const retryParts = buildStructuredRetryPrompt([], {
    validationError: normalized.error,
    rawResponse: input.response,
    schemaReminder: PROM4_SCHEMA_REMINDER,
  })

  let retryResult: Awaited<ReturnType<typeof runOpenCodeSessionPrompt>>
  try {
    retryResult = await runOpenCodeSessionPrompt({
      adapter: input.adapter,
      session: { id: input.sessionId },
      parts: retryParts,
      signal: input.signal,
      timeoutMs: input.timeoutMs ?? COUNCIL_RESPONSE_TIMEOUT_MS,
      model: input.model,
      onStreamEvent: (event) => {
        input.onOpenCodeStreamEvent?.({
          sessionId: input.sessionId,
          event,
        })
      },
      onPromptDispatched: (event) => {
        input.onPromptDispatched?.({
          sessionId: event.session.id,
          event,
        })
      },
    })
  } catch (error) {
    throwIfCancelled(error, input.signal)
    throw error
  }

  throwIfAborted(input.signal)
  const retried = normalizeInterviewTurnOutput(retryResult.response)
  if (!retried.ok) {
    throw new Error(`PROM4 output failed validation after retry: ${retried.error}`)
  }

  return toBatchResponse(retried.value)
}
