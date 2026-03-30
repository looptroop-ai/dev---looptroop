import { describe, it, expect } from 'vitest'
import { createBatches, processAnswers, calculateFollowUpLimit } from '../interview/qa'
import { verifyBeadsCoverage } from '../beads/coverage'
import { expandBeads } from '../beads/expand'
import type { InterviewQuestion } from '../interview/types'
import type { Bead, BeadSubset } from '../beads/types'

describe('Interview Q&A', () => {
  const questions: InterviewQuestion[] = [
    { id: 'q1', phase: 'scope', question: 'What scope?', priority: 'critical', rationale: 'test' },
    { id: 'q2', phase: 'scope', question: 'What edge cases?', priority: 'high', rationale: 'test' },
    { id: 'q3', phase: 'ux', question: 'What UX?', priority: 'medium', rationale: 'test' },
    { id: 'q4', phase: 'ux', question: 'What flow?', priority: 'low', rationale: 'test' },
    { id: 'q5', phase: 'tech', question: 'What tech?', priority: 'medium', rationale: 'test' },
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

describe('Beads Coverage', () => {
  const validBead: Bead = {
    id: 'b1', title: 'Bead 1', prdRefs: ['e1'], description: 'desc',
    contextGuidance: { patterns: ['Reuse the existing bead planning flow.'], anti_patterns: ['Do not invent extra runtime state.'] },
    acceptanceCriteria: ['ac1'], tests: ['test1'],
    testCommands: ['npm test'], priority: 1, status: 'pending',
    issueType: 'task', externalRef: '',
    labels: [], dependencies: { blocked_by: [], blocks: [] }, targetFiles: [], notes: '',
    iteration: 1, createdAt: '', updatedAt: '', completedAt: '', startedAt: '', beadStartCommit: null,
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
    const bead = { ...validBead, dependencies: { blocked_by: ['b1'], blocks: [] } }
    const result = verifyBeadsCoverage([bead], 'prd')
    expect(result.passed).toBe(false)
    expect(result.gaps.some(g => g.includes('self-dependency'))).toBe(true)
  })

  it('detects dangling dependencies', () => {
    const bead = { ...validBead, dependencies: { blocked_by: ['nonexistent'], blocks: [] } }
    const result = verifyBeadsCoverage([bead], 'prd')
    expect(result.passed).toBe(false)
    expect(result.gaps.some(g => g.includes('non-existent'))).toBe(true)
  })

  it('detects circular dependencies', () => {
    const b1: Bead = { ...validBead, id: 'b1', dependencies: { blocked_by: ['b2'], blocks: [] } }
    const b2: Bead = { ...validBead, id: 'b2', dependencies: { blocked_by: ['b1'], blocks: [] } }
    const result = verifyBeadsCoverage([b1, b2], 'prd')
    expect(result.passed).toBe(false)
    expect(result.gaps.some(g => g.includes('Circular'))).toBe(true)
  })
})

describe('Beads Expansion', () => {
  it('expands subset beads to full fields', () => {
    const subsets: BeadSubset[] = [
      { id: 'b1', title: 'T1', prdRefs: [], description: 'd',
        contextGuidance: { patterns: ['Keep the draft aligned with PRD refs.'], anti_patterns: ['Do not drop later beads when output is long.'] },
        acceptanceCriteria: ['ac'], tests: ['t'], testCommands: ['cmd'] },
    ]
    const expanded = expandBeads(subsets)
    expect(expanded.length).toBe(1)
    expect(expanded[0]!.priority).toBe(1)
    expect(expanded[0]!.status).toBe('pending')
    expect(expanded[0]!.iteration).toBe(1)
    expect(expanded[0]!.beadStartCommit).toBeNull()
  })
})
