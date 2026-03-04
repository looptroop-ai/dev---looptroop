import { describe, it, expect } from 'vitest'
import { createBatches, processAnswers, calculateFollowUpLimit } from '../interview/qa'
import { verifyInterviewCoverage } from '../interview/coverage'
import { verifyPRDCoverage } from '../prd/coverage'
import { verifyBeadsCoverage } from '../beads/coverage'
import { expandBeads } from '../beads/expand'
import type { InterviewQuestion, InterviewResult } from '../interview/types'
import type { Bead, BeadSubset } from '../beads/types'

describe('Interview Q&A', () => {
  const questions: InterviewQuestion[] = [
    { id: 'q1', category: 'scope', question: 'What scope?', priority: 'critical', rationale: 'test' },
    { id: 'q2', category: 'scope', question: 'What edge cases?', priority: 'high', rationale: 'test' },
    { id: 'q3', category: 'ux', question: 'What UX?', priority: 'medium', rationale: 'test' },
    { id: 'q4', category: 'ux', question: 'What flow?', priority: 'low', rationale: 'test' },
    { id: 'q5', category: 'tech', question: 'What tech?', priority: 'medium', rationale: 'test' },
  ]

  it('creates batches of 3', () => {
    const batches = createBatches(questions, 3)
    expect(batches.length).toBe(2)
    expect(batches[0]!.questions.length).toBe(3)
    expect(batches[1]!.questions.length).toBe(2)
  })

  it('processes answers including skipped', () => {
    const answers = processAnswers(questions, { q1: 'answer 1', q3: 'answer 3' })
    expect(answers.length).toBe(5)
    expect(answers[0]!.skipped).toBe(false)
    expect(answers[1]!.skipped).toBe(true)
    expect(answers[2]!.skipped).toBe(false)
  })

  it('calculates follow-up limit at 20%', () => {
    expect(calculateFollowUpLimit(10)).toBe(2)
    expect(calculateFollowUpLimit(5)).toBe(1)
    expect(calculateFollowUpLimit(1)).toBe(1)
  })
})

describe('Interview Coverage', () => {
  it('passes with all critical questions answered', () => {
    const result: InterviewResult = {
      questions: [
        { id: 'q1', category: 'scope', question: 'What?', priority: 'critical', rationale: '' },
        { id: 'q2', category: 'ux', question: 'How?', priority: 'high', rationale: '' },
      ],
      answers: [
        { questionId: 'q1', answer: 'answer', skipped: false },
        { questionId: 'q2', answer: 'answer', skipped: false },
      ],
      followUps: [],
      coverageReport: { passed: true, gaps: [] },
    }
    const coverage = verifyInterviewCoverage(result)
    expect(coverage.passed).toBe(true)
    expect(coverage.coveragePercent).toBe(100)
  })

  it('fails with unanswered critical question', () => {
    const result: InterviewResult = {
      questions: [
        { id: 'q1', category: 'scope', question: 'Critical Q', priority: 'critical', rationale: '' },
      ],
      answers: [{ questionId: 'q1', answer: '', skipped: true }],
      followUps: [],
      coverageReport: { passed: false, gaps: [] },
    }
    const coverage = verifyInterviewCoverage(result)
    expect(coverage.passed).toBe(false)
    expect(coverage.gaps.length).toBeGreaterThan(0)
  })
})

describe('PRD Coverage', () => {
  it('passes with sufficient PRD content', () => {
    const prd = 'This PRD contains an epic and a user story with detailed requirements...' + 'a'.repeat(200)
    const coverage = verifyPRDCoverage(prd, 'interview content')
    expect(coverage.passed).toBe(true)
  })

  it('fails with empty PRD', () => {
    const coverage = verifyPRDCoverage('', 'interview')
    expect(coverage.passed).toBe(false)
  })
})

describe('Beads Coverage', () => {
  const validBead: Bead = {
    id: 'b1', title: 'Bead 1', prdRefs: ['e1'], description: 'desc',
    contextGuidance: '', acceptanceCriteria: ['ac1'], tests: ['test1'],
    testCommands: ['npm test'], priority: 1, status: 'pending',
    labels: [], dependencies: [], targetFiles: [], notes: [],
    iteration: 0, createdAt: '', updatedAt: '', beadStartCommit: null,
    estimatedComplexity: 'moderate', epicId: 'e1', storyId: 's1',
  }

  it('passes with valid beads', () => {
    const result = verifyBeadsCoverage([validBead], 'prd content')
    expect(result.passed).toBe(true)
  })

  it('fails with no beads', () => {
    const result = verifyBeadsCoverage([], 'prd')
    expect(result.passed).toBe(false)
  })

  it('detects self-dependencies', () => {
    const bead = { ...validBead, dependencies: ['b1'] }
    const result = verifyBeadsCoverage([bead], 'prd')
    expect(result.passed).toBe(false)
    expect(result.gaps.some(g => g.includes('self-dependency'))).toBe(true)
  })

  it('detects dangling dependencies', () => {
    const bead = { ...validBead, dependencies: ['nonexistent'] }
    const result = verifyBeadsCoverage([bead], 'prd')
    expect(result.passed).toBe(false)
    expect(result.gaps.some(g => g.includes('non-existent'))).toBe(true)
  })

  it('detects circular dependencies', () => {
    const b1: Bead = { ...validBead, id: 'b1', dependencies: ['b2'] }
    const b2: Bead = { ...validBead, id: 'b2', dependencies: ['b1'] }
    const result = verifyBeadsCoverage([b1, b2], 'prd')
    expect(result.passed).toBe(false)
    expect(result.gaps.some(g => g.includes('Circular'))).toBe(true)
  })
})

describe('Beads Expansion', () => {
  it('expands subset beads to full fields', () => {
    const subsets: BeadSubset[] = [
      { id: 'b1', title: 'T1', prdRefs: [], description: 'd', contextGuidance: '',
        acceptanceCriteria: ['ac'], tests: ['t'], testCommands: ['cmd'] },
    ]
    const expanded = expandBeads(subsets)
    expect(expanded.length).toBe(1)
    expect(expanded[0]!.priority).toBe(1)
    expect(expanded[0]!.status).toBe('pending')
    expect(expanded[0]!.iteration).toBe(0)
    expect(expanded[0]!.beadStartCommit).toBeNull()
  })
})
