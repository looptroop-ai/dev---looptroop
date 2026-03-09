import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MockOpenCodeAdapter } from '../../opencode/adapter'
import { runCouncilPipeline } from '../pipeline'
import { generateDrafts } from '../drafter'
import { checkQuorum } from '../quorum'
import { selectWinner } from '../voter'
import type { CouncilMember, DraftResult, Vote } from '../types'
import type { PromptPart } from '../../opencode/types'
import { deliberateInterview } from '../../phases/interview/deliberate'

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

  it('calls contextBuilder for vote and refine steps', async () => {
    const contextBuilder = vi.fn(
      (step: 'vote' | 'refine', _drafts: DraftResult[]): PromptPart[] => {
        return [{ type: 'text' as const, content: `prompt-for-${step}` }]
      },
    )

    const result = await runCouncilPipeline(adapter, {
      phase: 'interview_draft',
      members,
      contextParts: [{ type: 'text', content: 'draft prompt' }],
      projectPath: '/tmp/test',
      contextBuilder,
    })

    expect(contextBuilder).toHaveBeenCalledTimes(2)
    expect(contextBuilder).toHaveBeenCalledWith('vote', expect.any(Array))
    expect(contextBuilder).toHaveBeenCalledWith('refine', expect.any(Array))
    expect(result.refinedContent).toBeTruthy()
  })

  it('uses default contextParts when no contextBuilder provided', async () => {
    const result = await runCouncilPipeline(adapter, {
      phase: 'interview_draft',
      members,
      contextParts: [{ type: 'text', content: 'draft prompt' }],
      projectPath: '/tmp/test',
    })

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

  it('emits draft progress events when sessions are created and finished', async () => {
    const progressEvents = vi.fn()

    const drafts = await generateDrafts(
      adapter,
      [members[0]!],
      [{ type: 'text', content: 'draft prompt' }],
      '/tmp/test',
      300000,
      undefined,
      undefined,
      undefined,
      progressEvents,
    )

    expect(drafts).toHaveLength(1)
    expect(progressEvents).toHaveBeenCalledWith(expect.objectContaining({
      memberId: 'model-a',
      status: 'session_created',
      sessionId: 'mock-session-1',
    }))
    expect(progressEvents).toHaveBeenCalledWith(expect.objectContaining({
      memberId: 'model-a',
      status: 'finished',
      sessionId: 'mock-session-1',
      outcome: 'completed',
    }))
  })

  it('marks invalid drafts when validator fails and preserves the raw response', async () => {
    adapter.mockResponses.set('mock-session-1', 'not valid yaml')

    const drafts = await generateDrafts(
      adapter,
      [members[0]!],
      [{ type: 'text', content: 'draft prompt' }],
      '/tmp/test',
      300000,
      undefined,
      undefined,
      undefined,
      undefined,
      () => {
        throw new Error('schema validation failed')
      },
    )

    expect(drafts[0]!.outcome).toBe('invalid_output')
    expect(drafts[0]!.content).toBe('not valid yaml')
    expect(drafts[0]!.error).toBe('schema validation failed')
  })

  it('respects configured draft timeouts', async () => {
    class SlowAdapter extends MockOpenCodeAdapter {
      override async promptSession(sessionId: string, parts: PromptPart[]): Promise<string> {
        await new Promise(resolve => setTimeout(resolve, 30))
        return super.promptSession(sessionId, parts)
      }
    }

    const slowAdapter = new SlowAdapter()
    const drafts = await generateDrafts(
      slowAdapter,
      [members[0]!],
      [{ type: 'text', content: 'draft prompt' }],
      '/tmp/test',
      5,
    )

    expect(drafts[0]!.outcome).toBe('timed_out')
  })

  it('deliberateInterview proceeds when validated drafts still meet quorum', async () => {
    adapter.mockResponses.set('mock-session-1', 'not valid yaml')
    adapter.mockResponses.set('mock-session-2', [
      'questions:',
      '  - id: Q01',
      '    phase: foundation',
      '    question: "What is the goal?"',
    ].join('\n'))
    adapter.mockResponses.set('mock-session-3', [
      'questions:',
      '  - id: Q01',
      '    phase: foundation',
      '    question: "Who is the user?"',
    ].join('\n'))

    const result = await deliberateInterview(
      adapter,
      members,
      [
        { type: 'text', source: 'ticket_details', content: '# Ticket: Test\nNeed a change' },
        { type: 'text', source: 'codebase_map', content: 'files:\n  - "src/main.ts"' },
      ],
      '/tmp/test',
      { draftTimeoutMs: 300000, minQuorum: 2, maxInitialQuestions: 10 },
    )

    expect(result.drafts.filter(d => d.outcome === 'completed')).toHaveLength(2)
    expect(result.drafts.find(d => d.memberId === 'model-a')?.outcome).toBe('invalid_output')
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
      { memberId: 'b', content: '', outcome: 'timed_out', duration: 100, error: 'Timeout' },
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

  it('excludes invalid_output drafts from quorum', () => {
    const drafts: DraftResult[] = [
      { memberId: 'a', content: 'questions: []', outcome: 'completed', duration: 100 },
      { memberId: 'b', content: 'invalid', outcome: 'invalid_output', duration: 100, error: 'schema validation failed' },
    ]
    expect(checkQuorum(drafts, 2).passed).toBe(false)
    expect(checkQuorum(drafts, 2).message).toContain('schema validation failed')
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
