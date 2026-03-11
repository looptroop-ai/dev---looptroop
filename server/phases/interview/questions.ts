import { z } from 'zod'
// @ts-expect-error no type declarations for js-yaml
import jsYaml from 'js-yaml'

const rawParsedQuestionSchema = z.object({
  id: z.string().trim().min(1),
  phase: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional(),
  question: z.string().trim().min(1).optional(),
  prompt: z.string().trim().min(1).optional(),
}).passthrough().transform((value, ctx) => {
  const phase = value.phase?.trim() ?? value.category?.trim()
  if (!phase) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Each question must include `phase` or `category`.',
      path: ['phase'],
    })
    return z.NEVER
  }

  const question = value.question?.trim() ?? value.prompt?.trim()
  if (!question) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Each question must include `question` or `prompt`.',
      path: ['question'],
    })
    return z.NEVER
  }

  return {
    id: value.id.trim(),
    phase,
    question,
  }
})

const parsedQuestionSchema = rawParsedQuestionSchema
const parsedQuestionListSchema = z.array(parsedQuestionSchema).min(1)
const wrappedQuestionsSchema = z.object({
  questions: parsedQuestionListSchema,
}).passthrough()

export type ParsedInterviewQuestion = z.infer<typeof parsedQuestionSchema>

interface ParseInterviewQuestionsOptions {
  allowTopLevelArray?: boolean
}

export function unwrapInterviewYamlFence(content: string): string {
  return getInterviewYamlCandidates(content)[0] ?? content.trim()
}

function getInterviewYamlCandidates(content: string): string[] {
  const trimmed = content.trim()
  if (!trimmed) return []

  const candidates: string[] = []
  const seen = new Set<string>()
  const addCandidate = (candidate: string | null | undefined) => {
    const normalized = candidate?.trim()
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    candidates.push(normalized)
  }

  addCandidate(trimmed)

  const fencedMatches = trimmed.matchAll(/```(?:yaml|yml)?\s*([\s\S]*?)\s*```/gi)
  for (const match of fencedMatches) {
    addCandidate(match[1])
  }

  const lines = trimmed.split('\n')
  const questionsIndex = lines.findIndex((line) => /^\s*questions\s*:/.test(line))
  if (questionsIndex >= 0) {
    addCandidate(lines.slice(questionsIndex).join('\n'))
  }

  const arrayIndex = lines.findIndex((line) => /^\s*-\s*id\s*:/.test(line))
  if (arrayIndex >= 0) {
    addCandidate(lines.slice(arrayIndex).join('\n'))
  }

  return candidates
}

export function parseInterviewQuestions(
  content: string,
  options: ParseInterviewQuestionsOptions = {},
): ParsedInterviewQuestion[] {
  const candidates = getInterviewYamlCandidates(content)
  let lastSchemaError: string | null = null
  let lastYamlError: string | null = null

  for (const candidate of candidates) {
    let parsedYaml: unknown

    try {
      parsedYaml = jsYaml.load(candidate)
    } catch (err) {
      lastYamlError = err instanceof Error ? err.message : String(err)
      continue
    }

    const wrapped = wrappedQuestionsSchema.safeParse(parsedYaml)
    if (wrapped.success) return wrapped.data.questions
    lastSchemaError = wrapped.error.issues[0]?.message ?? 'unknown schema error'

    if (options.allowTopLevelArray) {
      const bare = parsedQuestionListSchema.safeParse(parsedYaml)
      if (bare.success) return bare.data
      lastSchemaError = bare.error.issues[0]?.message ?? lastSchemaError
    }
  }

  if (lastSchemaError) {
    throw new Error(`Draft does not match PROM1 schema: ${lastSchemaError}`)
  }

  throw new Error(`Invalid YAML: ${lastYamlError ?? 'could not parse interview questions'}`)
}

export function formatInterviewQuestionPreview(
  label: string,
  questions: ParsedInterviewQuestion[],
  maxPreviewQuestions: number = questions.length,
): string {
  const previewCount = Math.max(0, Math.trunc(maxPreviewQuestions))
  const visibleQuestions = questions.slice(0, previewCount)
  const previewLines = visibleQuestions.map(question =>
    `- [${question.phase.trim().toLowerCase()}] ${question.question.trim()}`,
  )
  const remainingCount = questions.length - visibleQuestions.length

  return [
    `${label} (${questions.length} total):`,
    ...previewLines,
    ...(remainingCount > 0 ? [`... ${remainingCount} more ${remainingCount === 1 ? 'question' : 'questions'}`] : []),
  ].join('\n')
}
