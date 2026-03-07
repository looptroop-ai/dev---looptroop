export interface InterviewQuestion {
  id: string
  phase: string
  question: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  rationale: string
}

export interface InterviewAnswer {
  questionId: string
  answer: string
  skipped: boolean
}

export interface InterviewResult {
  questions: InterviewQuestion[]
  answers: InterviewAnswer[]
  followUps: InterviewQuestion[]
  coverageReport: {
    passed: boolean
    gaps: string[]
  }
}
