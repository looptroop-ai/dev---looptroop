import { parseInterviewQuestions, type ParsedInterviewQuestion } from './questions'

const VALID_PHASES = ['foundation', 'structure', 'assembly'] as const
const PHASE_ORDER = new Map(VALID_PHASES.map((phase, index) => [phase, index]))

export interface ValidatedInterviewDraft {
  questionCount: number
  questions: ParsedInterviewQuestion[]
}

function normalizePhase(phase: string): string {
  return phase.trim().toLowerCase()
}

export function validateInterviewDraft(
  content: string,
  maxInitialQuestions: number,
): ValidatedInterviewDraft {
  const seenIds = new Set<string>()
  let lastPhaseOrder = -1

  const questions = parseInterviewQuestions(content)

  for (const [index, question] of questions.entries()) {
    const normalizedId = question.id.trim()
    const normalizedQuestion = question.question.trim()
    const normalizedPhase = normalizePhase(question.phase)
    const phaseOrder = PHASE_ORDER.get(normalizedPhase as typeof VALID_PHASES[number])

    if (seenIds.has(normalizedId)) {
      throw new Error(`Duplicate question id: ${normalizedId}`)
    }
    seenIds.add(normalizedId)

    if (!phaseOrder && phaseOrder !== 0) {
      throw new Error(`Unknown question phase at index ${index}: ${question.phase}`)
    }

    if (!normalizedQuestion) {
      throw new Error(`Empty question text at index ${index}`)
    }

    if (phaseOrder < lastPhaseOrder) {
      throw new Error(`Question phase order regressed at index ${index}: ${question.phase}`)
    }
    lastPhaseOrder = phaseOrder
  }

  if (maxInitialQuestions > 0 && questions.length > maxInitialQuestions) {
    throw new Error(`Question count ${questions.length} exceeds max_initial_questions=${maxInitialQuestions}`)
  }

  return {
    questionCount: questions.length,
    questions,
  }
}
