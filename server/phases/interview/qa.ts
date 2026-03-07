import type { InterviewQuestion, InterviewAnswer } from './types'
import type { OpenCodeAdapter } from '../../opencode/adapter'
import type { PromptPart } from '../../opencode/types'
import { buildMinimalContext, type TicketState } from '../../opencode/contextBuilder'
import { buildConversationalPrompt, PROM4 } from '../../prompts/index'
// @ts-expect-error no type declarations for js-yaml
import jsYaml from 'js-yaml'

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

export function createBatches(questions: InterviewQuestion[], batchSize: number = 3): QABatch[] {
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

export function calculateFollowUpLimit(totalQuestions: number): number {
  return Math.max(1, Math.floor(totalQuestions * 0.2))
}

/**
 * Start a new PROM4 interview session with the winning AI model.
 * Creates an OpenCode session, sends the initial prompt with compiled questions,
 * and returns the first batch of questions from the AI.
 */
export async function startInterviewSession(
  adapter: OpenCodeAdapter,
  projectPath: string,
  _winnerId: string,
  compiledQuestions: string,
  ticketState: TicketState,
  maxQuestions: number,
  signal?: AbortSignal,
): Promise<{ sessionId: string; firstBatch: BatchResponse }> {
  const contextParts = buildMinimalContext('interview_qa', ticketState)
  const prompt = buildConversationalPrompt(
    PROM4,
    contextParts.map(p => ({ type: p.type, content: p.content })),
  )

  const fullPrompt = [
    prompt,
    '',
    `## Configuration`,
    `max_initial_questions: ${maxQuestions}`,
    `max_follow_ups: ${calculateFollowUpLimit(maxQuestions)}`,
    '',
    `## Compiled Questions (from council)`,
    compiledQuestions,
    '',
    `Begin the interview now. Present the first batch of questions.`,
  ].join('\n')

  const session = await adapter.createSession(projectPath, signal)
  const response = await adapter.promptSession(
    session.id,
    [{ type: 'text', content: fullPrompt }] as PromptPart[],
    signal,
  )

  const firstBatch = parseBatchResponse(response)
  return { sessionId: session.id, firstBatch }
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

  const response = await adapter.promptSession(
    sessionId,
    [{ type: 'text', content: message }] as PromptPart[],
    signal,
  )

  return parseBatchResponse(response)
}

/**
 * Parse an AI response to extract batch data from structured tags.
 * Supports <INTERVIEW_BATCH> for intermediate batches and <INTERVIEW_COMPLETE> for final output.
 */
export function parseBatchResponse(response: string): BatchResponse {
  // Check for <INTERVIEW_COMPLETE> first (final output)
  const completeMatch = response.match(/<INTERVIEW_COMPLETE>([\s\S]*?)<\/INTERVIEW_COMPLETE>/)
  if (completeMatch) {
    return {
      questions: [],
      progress: { current: 0, total: 0 },
      isComplete: true,
      isFinalFreeForm: false,
      aiCommentary: 'Interview complete.',
      finalYaml: completeMatch[1]!.trim(),
      batchNumber: -1,
    }
  }

  // Check for <INTERVIEW_BATCH> tags
  const batchMatch = response.match(/<INTERVIEW_BATCH>([\s\S]*?)<\/INTERVIEW_BATCH>/)
  if (batchMatch) {
    try {
      const parsed = jsYaml.load(batchMatch[1]!.trim()) as Record<string, unknown>
      return extractBatchFromParsed(parsed)
    } catch {
      // Fall through to YAML fallback
    }
  }

  // Fallback: try to parse the entire response as YAML
  try {
    const parsed = jsYaml.load(response) as Record<string, unknown> | null
    if (parsed && typeof parsed === 'object') {
      // Check if this looks like a final interview results YAML
      if ('schema_version' in parsed || 'questions' in parsed && 'approval' in parsed) {
        return {
          questions: [],
          progress: { current: 0, total: 0 },
          isComplete: true,
          isFinalFreeForm: false,
          aiCommentary: 'Interview complete.',
          finalYaml: response.trim(),
          batchNumber: -1,
        }
      }
      // Try to extract as batch data
      if ('questions' in parsed || 'batch_number' in parsed) {
        return extractBatchFromParsed(parsed)
      }
    }
  } catch {
    // Not valid YAML — use heuristic below
  }

  // Last resort: extract questions heuristically from text
  const questions: BatchQuestion[] = []
  const lines = response.split('\n')
  let qIndex = 1
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.endsWith('?') && trimmed.length > 10) {
      const cleaned = trimmed.replace(/^[-*\d.\)]+\s*/, '').replace(/^\*\*/, '').replace(/\*\*$/, '')
      if (cleaned.length > 5) {
        questions.push({ id: `Q${qIndex++}`, question: cleaned })
      }
    }
  }

  return {
    questions,
    progress: { current: 0, total: 0 },
    isComplete: questions.length === 0,
    isFinalFreeForm: false,
    aiCommentary: questions.length === 0 ? 'Could not parse AI response.' : '',
    finalYaml: questions.length === 0 ? response.trim() : undefined,
    batchNumber: 1,
  }
}

function extractBatchFromParsed(parsed: Record<string, unknown>): BatchResponse {
  const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : []
  const questions: BatchQuestion[] = rawQuestions.map((q: unknown, idx: number) => {
    const qObj = (q && typeof q === 'object') ? q as Record<string, unknown> : {}
    return {
      id: typeof qObj.id === 'string' ? qObj.id : `Q${idx + 1}`,
      question: typeof qObj.question === 'string' ? qObj.question : String(qObj.question ?? ''),
      phase: typeof qObj.phase === 'string' ? qObj.phase : (typeof qObj.category === 'string' ? qObj.category : undefined),
      priority: typeof qObj.priority === 'string' ? qObj.priority : undefined,
      rationale: typeof qObj.rationale === 'string' ? qObj.rationale : undefined,
    }
  })

  const progressObj = (parsed.progress && typeof parsed.progress === 'object') ? parsed.progress as Record<string, unknown> : undefined
  const current = typeof progressObj?.current === 'number' ? progressObj.current : 0
  const total = typeof progressObj?.total === 'number' ? progressObj.total : 0

  return {
    questions,
    progress: { current, total },
    isComplete: false,
    isFinalFreeForm: parsed.is_final_free_form === true,
    aiCommentary: typeof parsed.ai_commentary === 'string' ? parsed.ai_commentary : '',
    batchNumber: typeof parsed.batch_number === 'number' ? parsed.batch_number : 1,
  }
}
