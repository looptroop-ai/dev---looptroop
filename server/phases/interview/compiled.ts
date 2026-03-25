import type { ParsedInterviewQuestion } from './questions'
import type { InspirationSource, InterviewQuestionChange, InterviewQuestionChangeType } from '@shared/interviewQuestions'
import { normalizeInterviewRefinementOutput } from '../../structuredOutput'

export interface CompiledInterviewArtifact {
  winnerId: string
  refinedContent: string
  questions: ParsedInterviewQuestion[]
  questionCount: number
  changes: InterviewQuestionChange[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatArtifactPhase(phase: string): string {
  const normalized = phase.trim().toLowerCase()
  if (normalized === 'foundation') return 'Foundation'
  if (normalized === 'structure') return 'Structure'
  if (normalized === 'assembly') return 'Assembly'
  return phase.trim()
}

function normalizeArtifactQuestion(value: unknown, index: number): ParsedInterviewQuestion {
  if (!isRecord(value)) {
    throw new Error(`Compiled interview question at index ${index} is not an object`)
  }

  const id = typeof value.id === 'string' ? value.id.trim() : ''
  const phase = typeof value.phase === 'string' ? formatArtifactPhase(value.phase) : ''
  const question = typeof value.question === 'string' ? value.question.trim() : ''

  if (!id) throw new Error(`Compiled interview question at index ${index} is missing id`)
  if (!phase) throw new Error(`Compiled interview question at index ${index} is missing phase`)
  if (!question) throw new Error(`Compiled interview question at index ${index} is missing question text`)

  return { id, phase, question }
}

function normalizeArtifactChangeType(value: unknown, index: number): InterviewQuestionChangeType {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (raw === 'modified' || raw === 'replaced' || raw === 'added' || raw === 'removed') {
    return raw
  }
  throw new Error(`Compiled interview change at index ${index} has an invalid type`)
}

function normalizeArtifactInspirationSource(value: unknown): InspirationSource | null {
  if (!value || !isRecord(value)) return null

  const draftIndex = typeof value.draftIndex === 'number' ? value.draftIndex : -1
  const memberId = typeof value.memberId === 'string' ? value.memberId : ''
  const rawQuestion = value.question
  if (!isRecord(rawQuestion)) return null

  const id = typeof rawQuestion.id === 'string' ? rawQuestion.id.trim() : ''
  const phase = typeof rawQuestion.phase === 'string' ? rawQuestion.phase.trim() : ''
  const question = typeof rawQuestion.question === 'string' ? rawQuestion.question.trim() : ''
  if (!id || !phase || !question) return null

  return { draftIndex, memberId, question: { id, phase, question } }
}

function normalizeArtifactChange(value: unknown, index: number): InterviewQuestionChange {
  if (!isRecord(value)) {
    throw new Error(`Compiled interview change at index ${index} is not an object`)
  }

  const hasBefore = Object.keys(value).some((key) => key.trim().toLowerCase() === 'before')
  const hasAfter = Object.keys(value).some((key) => key.trim().toLowerCase() === 'after')
  if (!hasBefore) throw new Error(`Compiled interview change at index ${index} is missing before`)
  if (!hasAfter) throw new Error(`Compiled interview change at index ${index} is missing after`)

  return {
    type: normalizeArtifactChangeType(value.type, index),
    before: value.before === null ? null : normalizeArtifactQuestion(value.before, index),
    after: value.after === null ? null : normalizeArtifactQuestion(value.after, index),
    inspiration: normalizeArtifactInspirationSource(value.inspiration),
  }
}

export function buildCompiledInterviewArtifact(
  winnerId: string,
  refinementOutput: string,
  winnerDraftContent: string,
  maxInitialQuestions: number,
  losingDraftMeta?: Array<{ memberId: string; content: string }>,
): CompiledInterviewArtifact {
  const normalizedWinnerId = winnerId.trim()
  if (!normalizedWinnerId) {
    throw new Error('Compiled interview artifact is missing a winner model id')
  }

  const refinement = normalizeInterviewRefinementOutput(
    refinementOutput,
    winnerDraftContent,
    maxInitialQuestions,
    losingDraftMeta,
  )
  if (!refinement.ok) {
    throw new Error(refinement.error)
  }

  if (refinement.value.questionCount <= 0) {
    throw new Error('PROM3 refinement produced zero questions')
  }

  return {
    winnerId: normalizedWinnerId,
    refinedContent: refinement.value.questionsYaml.trim(),
    questions: refinement.value.questions.map((question) => ({
      id: question.id,
      phase: formatArtifactPhase(question.phase),
      question: question.question,
    })),
    questionCount: refinement.value.questionCount,
    changes: refinement.value.changes.map((change) => ({
      type: change.type,
      before: change.before
        ? {
            id: change.before.id,
            phase: formatArtifactPhase(change.before.phase),
            question: change.before.question,
          }
        : null,
      after: change.after
        ? {
            id: change.after.id,
            phase: formatArtifactPhase(change.after.phase),
            question: change.after.question,
          }
        : null,
      inspiration: change.inspiration
        ? {
            draftIndex: change.inspiration.draftIndex,
            memberId: change.inspiration.memberId,
            question: {
              id: change.inspiration.question.id,
              phase: formatArtifactPhase(change.inspiration.question.phase),
              question: change.inspiration.question.question,
            },
          }
        : null,
    })),
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
  const rawChanges = parsed.changes

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
  const changes = rawChanges === undefined
    ? []
    : Array.isArray(rawChanges)
      ? rawChanges.map((change, index) => normalizeArtifactChange(change, index))
      : (() => { throw new Error('Compiled interview artifact changes must be an array') })()

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
    changes,
  }
}

export function requireCompiledInterviewArtifact(content: string | null | undefined): CompiledInterviewArtifact {
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('No validated compiled interview found')
  }

  return parseCompiledInterviewArtifact(content)
}
