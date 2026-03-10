import { z } from 'zod'
// @ts-expect-error no type declarations for js-yaml
import jsYaml from 'js-yaml'

const parsedQuestionSchema = z.strictObject({
  id: z.string().trim().min(1),
  phase: z.string().trim().min(1),
  question: z.string().trim().min(1),
})

const parsedQuestionListSchema = z.array(parsedQuestionSchema).min(1)
const wrappedQuestionsSchema = z.strictObject({
  questions: parsedQuestionListSchema,
})

export type ParsedInterviewQuestion = z.infer<typeof parsedQuestionSchema>

interface ParseInterviewQuestionsOptions {
  allowTopLevelArray?: boolean
}

export function unwrapInterviewYamlFence(content: string): string {
  const trimmed = content.trim()
  const fenced = trimmed.match(/^```(?:yaml|yml)?\s*([\s\S]*?)\s*```$/i)
  if (!fenced) return trimmed
  return fenced[1]!.trim()
}

export function parseInterviewQuestions(
  content: string,
  options: ParseInterviewQuestionsOptions = {},
): ParsedInterviewQuestion[] {
  const normalizedContent = unwrapInterviewYamlFence(content)
  let parsedYaml: unknown

  try {
    parsedYaml = jsYaml.load(normalizedContent)
  } catch (err) {
    throw new Error(`Invalid YAML: ${err instanceof Error ? err.message : String(err)}`)
  }

  const wrapped = wrappedQuestionsSchema.safeParse(parsedYaml)
  if (wrapped.success) return wrapped.data.questions

  if (options.allowTopLevelArray) {
    const bare = parsedQuestionListSchema.safeParse(parsedYaml)
    if (bare.success) return bare.data
  }

  throw new Error(`Draft does not match PROM1 schema: ${wrapped.error.issues[0]?.message ?? 'unknown schema error'}`)
}

export function formatInterviewQuestionPreview(
  label: string,
  questions: ParsedInterviewQuestion[],
  maxPreviewQuestions: number = 3,
): string {
  const visibleQuestions = questions.slice(0, maxPreviewQuestions)
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
