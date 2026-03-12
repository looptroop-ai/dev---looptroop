import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildCanonicalInterviewYaml,
  buildCoverageFollowUpBatch,
  buildInterviewQuestionViews,
  buildPersistedBatch,
  clearInterviewSessionBatch,
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
      userBackground: 'Senior SRE',
      disableAnalogies: true,
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
})
