import type { InterviewQuestion, InterviewAnswer } from './types'

export interface QABatch {
  questions: InterviewQuestion[]
  batchNumber: number
  totalBatches: number
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
