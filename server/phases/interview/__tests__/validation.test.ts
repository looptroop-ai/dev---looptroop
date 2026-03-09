import { describe, expect, it } from 'vitest'
import { validateInterviewDraft } from '../validation'

describe('validateInterviewDraft', () => {
  it('accepts valid PROM1 draft YAML', () => {
    const result = validateInterviewDraft([
      'questions:',
      '  - id: Q01',
      '    phase: Foundation',
      '    question: "What problem are we solving?"',
      '  - id: Q02',
      '    phase: Structure',
      '    question: "What features are required?"',
    ].join('\n'), 10)

    expect(result.questionCount).toBe(2)
  })

  it('accepts fenced YAML output', () => {
    const result = validateInterviewDraft([
      '```yaml',
      'questions:',
      '  - id: Q01',
      '    phase: foundation',
      '    question: "What should multiply do?"',
      '```',
    ].join('\n'), 10)

    expect(result.questionCount).toBe(1)
  })

  it('rejects malformed YAML', () => {
    expect(() => validateInterviewDraft('questions: [', 10)).toThrow('Invalid YAML')
  })

  it('rejects duplicate ids', () => {
    expect(() => validateInterviewDraft([
      'questions:',
      '  - id: Q01',
      '    phase: foundation',
      '    question: "One?"',
      '  - id: Q01',
      '    phase: structure',
      '    question: "Two?"',
    ].join('\n'), 10)).toThrow('Duplicate question id')
  })

  it('rejects phase-order regressions', () => {
    expect(() => validateInterviewDraft([
      'questions:',
      '  - id: Q01',
      '    phase: structure',
      '    question: "What features?"',
      '  - id: Q02',
      '    phase: foundation',
      '    question: "Why?"',
    ].join('\n'), 10)).toThrow('Question phase order regressed')
  })

  it('rejects question counts above the configured limit', () => {
    expect(() => validateInterviewDraft([
      'questions:',
      '  - id: Q01',
      '    phase: foundation',
      '    question: "One?"',
      '  - id: Q02',
      '    phase: structure',
      '    question: "Two?"',
    ].join('\n'), 1)).toThrow('exceeds max_initial_questions=1')
  })
})
