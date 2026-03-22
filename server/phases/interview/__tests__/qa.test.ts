import { describe, expect, it } from 'vitest'
import { MockOpenCodeAdapter } from '../../../opencode/adapter'
import { startInterviewSession } from '../qa'

class SequencedMockOpenCodeAdapter extends MockOpenCodeAdapter {
  private promptCounts = new Map<string, number>()

  override async promptSession(...args: Parameters<MockOpenCodeAdapter['promptSession']>) {
    const sessionId = args[0]
    const nextCount = (this.promptCounts.get(sessionId) ?? 0) + 1
    this.promptCounts.set(sessionId, nextCount)

    const queuedResponse = this.mockResponses.get(`${sessionId}#${nextCount}`)
    if (queuedResponse !== undefined) {
      this.mockResponses.set(sessionId, queuedResponse)
    }

    return await super.promptSession(...args)
  }
}

describe('PROM4 interview session parsing', () => {
  it('frames compiled questions as the working checklist in the initial PROM4 prompt', async () => {
    const adapter = new SequencedMockOpenCodeAdapter()
    adapter.mockResponses.set('mock-session-1', [
      '<INTERVIEW_BATCH>',
      'batch_number: 1',
      'progress:',
      '  current: 1',
      '  total: 4',
      'is_final_free_form: false',
      'ai_commentary: Start with the compiled foundation checklist.',
      'questions:',
      '  - id: Q01',
      '    question: What problem are we solving?',
      '    phase: Foundation',
      '    priority: critical',
      '    rationale: Establish the core goal.',
      '    answer_type: free_text',
      '</INTERVIEW_BATCH>',
    ].join('\n'))

    await startInterviewSession(
      adapter,
      '/tmp/test',
      'model-a',
      [
        'questions:',
        '  - id: Q01',
        '    phase: foundation',
        '    question: What problem are we solving?',
      ].join('\n'),
      {
        ticketId: 'T-1',
        title: 'Checklist framing',
        description: 'Ensure the compiled interview set stays foregrounded.',
        relevantFiles: '',
      },
      5,
      20,
    )

    const messages = adapter.messages.get('mock-session-1') ?? []
    const firstPrompt = messages.find((message) => message.role === 'user')?.content ?? ''

    expect(firstPrompt).toContain('## Compiled Questions (from council)')
    expect(firstPrompt).toContain('Treat the compiled questions above as your working interview checklist')
  })

  it('retries invalid structured output in the same session and returns the corrected batch', async () => {
    const adapter = new SequencedMockOpenCodeAdapter()
    adapter.mockResponses.set('mock-session-1#1', 'I will ask three useful questions next.')
    adapter.mockResponses.set('mock-session-1#2', [
      '<INTERVIEW_BATCH>',
      'batch_number: 1',
      'progress:',
      '  current: 2',
      '  total: 5',
      'is_final_free_form: false',
      'ai_commentary: Asking the foundation questions first.',
      'questions:',
      '  - id: Q01',
      '    question: What problem are we solving?',
      '    phase: Foundation',
      '    priority: critical',
      '    rationale: Establish the core goal.',
      '</INTERVIEW_BATCH>',
    ].join('\n'))

    const result = await startInterviewSession(
      adapter,
      '/tmp/test',
      'model-a',
      [
        'questions:',
        '  - id: Q01',
        '    phase: foundation',
        '    question: What problem are we solving?',
      ].join('\n'),
      {
        ticketId: 'T-1',
        title: 'Retry PROM4 parsing',
        description: 'Ensure malformed batch output is corrected before blocking.',
        relevantFiles: '',
      },
      5,
      20,
    )

    expect(result.sessionId).toBe('mock-session-1')
    expect(result.firstBatch).toMatchObject({
      batchNumber: 1,
      isComplete: false,
      progress: { current: 2, total: 5 },
      questions: [
        {
          id: 'Q01',
          question: 'What problem are we solving?',
          phase: 'Foundation',
          priority: 'critical',
        },
      ],
    })

    const messages = adapter.messages.get('mock-session-1') ?? []
    expect(messages.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(true)
  })
})
