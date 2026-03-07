import { describe, it, expect } from 'vitest'
import { parseBatchResponse, calculateFollowUpLimit } from '../qa'

describe('parseBatchResponse', () => {
  it('should parse valid <INTERVIEW_BATCH> tags', () => {
    const response = `Some preamble text.
<INTERVIEW_BATCH>
batch_number: 1
progress:
  current: 3
  total: 20
is_final_free_form: false
ai_commentary: "Starting with foundational questions."
questions:
  - id: Q1
    question: What is the primary goal of this project?
    phase: Foundation
    priority: critical
    rationale: Establishes core purpose
  - id: Q2
    question: Who is the target audience?
    phase: Foundation
    priority: high
    rationale: Defines user base
</INTERVIEW_BATCH>
Some trailing text.`

    const result = parseBatchResponse(response)
    expect(result.isComplete).toBe(false)
    expect(result.batchNumber).toBe(1)
    expect(result.progress).toEqual({ current: 3, total: 20 })
    expect(result.isFinalFreeForm).toBe(false)
    expect(result.aiCommentary).toBe('Starting with foundational questions.')
    expect(result.questions).toHaveLength(2)
    expect(result.questions[0]!.id).toBe('Q1')
    expect(result.questions[0]!.question).toBe('What is the primary goal of this project?')
    expect(result.questions[0]!.phase).toBe('Foundation')
    expect(result.questions[0]!.priority).toBe('critical')
    expect(result.questions[1]!.id).toBe('Q2')
  })

  it('should parse <INTERVIEW_COMPLETE> tags as final output', () => {
    const response = `<INTERVIEW_COMPLETE>
schema_version: 1
ticket_id: TEST-1
questions:
  - id: Q1
    prompt: What is the goal?
    answer:
      free_text: "Build a dashboard"
</INTERVIEW_COMPLETE>`

    const result = parseBatchResponse(response)
    expect(result.isComplete).toBe(true)
    expect(result.questions).toHaveLength(0)
    expect(result.finalYaml).toContain('schema_version: 1')
    expect(result.finalYaml).toContain('Build a dashboard')
  })

  it('should handle final free-form batch', () => {
    const response = `<INTERVIEW_BATCH>
batch_number: 8
progress:
  current: 20
  total: 20
is_final_free_form: true
ai_commentary: "All questions covered. One final check."
questions:
  - id: FINAL
    question: "Anything else to add before PRD generation?"
    phase: Foundation
    priority: low
    rationale: Final opportunity for additions
</INTERVIEW_BATCH>`

    const result = parseBatchResponse(response)
    expect(result.isComplete).toBe(false)
    expect(result.isFinalFreeForm).toBe(true)
    expect(result.questions).toHaveLength(1)
    expect(result.questions[0]!.id).toBe('FINAL')
  })

  it('should fall back to raw YAML when no tags present', () => {
    const response = `batch_number: 2
progress:
  current: 6
  total: 15
questions:
  - id: Q4
    question: What database will you use?
    phase: Structure
    priority: high`

    const result = parseBatchResponse(response)
    expect(result.isComplete).toBe(false)
    expect(result.questions).toHaveLength(1)
    expect(result.questions[0]!.id).toBe('Q4')
    expect(result.batchNumber).toBe(2)
  })

  it('should detect final interview YAML without tags', () => {
    const response = `schema_version: 1
ticket_id: TEST-1
questions:
  - id: Q1
    prompt: Test
approval:
  approved_by: ""
  approved_at: ""`

    const result = parseBatchResponse(response)
    expect(result.isComplete).toBe(true)
    expect(result.finalYaml).toBeDefined()
  })

  it('should extract questions heuristically from unstructured text', () => {
    const response = `Here are some questions for you:

1. What framework do you want to use for the frontend?
2. How should the authentication work?
3. What are the performance requirements?`

    const result = parseBatchResponse(response)
    expect(result.questions.length).toBeGreaterThanOrEqual(3)
    expect(result.questions[0]!.question).toContain('framework')
  })

  it('should handle empty/garbage response', () => {
    const result = parseBatchResponse('no questions here, just some random text')
    expect(result.isComplete).toBe(true)
    expect(result.questions).toHaveLength(0)
    expect(result.finalYaml).toBeDefined()
  })
})

describe('calculateFollowUpLimit', () => {
  it('should return 20% of total (rounded down)', () => {
    expect(calculateFollowUpLimit(50)).toBe(10)
    expect(calculateFollowUpLimit(30)).toBe(6)
    expect(calculateFollowUpLimit(10)).toBe(2)
  })

  it('should return at least 1', () => {
    expect(calculateFollowUpLimit(1)).toBe(1)
    expect(calculateFollowUpLimit(0)).toBe(1)
    expect(calculateFollowUpLimit(3)).toBe(1)
  })
})
