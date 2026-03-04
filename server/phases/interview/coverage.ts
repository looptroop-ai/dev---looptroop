import type { InterviewResult } from './types'

export function verifyInterviewCoverage(result: InterviewResult): {
  passed: boolean
  gaps: string[]
  coveragePercent: number
} {
  const totalQuestions = result.questions.length
  const answered = result.answers.filter(a => !a.skipped).length
  const coveragePercent = totalQuestions > 0 ? Math.round((answered / totalQuestions) * 100) : 0

  const gaps: string[] = []

  // Check for unanswered critical questions
  for (const q of result.questions) {
    if (q.priority === 'critical') {
      const answer = result.answers.find(a => a.questionId === q.id)
      if (!answer || answer.skipped) {
        gaps.push(`Critical question unanswered: ${q.question}`)
      }
    }
  }

  // Must have at least 70% coverage
  if (coveragePercent < 70) {
    gaps.push(`Coverage too low: ${coveragePercent}% (minimum 70%)`)
  }

  return {
    passed: gaps.length === 0,
    gaps,
    coveragePercent,
  }
}
