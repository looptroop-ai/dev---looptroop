import { describe, expect, it } from 'vitest'
import { MockOpenCodeAdapter } from '../../opencode/adapter'
import type { CouncilMember, DraftResult } from '../types'
import { VOTING_RUBRIC_BEADS, VOTING_RUBRIC_INTERVIEW, VOTING_RUBRIC_PRD } from '../types'
import { conductVoting } from '../voter'

describe('conductVoting', () => {
  const cases = [
    { phase: 'interview_draft', rubric: VOTING_RUBRIC_INTERVIEW },
    { phase: 'prd_draft', rubric: VOTING_RUBRIC_PRD },
    { phase: 'beads_draft', rubric: VOTING_RUBRIC_BEADS },
  ] as const

  function buildStrictScorecardResponse(categories: string[]) {
    const scoresA = [18, 17, 16, 15, 18]
    const scoresB = [14, 15, 14, 16, 13]
    const renderDraft = (label: string, scores: number[]) => [
      `  ${label}:`,
      ...categories.map((category, index) => `    ${category}: ${scores[index] ?? 15}`),
      `    total_score: ${categories.reduce((sum, _, index) => sum + (scores[index] ?? 15), 0)}`,
    ]

    return [
      'draft_scores:',
      ...renderDraft('Draft 1', scoresA),
      ...renderDraft('Draft 2', scoresB),
    ].join('\n')
  }

  it.each(cases)('accepts the strict YAML scorecard format for %s', async ({ phase, rubric }) => {
    const adapter = new MockOpenCodeAdapter()
    const voters: CouncilMember[] = [
      { modelId: 'model-a', name: 'Model A' },
    ]
    const drafts: DraftResult[] = [
      { memberId: 'draft-a', content: 'draft-a content', outcome: 'completed', duration: 1 },
      { memberId: 'draft-b', content: 'draft-b content', outcome: 'completed', duration: 1 },
    ]

    adapter.mockResponses.set('mock-session-1', buildStrictScorecardResponse(rubric.map(item => item.category)))

    const result = await conductVoting(
      adapter,
      voters,
      drafts,
      [{ type: 'text', content: 'vote prompt' }],
      '/tmp/test',
      phase,
    )

    expect(result.memberOutcomes).toEqual({ 'model-a': 'completed' })
    expect(result.votes).toHaveLength(2)
    expect(result.votes.map(vote => vote.totalScore).sort((a, b) => a - b)).toEqual([72, 84])
    expect(result.votes.every(vote => vote.scores.length === rubric.length)).toBe(true)
    expect(result.votes[0]?.scores.map(score => score.category)).toEqual(rubric.map(item => item.category))
  })

  it('retries invalid vote output once before marking the voter invalid', async () => {
    const adapter = new MockOpenCodeAdapter()
    const voters: CouncilMember[] = [
      { modelId: 'model-a', name: 'Model A' },
    ]
    const drafts: DraftResult[] = [
      { memberId: 'draft-a', content: 'draft-a content', outcome: 'completed', duration: 1 },
      { memberId: 'draft-b', content: 'draft-b content', outcome: 'completed', duration: 1 },
    ]

    adapter.mockResponses.set('mock-session-1', 'Draft 1:\nScore: 18/20')
    adapter.mockResponses.set('mock-session-2', buildStrictScorecardResponse(VOTING_RUBRIC_INTERVIEW.map(item => item.category)))

    const result = await conductVoting(
      adapter,
      voters,
      drafts,
      [{ type: 'text', content: 'vote prompt' }],
      '/tmp/test',
      'interview_draft',
    )

    expect(result.memberOutcomes).toEqual({ 'model-a': 'completed' })
    expect(result.votes).toHaveLength(2)
  })
})
