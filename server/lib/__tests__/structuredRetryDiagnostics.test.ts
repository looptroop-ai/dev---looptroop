import jsYaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { buildStructuredRetryDiagnostic } from '../structuredRetryDiagnostics'

describe.concurrent('structured retry diagnostics', () => {
  it('captures yaml parse location and excerpt from parser errors', () => {
    const rawResponse = [
      'questions:',
      '  - id: Q01',
      '    question: "Broken quote',
      '  - id: Q02',
      '    question: "Next question"',
    ].join('\n')

    let parseError: unknown
    try {
      jsYaml.load(rawResponse)
    } catch (error) {
      parseError = error
    }

    const diagnostic = buildStructuredRetryDiagnostic({
      attempt: 1,
      rawResponse,
      validationError: parseError instanceof Error ? parseError.message : 'parse failed',
      error: parseError,
    })

    expect(diagnostic.line).toBeGreaterThan(0)
    expect(diagnostic.column).toBeGreaterThan(0)
    expect(diagnostic.excerpt).toContain('Broken quote')
  })

  it('infers semantic targets and extracts a focused excerpt', () => {
    const rawResponse = [
      'questions:',
      '  - id: Q01',
      '    question: "Foundation question"',
      '  - id: Q03',
      '    question: "Assembly question"',
    ].join('\n')

    const diagnostic = buildStructuredRetryDiagnostic({
      attempt: 1,
      rawResponse,
      validationError: 'Resolved interview left skipped question unanswered: Q03',
    })

    expect(diagnostic.target).toBe('Question Q03')
    expect(diagnostic.excerpt).toContain('Q03')
    expect(diagnostic.excerpt).toContain('Assembly question')
  })

  it('recognizes FU targets instead of falling back to the top of the artifact', () => {
    const rawResponse = [
      'questions:',
      '  - id: Q01',
      '    question: "Foundation question"',
      '  - id: Q02',
      '    question: "Another compiled question"',
      '  - id: Q03',
      '    question: "A third compiled question"',
      'follow_up_rounds:',
      '  - round_number: 1',
      '    question_ids: ["FU1"]',
      '  - id: FU1',
      '    question: "Explain what happens when the follow-up is not applicable"',
    ].join('\n')

    const diagnostic = buildStructuredRetryDiagnostic({
      attempt: 1,
      rawResponse,
      validationError: 'Resolved interview left skipped question unanswered: FU1',
    })

    expect(diagnostic.target).toBe('Question FU1')
    expect(diagnostic.excerpt).toContain('FU1')
    expect(diagnostic.excerpt).toContain('not applicable')
    expect(diagnostic.excerpt).not.toContain('Foundation question')
  })

  it('recognizes QFF targets instead of falling back to the top of the artifact', () => {
    const rawResponse = [
      'questions:',
      '  - id: Q01',
      '    question: "Foundation question"',
      '  - id: Q02',
      '    question: "Another compiled question"',
      'summary:',
      '  goals: []',
      '  constraints: []',
      '  non_goals: []',
      '  final_free_form_answer: ""',
      '  - id: QFF1',
      '    question: "Anything else we should capture before drafting?"',
    ].join('\n')

    const diagnostic = buildStructuredRetryDiagnostic({
      attempt: 1,
      rawResponse,
      validationError: 'Resolved interview left skipped question unanswered: QFF1',
    })

    expect(diagnostic.target).toBe('Question QFF1')
    expect(diagnostic.excerpt).toContain('QFF1')
    expect(diagnostic.excerpt).toContain('Anything else we should capture before drafting?')
    expect(diagnostic.excerpt).not.toContain('Foundation question')
  })
})
