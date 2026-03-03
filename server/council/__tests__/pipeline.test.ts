import { describe, it, expect, beforeEach } from 'vitest'
import { MockOpenCodeAdapter } from '../../opencode/adapter'
import { runCouncilPipeline } from '../pipeline'
import { checkQuorum } from '../quorum'
import { selectWinner } from '../voter'
import type { CouncilMember, DraftResult, Vote } from '../types'

describe('Council Pipeline', () => {
  let adapter: MockOpenCodeAdapter
  const members: CouncilMember[] = [
    { modelId: 'model-a', name: 'Model A' },
    { modelId: 'model-b', name: 'Model B' },
    { modelId: 'model-c', name: 'Model C' },
  ]

  beforeEach(() => {
    adapter = new MockOpenCodeAdapter()
  })

  it('runs full council pipeline with mock adapter', async () => {
    const result = await runCouncilPipeline(adapter, {
      phase: 'interview_draft',
      members,
      contextParts: [{ type: 'text', content: 'Generate interview questions' }],
      projectPath: '/tmp/test',
    })

    expect(result.phase).toBe('interview_draft')
    expect(result.drafts.length).toBe(3)
    expect(result.winnerId).toBeTruthy()
    expect(result.refinedContent).toBeTruthy()
  })

  it('tracks member outcomes', async () => {
    const result = await runCouncilPipeline(adapter, {
      phase: 'test',
      members,
      contextParts: [{ type: 'text', content: 'test' }],
      projectPath: '/tmp/test',
    })

    expect(Object.keys(result.memberOutcomes).length).toBe(3)
    for (const outcome of Object.values(result.memberOutcomes)) {
      expect(outcome).toBe('completed')
    }
  })
})

describe('Quorum', () => {
  it('passes when enough valid drafts', () => {
    const drafts: DraftResult[] = [
      { memberId: 'a', content: 'draft', outcome: 'completed', duration: 100 },
      { memberId: 'b', content: 'draft', outcome: 'completed', duration: 100 },
    ]
    expect(checkQuorum(drafts, 2).passed).toBe(true)
  })

  it('fails when not enough valid drafts', () => {
    const drafts: DraftResult[] = [
      { memberId: 'a', content: 'draft', outcome: 'completed', duration: 100 },
      { memberId: 'b', content: '', outcome: 'timed_out', duration: 100 },
    ]
    expect(checkQuorum(drafts, 2).passed).toBe(false)
  })

  it('only counts completed drafts with content', () => {
    const drafts: DraftResult[] = [
      { memberId: 'a', content: '', outcome: 'completed', duration: 100 },
      { memberId: 'b', content: 'draft', outcome: 'completed', duration: 100 },
    ]
    expect(checkQuorum(drafts, 2).passed).toBe(false)
  })
})

describe('Winner Selection', () => {
  const members: CouncilMember[] = [
    { modelId: 'mai', name: 'MAI' },
    { modelId: 'other', name: 'Other' },
  ]

  it('selects highest scoring draft', () => {
    const votes: Vote[] = [
      { voterId: 'mai', draftId: 'other', scores: [], totalScore: 90 },
      { voterId: 'other', draftId: 'mai', scores: [], totalScore: 80 },
    ]
    expect(selectWinner(votes, members).winnerId).toBe('other')
  })

  it('MAI wins ties', () => {
    const votes: Vote[] = [
      { voterId: 'mai', draftId: 'other', scores: [], totalScore: 80 },
      { voterId: 'other', draftId: 'mai', scores: [], totalScore: 80 },
    ]
    expect(selectWinner(votes, members).winnerId).toBe('mai')
  })
})
