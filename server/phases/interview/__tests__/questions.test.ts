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

  it('normalizes prompt/category aliases and ignores extra wrapper fields', () => {
    const questions = parseInterviewQuestions([
      'metadata:',
      '  model: big-pickle',
      'questions:',
      '  - id: Q01',
      '    category: Foundation',
      '    prompt: "What problem are we solving?"',
      '    rationale: "Need the core objective first."',
      '  - id: Q02',
      '    category: Structure',
      '    prompt: "Which user flows matter most?"',
      '    notes: "Optional internal note."',
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
        question: 'Which user flows matter most?',
      },
    ])
  })

  it('extracts the YAML payload when models wrap it in prose and fences', () => {
    const questions = parseInterviewQuestions([
      'Here is the proposed interview draft.',
      '',
      '```yaml',
      'questions:',
      '  - id: Q01',
      '    category: Foundation',
      '    prompt: "What problem are we solving?"',
      '```',
      '',
      'Let me know if you want refinements.',
    ].join('\n'))

    expect(questions).toEqual([
      {
        id: 'Q01',
        phase: 'Foundation',
        question: 'What problem are we solving?',
      },
    ])
  })
})

describe('formatInterviewQuestionPreview', () => {
  it('formats the full multiline preview for the log viewer by default', () => {
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
      '- [assembly] What is explicitly out of scope?',
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
