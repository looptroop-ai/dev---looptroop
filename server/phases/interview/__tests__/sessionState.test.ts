import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import jsYaml from 'js-yaml'
import {
  buildCanonicalInterviewYaml,
  buildCoverageFollowUpBatch,
  buildInterviewQuestionViews,
  buildPersistedBatch,
  clearInterviewSessionBatch,
  completeInterviewBySkippingRemaining,
  createInterviewSessionSnapshot,
  extractCoverageFollowUpQuestions,
  markInterviewSessionComplete,
  recordBatchAnswers,
  recordPreparedBatch,
} from '../sessionState'

describe('interview session state', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-12T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('builds canonical interview yaml from normalized answers instead of compiled drafts', () => {
    const base = createInterviewSessionSnapshot({
      winnerId: 'openai/gpt-5-mini',
      compiledQuestions: [
        { id: 'Q01', phase: 'Foundation', question: 'What are we trying to achieve?' },
        { id: 'Q02', phase: 'Structure', question: 'What constraints matter most?' },
      ],
      maxInitialQuestions: 2,
    })

    const firstBatch = buildPersistedBatch({
      questions: [
        { id: 'Q01', phase: 'Foundation', question: 'What are we trying to achieve?' },
        { id: 'Q02', phase: 'Structure', question: 'What constraints matter most?' },
      ],
      progress: { current: 1, total: 2 },
      isComplete: false,
      isFinalFreeForm: false,
      aiCommentary: 'Start with the two highest-signal questions.',
      batchNumber: 1,
    }, 'prom4', base)

    const withBatch = recordPreparedBatch(base, firstBatch)
    const answered = recordBatchAnswers(withBatch, {
      Q01: 'Stabilize interview persistence.',
      Q02: '',
    })
    const yaml = buildCanonicalInterviewYaml('1:T-100', answered)

    expect(yaml).toContain('ticket_id: 1:T-100')
    expect(yaml).toContain('winner_model: openai/gpt-5-mini')
    expect(yaml).toContain('free_text: Stabilize interview persistence.')
    expect(yaml).toContain('answered_by: user')
    expect(yaml).toContain('skipped: true')
    expect(yaml).toContain("source: compiled")
  })

  it('retains raw PROM4 final yaml as audit data while the normalized snapshot is canonical', () => {
    const base = createInterviewSessionSnapshot({
      winnerId: 'openai/gpt-5-mini',
      compiledQuestions: [{ id: 'Q01', phase: 'Foundation', question: 'What matters?' }],
      maxInitialQuestions: 1,
    })

    const completed = markInterviewSessionComplete(
      base,
      'questions:\n  - id: Q01\n    question: "Raw PROM4 final output"\n',
    )

    expect(completed.currentBatch).toBeNull()
    expect(completed.completedAt).toBe('2026-03-12T12:00:00.000Z')
    expect(completed.rawFinalYaml).toBe('questions:\n  - id: Q01\n    question: "Raw PROM4 final output"')
  })

  it('merges validated PROM4 summary data into canonical interview yaml', () => {
    const base = createInterviewSessionSnapshot({
      winnerId: 'openai/gpt-5-mini',
      compiledQuestions: [{ id: 'Q01', phase: 'Foundation', question: 'What matters?' }],
      maxInitialQuestions: 1,
    })

    const completed = markInterviewSessionComplete(
      base,
      [
        'schema_version: 1',
        'ticket_id: "1:T-100"',
        'artifact: interview',
        'status: draft',
        'generated_by:',
        '  winner_model: openai/gpt-5-mini',
        '  generated_at: "2026-03-12T12:00:00.000Z"',
        'questions:',
        '  - id: Q01',
        '    phase: Foundation',
        '    prompt: "What matters?"',
        'summary:',
        '  goals:',
        '    - Ship a reliable approval flow',
        '  constraints:',
        '    - Keep interview answers restart-safe',
        '  non_goals:',
        '    - Do not change PRD behavior',
        '  final_free_form_answer: "Double-check skipped answers before approval."',
        'approval:',
        '  approved_by: ""',
        '  approved_at: ""',
      ].join('\n'),
    )

    const yaml = buildCanonicalInterviewYaml('1:T-100', completed)
    const parsed = jsYaml.load(yaml) as {
      summary?: {
        goals?: string[]
        constraints?: string[]
        non_goals?: string[]
        final_free_form_answer?: string
      }
    }

    expect(parsed.summary).toEqual({
      goals: ['Ship a reliable approval flow'],
      constraints: ['Keep interview answers restart-safe'],
      non_goals: ['Do not change PRD behavior'],
      final_free_form_answer: 'Double-check skipped answers before approval.',
    })
  })

  it('queues parsed coverage follow-up questions back into the normalized interview session', () => {
    const base = createInterviewSessionSnapshot({
      winnerId: 'openai/gpt-5-mini',
      compiledQuestions: [{ id: 'Q01', phase: 'Foundation', question: 'What problem are we solving?' }],
      maxInitialQuestions: 1,
    })

    const withCoverageHistory = {
      ...base,
      followUpRounds: [{ roundNumber: 1, source: 'coverage' as const, questionIds: ['FU01'] }],
    }

    const followUpQuestions = extractCoverageFollowUpQuestions([
      'status: gaps_found',
      'follow_up_questions:',
      '  - id: FU02',
      '    phase: Assembly',
      '    question: "Which files are most likely to change?"',
      '    priority: high',
    ].join('\n'), withCoverageHistory)

    expect(followUpQuestions).toHaveLength(1)
    expect(followUpQuestions[0]).toMatchObject({
      id: 'FU02',
      source: 'coverage_follow_up',
      roundNumber: 2,
    })

    const batch = buildCoverageFollowUpBatch(withCoverageHistory, followUpQuestions, 'Coverage follow-up needed.')
    const updated = recordPreparedBatch(clearInterviewSessionBatch(withCoverageHistory), batch)
    const questionViews = buildInterviewQuestionViews(updated)

    expect(updated.currentBatch).toMatchObject({
      source: 'coverage',
      roundNumber: 2,
    })
    expect(updated.followUpRounds).toContainEqual({
      roundNumber: 2,
      source: 'coverage',
      questionIds: ['FU02'],
    })
    expect(questionViews.find((question) => question.id === 'FU02')).toMatchObject({
      status: 'current',
      source: 'coverage_follow_up',
    })
  })

  it('accepts string-based coverage follow-up questions with default metadata', () => {
    const snapshot = createInterviewSessionSnapshot({
      winnerId: 'openai/gpt-5-mini',
      compiledQuestions: [{ id: 'Q01', phase: 'Foundation', question: 'What problem are we solving?' }],
      maxInitialQuestions: 1,
    })

    const followUpQuestions = extractCoverageFollowUpQuestions([
      'status: gaps',
      'follow_up_questions:',
      '  - Which workflow should consume the new context pack first?',
    ].join('\n'), snapshot)

    expect(followUpQuestions).toHaveLength(1)
    expect(followUpQuestions[0]).toMatchObject({
      id: 'FU1',
      question: 'Which workflow should consume the new context pack first?',
      phase: 'Structure',
      priority: 'high',
      rationale: 'Coverage follow-up required to close interview gaps.',
      source: 'coverage_follow_up',
      roundNumber: 1,
    })
  })

  it('preserves existing answers and skips every remaining unanswered question when skipping to approval', () => {
    const base = createInterviewSessionSnapshot({
      winnerId: 'openai/gpt-5-mini',
      compiledQuestions: [
        { id: 'Q01', phase: 'Foundation', question: 'What outcome matters most?' },
        { id: 'Q02', phase: 'Structure', question: 'Which constraints are fixed?' },
        { id: 'Q03', phase: 'Assembly', question: 'How will retries be tested?' },
        { id: 'Q04', phase: 'Assembly', question: 'What retry budget is acceptable?' },
      ],
      maxInitialQuestions: 4,
    })

    const firstBatch = buildPersistedBatch({
      questions: [
        { id: 'Q01', phase: 'Foundation', question: 'What outcome matters most?' },
        { id: 'Q02', phase: 'Structure', question: 'Which constraints are fixed?' },
      ],
      progress: { current: 2, total: 4 },
      isComplete: false,
      isFinalFreeForm: false,
      aiCommentary: 'Foundation and structure first.',
      batchNumber: 1,
    }, 'prom4', base)

    const answered = recordBatchAnswers(
      recordPreparedBatch(base, firstBatch),
      {
        Q01: 'Keep imports idempotent.',
        Q02: '',
      },
    )

    const currentBatch = buildPersistedBatch({
      questions: [
        { id: 'Q03', phase: 'Assembly', question: 'How will retries be tested?' },
      ],
      progress: { current: 3, total: 4 },
      isComplete: false,
      isFinalFreeForm: false,
      aiCommentary: 'One implementation detail remains.',
      batchNumber: 2,
    }, 'prom4', answered)

    const activeSnapshot = recordPreparedBatch(answered, currentBatch)
    const completed = completeInterviewBySkippingRemaining(activeSnapshot, {
      Q03: 'Exercise retries against a flaky upstream fake.',
    })
    const yaml = buildCanonicalInterviewYaml('1:T-100', completed)

    expect(completed.completedAt).toBe('2026-03-12T12:00:00.000Z')
    expect(completed.currentBatch).toBeNull()
    expect(completed.answers.Q01).toMatchObject({
      answer: 'Keep imports idempotent.',
      skipped: false,
    })
    expect(completed.answers.Q02).toMatchObject({
      answer: '',
      skipped: true,
    })
    expect(completed.answers.Q03).toMatchObject({
      answer: 'Exercise retries against a flaky upstream fake.',
      skipped: false,
    })
    expect(completed.answers.Q04).toMatchObject({
      answer: '',
      skipped: true,
      batchNumber: 2,
    })
    expect(yaml).toContain('free_text: Exercise retries against a flaky upstream fake.')
    expect(yaml).toContain('prompt: What retry budget is acceptable?')
    expect(yaml).toContain('skipped: true')
  })
})
