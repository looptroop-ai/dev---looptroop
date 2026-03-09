import { z } from 'zod'
// @ts-expect-error no type declarations for js-yaml
import jsYaml from 'js-yaml'

const VALID_PHASES = ['foundation', 'structure', 'assembly'] as const
const PHASE_ORDER = new Map(VALID_PHASES.map((phase, index) => [phase, index]))

const questionSchema = z.strictObject({
  id: z.string().trim().min(1),
  phase: z.string().trim().min(1),
  question: z.string().trim().min(1),
})

const draftSchema = z.strictObject({
  questions: z.array(questionSchema).min(1),
})

export interface ValidatedInterviewDraft {
  questionCount: number
}

function normalizePhase(phase: string): string {
  return phase.trim().toLowerCase()
}

function unwrapYamlFence(content: string): string {
  const trimmed = content.trim()
  const fenced = trimmed.match(/^```(?:yaml|yml)?\s*([\s\S]*?)\s*```$/i)
  if (!fenced) return trimmed
  return fenced[1]!.trim()
}

export function validateInterviewDraft(
  content: string,
  maxInitialQuestions: number,
): ValidatedInterviewDraft {
  const normalizedContent = unwrapYamlFence(content)
  let parsedYaml: unknown
  try {
    parsedYaml = jsYaml.load(normalizedContent)
  } catch (err) {
    throw new Error(`Invalid YAML: ${err instanceof Error ? err.message : String(err)}`)
  }

  const parsed = draftSchema.safeParse(parsedYaml)
  if (!parsed.success) {
    throw new Error(`Draft does not match PROM1 schema: ${parsed.error.issues[0]?.message ?? 'unknown schema error'}`)
  }

  const seenIds = new Set<string>()
  let lastPhaseOrder = -1

  for (const [index, question] of parsed.data.questions.entries()) {
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

  if (maxInitialQuestions > 0 && parsed.data.questions.length > maxInitialQuestions) {
    throw new Error(`Question count ${parsed.data.questions.length} exceeds max_initial_questions=${maxInitialQuestions}`)
  }

  return {
    questionCount: parsed.data.questions.length,
  }
}
