import { describe, expect, it } from 'vitest'
import { createInterviewSessionSnapshot } from '../../phases/interview/sessionState'
import { normalizeCoverageResultOutput } from '../../structuredOutput'
import {
  INTERVIEW_COVERAGE_FOLLOW_UP_VALIDATION_ERROR,
  resolveInterviewCoverageFollowUpResolution,
} from '../interviewCoverageFollowUps'

describe('resolveInterviewCoverageFollowUpResolution', () => {
  it('accepts string-based raw follow-up questions without retrying', () => {
    const snapshot = createInterviewSessionSnapshot({
      winnerId: 'openai/gpt-5-mini',
      compiledQuestions: [{ id: 'Q01', phase: 'Foundation', question: 'What problem are we solving?' }],
      maxInitialQuestions: 1,
    })

    const resolution = resolveInterviewCoverageFollowUpResolution({
      status: 'gaps',
      structuredFollowUps: [],
      rawResponse: [
        'status: gaps',
        'gaps:',
        '  - Missing workflow rollout detail',
        'follow_up_questions:',
        '  - Which workflow should consume the new context pack first?',
      ].join('\n'),
      snapshot,
      attempt: 0,
    })

    expect(resolution.shouldRetry).toBe(false)
    expect(resolution.validationError).toBeNull()
    expect(resolution.followUpQuestions).toHaveLength(1)
    expect(resolution.followUpQuestions[0]).toMatchObject({
      id: 'FU1',
      question: 'Which workflow should consume the new context pack first?',
      source: 'coverage_follow_up',
      roundNumber: 1,
    })
  })

  it('requests one retry for gaps without parseable follow-ups, then resolves valid structured retry output', () => {
    const snapshot = createInterviewSessionSnapshot({
      winnerId: 'openai/gpt-5-mini',
      compiledQuestions: [{ id: 'Q01', phase: 'Foundation', question: 'What problem are we solving?' }],
      maxInitialQuestions: 1,
    })

    const first = resolveInterviewCoverageFollowUpResolution({
      status: 'gaps',
      structuredFollowUps: [],
      rawResponse: [
        'status: gaps',
        'gaps:',
        '  - Missing workflow rollout detail',
        'follow_up_questions: []',
      ].join('\n'),
      snapshot,
      attempt: 0,
    })

    expect(first.shouldRetry).toBe(true)
    expect(first.validationError).toBe(INTERVIEW_COVERAGE_FOLLOW_UP_VALIDATION_ERROR)
    expect(first.followUpQuestions).toEqual([])

    const retriedResponse = [
      'status: gaps',
      'gaps:',
      '  - Missing workflow rollout detail',
      'follow_up_questions:',
      '  - id: FU7',
      '    question: Which workflow should consume the new context pack first?',
      '    phase: Structure',
      '    priority: high',
      '    rationale: Lock rollout scope before PRD generation.',
    ].join('\n')
    const normalizedRetry = normalizeCoverageResultOutput(retriedResponse)
    expect(normalizedRetry.ok).toBe(true)
    if (!normalizedRetry.ok) return

    const second = resolveInterviewCoverageFollowUpResolution({
      status: normalizedRetry.value.status,
      structuredFollowUps: normalizedRetry.value.followUpQuestions,
      rawResponse: retriedResponse,
      snapshot,
      attempt: 1,
    })

    expect(second.shouldRetry).toBe(false)
    expect(second.validationError).toBeNull()
    expect(second.followUpQuestions).toHaveLength(1)
    expect(second.followUpQuestions[0]).toMatchObject({
      id: 'FU7',
      question: 'Which workflow should consume the new context pack first?',
      source: 'coverage_follow_up',
      roundNumber: 1,
    })
  })

  it('fails loudly after the retry if interview gaps still have no parseable follow-ups', () => {
    const snapshot = createInterviewSessionSnapshot({
      winnerId: 'openai/gpt-5-mini',
      compiledQuestions: [{ id: 'Q01', phase: 'Foundation', question: 'What problem are we solving?' }],
      maxInitialQuestions: 1,
    })

    const resolution = resolveInterviewCoverageFollowUpResolution({
      status: 'gaps',
      structuredFollowUps: [],
      rawResponse: [
        'status: gaps',
        'gaps:',
        '  - Missing workflow rollout detail',
        'follow_up_questions: []',
      ].join('\n'),
      snapshot,
      attempt: 1,
    })

    expect(resolution.shouldRetry).toBe(false)
    expect(resolution.validationError).toBe(INTERVIEW_COVERAGE_FOLLOW_UP_VALIDATION_ERROR)
    expect(resolution.followUpQuestions).toEqual([])
  })
})
