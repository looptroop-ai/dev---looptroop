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
})
