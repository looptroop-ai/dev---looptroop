import { describe, expect, it } from 'vitest'
import { formatInterviewQuestionPreview, parseInterviewQuestions } from '../questions'

describe('parseInterviewQuestions', () => {
  it('parses wrapped question YAML for interview log previews', () => {
    const questions = parseInterviewQuestions([
      'questions:',
      '  - id: Q01',
      '    phase: Foundation',
      '    question: "What problem are we solving?"',
      '  - id: Q02',
      '    phase: Structure',
      '    question: "Which users should be supported first?"',
    ].join('\n'))

    expect(questions).toEqual([
      {
        id: 'Q01',
        phase: 'Foundation',
        question: 'What problem are we solving?',
      },
      {
        id: 'Q02',
        phase: 'Structure',
        question: 'Which users should be supported first?',
      },
    ])
  })

  it('accepts top-level arrays when explicitly allowed', () => {
    const questions = parseInterviewQuestions([
      '- id: Q01',
      '  phase: foundation',
      '  question: "What should happen first?"',
    ].join('\n'), { allowTopLevelArray: true })

    expect(questions).toEqual([
      {
        id: 'Q01',
        phase: 'foundation',
        question: 'What should happen first?',
      },
    ])
  })
})

describe('formatInterviewQuestionPreview', () => {
  it('formats a bounded multiline preview for the log viewer', () => {
    const preview = formatInterviewQuestionPreview('Questions received from openai/gpt-5-mini', [
      { id: 'Q01', phase: 'Foundation', question: 'What problem are we solving?' },
      { id: 'Q02', phase: 'Structure', question: 'Which users should be supported first?' },
      { id: 'Q03', phase: 'Assembly', question: 'How will success be verified?' },
      { id: 'Q04', phase: 'Assembly', question: 'What is explicitly out of scope?' },
    ])

    expect(preview).toBe([
      'Questions received from openai/gpt-5-mini (4 total):',
      '- [foundation] What problem are we solving?',
      '- [structure] Which users should be supported first?',
      '- [assembly] How will success be verified?',
      '... 1 more question',
    ].join('\n'))
  })

  it('still supports explicit truncation when requested', () => {
    const preview = formatInterviewQuestionPreview('Questions received from openai/gpt-5-mini', [
      { id: 'Q01', phase: 'Foundation', question: 'What problem are we solving?' },
      { id: 'Q02', phase: 'Structure', question: 'Which users should be supported first?' },
      { id: 'Q03', phase: 'Assembly', question: 'How will success be verified?' },
    ], 2)

    expect(preview).toBe([
      'Questions received from openai/gpt-5-mini (3 total):',
      '- [foundation] What problem are we solving?',
      '- [structure] Which users should be supported first?',
      '... 1 more question',
    ].join('\n'))
  })
})
