import { parseInterviewQuestions, type ParsedInterviewQuestion } from './questions'

const VALID_PHASES = ['foundation', 'structure', 'assembly'] as const
const PHASE_ORDER = new Map(VALID_PHASES.map((phase, index) => [phase, index]))

export interface ValidatedInterviewDraft {
  questionCount: number
  questions: ParsedInterviewQuestion[]
  repairWarnings: string[]
}

function normalizePhase(phase: string): string {
  return phase.trim().toLowerCase()
}

function normalizeId(rawId: string): string {
  const match = rawId.trim().match(/q?(\d+)/i)
  if (!match?.[1]) return rawId.trim()
  return `Q${match[1].padStart(2, '0')}`
}

export function validateInterviewDraft(
  content: string,
  maxInitialQuestions: number,
): ValidatedInterviewDraft {
  const seenIds = new Set<string>()
  const repairWarnings: string[] = []
  let lastPhaseOrder = -1

  const questions = parseInterviewQuestions(content)

  // Find the maximum numeric ID so duplicates can be renumbered above it.
  let maxNumericId = 0
  for (const question of questions) {
    const match = question.id.trim().match(/q?(\d+)/i)
    if (match?.[1]) {
      maxNumericId = Math.max(maxNumericId, Number(match[1]))
    }
  }
  let nextAvailableId = maxNumericId + 1

  for (const [index, question] of questions.entries()) {
    const normalizedId = normalizeId(question.id)
    const normalizedQuestion = question.question.trim()
    const normalizedPhase = normalizePhase(question.phase)
    const phaseOrder = PHASE_ORDER.get(normalizedPhase as typeof VALID_PHASES[number])

    if (seenIds.has(normalizedId)) {
      const newId = `Q${String(nextAvailableId).padStart(2, '0')}`
      repairWarnings.push(`Renumbered duplicate question id ${normalizedId} at index ${index} to ${newId}.`)
      question.id = newId
      nextAvailableId += 1
    }
    seenIds.add(normalizeId(question.id))

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
    repairWarnings,
  }
}
