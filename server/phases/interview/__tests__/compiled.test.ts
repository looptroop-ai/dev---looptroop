import { describe, expect, it } from 'vitest'
import {
  buildCompiledInterviewArtifact,
  parseCompiledInterviewArtifact,
  requireCompiledInterviewArtifact,
} from '../compiled'

describe('compiled interview artifacts', () => {
  it('builds a validated normalized artifact from a PROM3 refinement output', () => {
    const artifact = buildCompiledInterviewArtifact(
      'openai/gpt-5',
      [
        'questions:',
        '  - id: Q01',
        '    phase: Foundation',
        '    question: "What problem are we solving?"',
        '  - id: Q02',
        '    phase: Structure',
        '    question: "What features are required?"',
        '  - id: Q03',
        '    phase: Assembly',
        '    question: "How should success be verified?"',
      ].join('\n'),
      10,
    )

    expect(artifact.winnerId).toBe('openai/gpt-5')
    expect(artifact.questionCount).toBe(3)
    expect(artifact.questions.map(question => question.id)).toEqual(['Q01', 'Q02', 'Q03'])
    expect(artifact.questions.map(question => question.phase)).toEqual(['Foundation', 'Structure', 'Assembly'])
  })

  it('fails hard when PROM3 refinement output does not satisfy the interview schema', () => {
    expect(() => buildCompiledInterviewArtifact(
      'openai/gpt-5',
      [
        'questions:',
        '  - id: Q01',
        '    phase: foundation',
        '    question: "One?"',
        '  - id: Q01',
        '    phase: structure',
        '    question: "Two?"',
      ].join('\n'),
      10,
    )).toThrow('Duplicate question id')
  })

  it('rejects missing or empty compiled artifacts before PROM4 can start', () => {
    expect(() => requireCompiledInterviewArtifact(undefined)).toThrow('No validated compiled interview found')

    expect(() => parseCompiledInterviewArtifact(JSON.stringify({
      winnerId: 'openai/gpt-5',
      refinedContent: 'questions: []',
      questions: [],
      questionCount: 0,
    }))).toThrow('invalid questionCount')
  })
})
