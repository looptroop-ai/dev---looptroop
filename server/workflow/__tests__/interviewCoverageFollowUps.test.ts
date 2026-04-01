import { describe, expect, it } from 'vitest'
import { createInterviewSessionSnapshot } from '../../phases/interview/sessionState'
import { normalizeCoverageResultOutput } from '../../structuredOutput'
import {
  INTERVIEW_COVERAGE_FOLLOW_UP_BUDGET_ERROR,
  INTERVIEW_COVERAGE_FOLLOW_UP_VALIDATION_ERROR,
  resolveInterviewCoverageFollowUpResolution,
} from '../interviewCoverageFollowUps'

describe.concurrent('resolveInterviewCoverageFollowUpResolution', () => {
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
    expect(resolution.budget).toMatchObject({ total: 1, used: 0, remaining: 1 })
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
    expect(first.budget).toMatchObject({ total: 1, used: 0, remaining: 1 })

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

  it('repairs malformed coverage gap scalars before the semantic follow-up retry decision', () => {
    const snapshot = createInterviewSessionSnapshot({
      winnerId: 'openai/gpt-5-mini',
      compiledQuestions: [{ id: 'Q01', phase: 'Foundation', question: 'What problem are we solving?' }],
      maxInitialQuestions: 1,
    })

    const response = [
      'status: gaps',
      'gaps:',
      '  - `repo_git_mutex` behavior is undefined and must be clarified.',
      'follow_up_questions: []',
    ].join('\n')
    const normalized = normalizeCoverageResultOutput(response)
    expect(normalized.ok).toBe(true)
    if (!normalized.ok) return
    expect(normalized.repairApplied).toBe(true)
    expect(normalized.value.gaps).toEqual([
      '`repo_git_mutex` behavior is undefined and must be clarified.',
    ])

    const resolution = resolveInterviewCoverageFollowUpResolution({
      status: normalized.value.status,
      structuredFollowUps: normalized.value.followUpQuestions,
      rawResponse: response,
      snapshot,
      attempt: 0,
    })

    expect(resolution.shouldRetry).toBe(true)
    expect(resolution.validationError).toBe(INTERVIEW_COVERAGE_FOLLOW_UP_VALIDATION_ERROR)
    expect(resolution.followUpQuestions).toEqual([])
  })

  it('stops retrying after the semantic repair attempt if interview gaps still have no parseable follow-ups', () => {
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

  it('truncates follow-up questions that exceed the remaining coverage budget instead of retrying', () => {
    const snapshot = createInterviewSessionSnapshot({
      winnerId: 'openai/gpt-5-mini',
      compiledQuestions: Array.from({ length: 10 }, (_, index) => ({
        id: `Q${String(index + 1).padStart(2, '0')}`,
        phase: 'Foundation',
        question: `Question ${index + 1}?`,
      })),
      maxInitialQuestions: 10,
    })
    snapshot.followUpRounds.push({
      roundNumber: 1,
      source: 'coverage',
      questionIds: ['FU01'],
    })

    const response = [
      'status: gaps',
      'gaps:',
      '  - Missing rollout details',
      'follow_up_questions:',
      '  - id: FU02',
      '    question: Which workflow should consume the new context pack first?',
      '    phase: Structure',
      '    priority: high',
      '    rationale: Lock rollout scope before PRD generation.',
      '  - id: FU03',
      '    question: Which fallback should be used if parsing fails?',
      '    phase: Assembly',
      '    priority: high',
      '    rationale: Close the remaining ambiguity before PRD generation.',
    ].join('\n')
    const normalized = normalizeCoverageResultOutput(response)
    expect(normalized.ok).toBe(true)
    if (!normalized.ok) return

    const first = resolveInterviewCoverageFollowUpResolution({
      status: normalized.value.status,
      structuredFollowUps: normalized.value.followUpQuestions,
      rawResponse: response,
      snapshot,
      attempt: 0,
    })

    expect(first.shouldRetry).toBe(false)
    expect(first.followUpQuestions).toHaveLength(1)
    expect(first.followUpQuestions[0]).toMatchObject({ id: 'FU02' })
    expect(first.validationError).toContain(INTERVIEW_COVERAGE_FOLLOW_UP_BUDGET_ERROR)
    expect(first.repairWarnings).toEqual([
      'Coverage follow-up questions exceeded the remaining budget and were truncated to 1.',
    ])
    expect(first.budget).toMatchObject({ total: 2, used: 1, remaining: 1 })
  })

  it('accepts gaps with no follow-up questions when the remaining coverage budget is zero', () => {
    const snapshot = createInterviewSessionSnapshot({
      winnerId: 'openai/gpt-5-mini',
      compiledQuestions: Array.from({ length: 10 }, (_, index) => ({
        id: `Q${String(index + 1).padStart(2, '0')}`,
        phase: 'Foundation',
        question: `Question ${index + 1}?`,
      })),
      maxInitialQuestions: 10,
    })
    snapshot.followUpRounds.push({
      roundNumber: 1,
      source: 'coverage',
      questionIds: ['FU01', 'FU02'],
    })

    const resolution = resolveInterviewCoverageFollowUpResolution({
      status: 'gaps',
      structuredFollowUps: [],
      rawResponse: [
        'status: gaps',
        'gaps:',
        '  - Missing rollout details',
        'follow_up_questions: []',
      ].join('\n'),
      snapshot,
      attempt: 1,
    })

    expect(resolution.shouldRetry).toBe(false)
    expect(resolution.validationError).toBeNull()
    expect(resolution.followUpQuestions).toEqual([])
    expect(resolution.budget).toMatchObject({ total: 2, used: 2, remaining: 0 })
  })
})
