import { describe, expect, it } from 'vitest'
import { validateInterviewDraft } from '../validation'

describe.concurrent('validateInterviewDraft', () => {
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

  it('accepts repaired yaml-like output when one question block is partially malformed', () => {
    const result = validateInterviewDraft([
      '[MODEL] ```yaml',
      'questions:',
      '  - id: Q20',
      '    phase: structure',
      '    question: "Do you want to optimize the startup and shutdown scripts for the cluster?"',
      '  - id: Q21',
      '    phase: structure',
      '    question: "Should resource requests/limits be tuned for better cluster id: Q22',
      '    phase: efficiency?"',
      '  - assembly',
      '    question: "For Ansible playbook optimization, should we implement parallel execution, caching, or skip unchanged tasks?"',
      '  - id: Q23',
      '    phase: assembly',
      '    question: "What is the acceptable trade-off between optimization speed and playbook idempotency/reliability?"',
      '```',
      '[SYS] Step finished: stop',
    ].join('\n'), 50)

    expect(result.questionCount).toBe(4)
  })

  it('rejects malformed YAML', () => {
    expect(() => validateInterviewDraft('questions: [', 10)).toThrow('Invalid YAML')
  })

  it('auto-repairs duplicate ids by renumbering', () => {
    const result = validateInterviewDraft([
      'questions:',
      '  - id: Q01',
      '    phase: foundation',
      '    question: "One?"',
      '  - id: Q01',
      '    phase: structure',
      '    question: "Two?"',
    ].join('\n'), 10)

    expect(result.questionCount).toBe(2)
    expect(result.questions[0]!.id).toBe('Q01')
    expect(result.questions[1]!.id).toBe('Q02')
    expect(result.repairWarnings).toHaveLength(1)
    expect(result.repairWarnings[0]).toContain('Renumbered duplicate question id')
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
