import type { ParsedInterviewQuestion } from './questions'
import { validateInterviewDraft } from './validation'

export interface CompiledInterviewArtifact {
  winnerId: string
  refinedContent: string
  questions: ParsedInterviewQuestion[]
  questionCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeArtifactQuestion(value: unknown, index: number): ParsedInterviewQuestion {
  if (!isRecord(value)) {
    throw new Error(`Compiled interview question at index ${index} is not an object`)
  }

  const id = typeof value.id === 'string' ? value.id.trim() : ''
  const phase = typeof value.phase === 'string' ? value.phase.trim() : ''
  const question = typeof value.question === 'string' ? value.question.trim() : ''

  if (!id) throw new Error(`Compiled interview question at index ${index} is missing id`)
  if (!phase) throw new Error(`Compiled interview question at index ${index} is missing phase`)
  if (!question) throw new Error(`Compiled interview question at index ${index} is missing question text`)

  return { id, phase, question }
}

export function buildCompiledInterviewArtifact(
  winnerId: string,
  refinedContent: string,
  maxInitialQuestions: number,
): CompiledInterviewArtifact {
  const normalizedWinnerId = winnerId.trim()
  if (!normalizedWinnerId) {
    throw new Error('Compiled interview artifact is missing a winner model id')
  }

  const validated = validateInterviewDraft(refinedContent, maxInitialQuestions)
  if (validated.questionCount <= 0) {
    throw new Error('PROM3 refinement produced zero questions')
  }

  return {
    winnerId: normalizedWinnerId,
    refinedContent,
    questions: validated.questions,
    questionCount: validated.questionCount,
  }
}

export function parseCompiledInterviewArtifact(content: string): CompiledInterviewArtifact {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('Compiled interview artifact is not valid JSON')
  }

  if (!isRecord(parsed)) {
    throw new Error('Compiled interview artifact payload is invalid')
  }

  const winnerId = typeof parsed.winnerId === 'string' ? parsed.winnerId.trim() : ''
  const refinedContent = typeof parsed.refinedContent === 'string' ? parsed.refinedContent : ''
  const rawQuestions = parsed.questions
  const rawQuestionCount = parsed.questionCount

  if (!winnerId) {
    throw new Error('Compiled interview artifact is missing winnerId')
  }
  if (!refinedContent.trim()) {
    throw new Error('Compiled interview artifact is missing refinedContent')
  }
  if (!Array.isArray(rawQuestions)) {
    throw new Error('Compiled interview artifact is missing questions')
  }

  const questions = rawQuestions.map((question, index) => normalizeArtifactQuestion(question, index))
  const questionCount = typeof rawQuestionCount === 'number' ? rawQuestionCount : questions.length

  if (!Number.isInteger(questionCount) || questionCount <= 0) {
    throw new Error('Compiled interview artifact has an invalid questionCount')
  }
  if (questions.length === 0) {
    throw new Error('Compiled interview artifact contains zero questions')
  }
  if (questionCount !== questions.length) {
    throw new Error('Compiled interview artifact questionCount does not match questions length')
  }

  return {
    winnerId,
    refinedContent,
    questions,
    questionCount,
  }
}

export function requireCompiledInterviewArtifact(content: string | null | undefined): CompiledInterviewArtifact {
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('No validated compiled interview found')
  }

  return parseCompiledInterviewArtifact(content)
}
