import { describe, expect, it } from 'vitest'
import {
  buildCompiledInterviewArtifact,
  parseCompiledInterviewArtifact,
  requireCompiledInterviewArtifact,
} from '../compiled'

describe('compiled interview artifacts', () => {
  it('builds a validated normalized artifact from a PROM3 refinement output', () => {
    const winnerDraft = [
      'questions:',
      '  - id: Q01',
      '    phase: Foundation',
      '    question: "What problem are we solving?"',
      '  - id: Q02',
      '    phase: Structure',
      '    question: "What features are required?"',
    ].join('\n')

    const artifact = buildCompiledInterviewArtifact(
      'openai/gpt-5',
      [
        'questions:',
        '  - id: Q01',
        '    phase: Foundation',
        '    question: "What user problem are we solving?"',
        '  - id: Q03',
        '    phase: Structure',
        '    question: "Which features are required?"',
        'changes:',
        '  - type: modified',
        '    before:',
        '      id: Q01',
        '      phase: Foundation',
        '      question: "What problem are we solving?"',
        '    after:',
        '      id: Q01',
        '      phase: Foundation',
        '      question: "What user problem are we solving?"',
        '  - type: replaced',
        '    before:',
        '      id: Q02',
        '      phase: Structure',
        '      question: "What features are required?"',
        '    after:',
        '      id: Q03',
        '      phase: Structure',
        '      question: "Which features are required?"',
      ].join('\n'),
      winnerDraft,
      10,
    )

    expect(artifact.winnerId).toBe('openai/gpt-5')
    expect(artifact.questionCount).toBe(2)
    expect(artifact.refinedContent).toContain('questions:')
    expect(artifact.refinedContent).not.toContain('changes:')
    expect(artifact.questions.map(question => question.id)).toEqual(['Q01', 'Q03'])
    expect(artifact.questions.map(question => question.phase)).toEqual(['Foundation', 'Structure'])
    expect(artifact.changes.map((change) => change.type)).toEqual(['modified', 'replaced'])
  })

  it('builds a validated artifact when same-identity modified changes are omitted from PROM3 output', () => {
    const winnerDraft = [
      'questions:',
      '  - id: Q01',
      '    phase: Foundation',
      '    question: "What problem are we solving?"',
      '  - id: Q02',
      '    phase: Assembly',
      '    question: "How do we verify success?"',
    ].join('\n')

    const artifact = buildCompiledInterviewArtifact(
      'openai/gpt-5',
      [
        'questions:',
        '  - id: Q01',
        '    phase: Foundation',
        '    question: "What user problem are we solving?"',
        '  - id: Q02',
        '    phase: Assembly',
        '    question: "How should success be verified in practice?"',
        'changes:',
        '  - type: modified',
        '    before:',
        '      id: Q01',
        '      phase: Foundation',
        '      question: "What problem are we solving?"',
        '    after:',
        '      id: Q01',
        '      phase: Foundation',
        '      question: "What user problem are we solving?"',
      ].join('\n'),
      winnerDraft,
      10,
    )

    expect(artifact.questionCount).toBe(2)
    expect(artifact.questions.map(question => question.id)).toEqual(['Q01', 'Q02'])
    expect(artifact.changes).toEqual([
      {
        type: 'modified',
        before: {
          id: 'Q01',
          phase: 'Foundation',
          question: 'What problem are we solving?',
        },
        after: {
          id: 'Q01',
          phase: 'Foundation',
          question: 'What user problem are we solving?',
        },
        inspiration: null,
        attributionStatus: 'model_unattributed',
      },
      {
        type: 'modified',
        before: {
          id: 'Q02',
          phase: 'Assembly',
          question: 'How do we verify success?',
        },
        after: {
          id: 'Q02',
          phase: 'Assembly',
          question: 'How should success be verified in practice?',
        },
        inspiration: null,
        attributionStatus: 'synthesized_unattributed',
      },
    ])
  })

  it('fails hard when PROM3 refinement output does not satisfy the interview schema', () => {
    const winnerDraft = [
      'questions:',
      '  - id: Q01',
      '    phase: foundation',
      '    question: "One?"',
    ].join('\n')

    expect(() => buildCompiledInterviewArtifact(
      'openai/gpt-5',
      [
        'questions:',
        '  - id: Q01',
        '    phase: foundation',
        '    question: "One?"',
        'changes:',
        '  - type: added',
        '    before: null',
        '    after:',
        '      id: Q01',
        '      phase: foundation',
        '      question: "One?"',
      ].join('\n'),
      winnerDraft,
      10,
    )).toThrow('do not fully and exactly account')
  })

  it('defaults missing compiled changes to an empty array for legacy artifacts', () => {
    const parsed = parseCompiledInterviewArtifact(JSON.stringify({
      winnerId: 'openai/gpt-5',
      refinedContent: [
        'questions:',
        '  - id: Q01',
        '    phase: foundation',
        '    question: "One?"',
      ].join('\n'),
      questions: [{ id: 'Q01', phase: 'Foundation', question: 'One?' }],
      questionCount: 1,
    }))

    expect(parsed.changes).toEqual([])
  })

  it('rejects missing or empty compiled artifacts before PROM4 can start', () => {
    expect(() => requireCompiledInterviewArtifact(undefined)).toThrow('No validated compiled interview found')

    expect(() => parseCompiledInterviewArtifact(JSON.stringify({
      winnerId: 'openai/gpt-5',
      refinedContent: 'questions: []',
      questions: [],
      questionCount: 0,
      changes: [],
    }))).toThrow('invalid questionCount')
  })
})
