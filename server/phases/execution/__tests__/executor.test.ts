import { describe, expect, it } from 'vitest'
import { MockOpenCodeAdapter } from '../../../opencode/adapter'
import { executeBead } from '../executor'
import type { Bead } from '../../beads/types'

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

function buildBead(): Bead {
  return {
    id: 'bead-1',
    title: 'Normalize structured outputs',
    prdRefs: ['EPIC-1 / US-1'],
    description: 'Repair machine-readable marker mistakes before failing.',
    contextGuidance: { patterns: ['Keep the retry limited to marker correction only.'], anti_patterns: ['Do not retry for non-marker issues.'] },
    acceptanceCriteria: ['Repairable marker formatting does not fail the iteration immediately.'],
    tests: ['Structured marker retry is covered by tests.'],
    testCommands: ['npm run test:server'],
    priority: 1,
    status: 'pending',
    issueType: 'task',
    externalRef: '',
    labels: [],
    dependencies: { blocked_by: [], blocks: [] },
    targetFiles: [],
    notes: '',
    iteration: 1,
    createdAt: '',
    updatedAt: '',
    completedAt: '',
    startedAt: '',
    beadStartCommit: null,
  }
}

describe('executeBead', () => {
  it('retries malformed completion markers in the same session', async () => {
    const adapter = new SequencedMockOpenCodeAdapter()
    adapter.mockResponses.set('mock-session-1#1', 'Implemented the bead and ran the checks successfully.')
    adapter.mockResponses.set('mock-session-1#2', [
      '<BEAD_STATUS>',
      '```yaml',
      'beadStatus:',
      '  beadId: bead-1',
      '  status: completed',
      '  gates:',
      '    test: pass',
      '    lint: pass',
      '    type_check: pass',
      '    qualitative_review: pass',
      '```',
      '</BEAD_STATUS>',
    ].join('\n'))
    adapter.mockResponses.set('mock-session-1#3', [
      '<BEAD_STATUS>',
      '{"bead_id":"bead-1","status":"done","checks":{"tests":"pass","lint":"pass","typecheck":"pass","qualitative":"pass"}}',
      '</BEAD_STATUS>',
    ].join('\n'))

    const result = await executeBead(
      adapter,
      buildBead(),
      [{ type: 'text', content: 'Bead context' }],
      '/tmp/test',
      1,
    )

    expect(result.success).toBe(true)
    expect(result.iteration).toBe(1)
    expect(result.output).toContain('<BEAD_STATUS>')

    const messages = adapter.messages.get('mock-session-1') ?? []
    expect(messages.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(true)
  })

  it('uses PROM_CODING template for prompt construction', async () => {
    const adapter = new SequencedMockOpenCodeAdapter()
    adapter.mockResponses.set('mock-session-1#1', [
      '<BEAD_STATUS>',
      '{"bead_id":"bead-1","status":"done","checks":{"tests":"pass","lint":"pass","typecheck":"pass","qualitative":"pass"}}',
      '</BEAD_STATUS>',
    ].join('\n'))

    const result = await executeBead(
      adapter,
      buildBead(),
      [{ type: 'text', content: 'Bead context' }],
      '/tmp/test',
      1,
    )

    expect(result.success).toBe(true)
    // Check the prompt included PROM_CODING template elements
    const messages = adapter.messages.get('mock-session-1') ?? []
    const firstPrompt = messages[0]?.content
    expect(typeof firstPrompt).toBe('string')
    expect(firstPrompt).toContain('BEAD_STATUS')
    expect(firstPrompt).toContain('System Role')
    expect(firstPrompt).toContain('quality gates')
  })

  it('continues the same session when the model reports status:error before eventually succeeding', async () => {
    const adapter = new SequencedMockOpenCodeAdapter()
    adapter.mockResponses.set('mock-session-1#1', [
      '<BEAD_STATUS>',
      '{"bead_id":"bead-1","status":"error","checks":{"tests":"pass","lint":"pass","typecheck":"pass","qualitative":"pass"},"reason":"lint still failing"}',
      '</BEAD_STATUS>',
    ].join('\n'))
    adapter.mockResponses.set('mock-session-1#2', [
      '<BEAD_STATUS>',
      '{"bead_id":"bead-1","status":"done","checks":{"tests":"pass","lint":"pass","typecheck":"pass","qualitative":"pass"}}',
      '</BEAD_STATUS>',
    ].join('\n'))

    const result = await executeBead(
      adapter,
      buildBead(),
      [{ type: 'text', content: 'Bead context' }],
      '/tmp/test',
      1,
    )

    expect(result.success).toBe(true)
    const messages = adapter.messages.get('mock-session-1') ?? []
    expect(messages.some((message) => typeof message.content === 'string' && message.content.includes('Continue Bead Execution'))).toBe(true)
    expect(messages.some((message) => typeof message.content === 'string' && message.content.includes('Do not reply with a plain-text progress update or plan'))).toBe(true)
  })

  it('calls onContextWipe when iteration fails and PROM51 generates notes', async () => {
    const adapter = new SequencedMockOpenCodeAdapter()
    adapter.mockResponses.set('mock-session-1#1', [
      '<BEAD_STATUS>',
      '{"bead_id":"bead-1","status":"error","checks":{"tests":"pass","lint":"pass","typecheck":"pass","qualitative":"pass"},"reason":"tests still failing"}',
      '</BEAD_STATUS>',
    ].join('\n'))
    // PROM51 note generation session
    adapter.mockResponses.set('mock-session-2#1', 'Iteration 1 failed because: no completion marker output.')

    const notesUpdates: { beadId: string; notes: string }[] = []
    const result = await executeBead(
      adapter,
      buildBead(),
      [{ type: 'text', content: 'Bead context' }],
      '/tmp/test',
      1,
      1,
      undefined,
      {
        onContextWipe: async ({ beadId, notes }) => {
          notesUpdates.push({ beadId, notes })
        },
      },
    )

    expect(result.success).toBe(false)
    expect(notesUpdates).toHaveLength(1)
    expect(notesUpdates[0]!.beadId).toBe('bead-1')
    expect(notesUpdates[0]!.notes).toContain('failed')
  })

  it('restarts the bead iteration in a fresh session after an empty completion response', async () => {
    const adapter = new SequencedMockOpenCodeAdapter()
    adapter.mockResponses.set('mock-session-1#1', '')
    adapter.mockResponses.set('mock-session-2#1', [
      '<BEAD_STATUS>',
      'bead_id: bead-1',
      'status: completed',
      'checks:',
      '  tests: pass',
      '  lint: pass',
      '  typecheck: pass',
      '  qualitative: pass',
      '</BEAD_STATUS>',
    ].join('\n'))

    const result = await executeBead(
      adapter,
      buildBead(),
      [{ type: 'text', content: 'Bead context' }],
      '/tmp/test',
      1,
    )

    expect(result.success).toBe(true)
    expect(result.iteration).toBe(1)
    expect(adapter.sessions.map((session) => session.id)).toEqual(['mock-session-1', 'mock-session-2'])
    expect(adapter.messages.get('mock-session-1')?.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(false)
  })

  it('rebuilds bead context for the next iteration after PROM51 notes are appended', async () => {
    const adapter = new SequencedMockOpenCodeAdapter()
    adapter.mockResponses.set('mock-session-1#1', [
      '<BEAD_STATUS>',
      '{"bead_id":"bead-1","status":"error","checks":{"tests":"pass","lint":"pass","typecheck":"pass","qualitative":"pass"},"reason":"missing final fix"}',
      '</BEAD_STATUS>',
    ].join('\n'))
    adapter.mockResponses.set('mock-session-2#1', 'Retry with the new note about the missing completion marker.')
    adapter.mockResponses.set('mock-session-3#1', [
      '<BEAD_STATUS>',
      '{"bead_id":"bead-1","status":"done","checks":{"tests":"pass","lint":"pass","typecheck":"pass","qualitative":"pass"}}',
      '</BEAD_STATUS>',
    ].join('\n'))

    const bead = buildBead()
    const contextSnapshots: string[] = []
    const result = await executeBead(
      adapter,
      bead,
      async () => {
        contextSnapshots.push(bead.notes)
        return [{ type: 'text', content: bead.notes ? `Bead context\n${bead.notes}` : 'Bead context' }]
      },
      '/tmp/test',
      2,
      1,
    )

    expect(result.success).toBe(true)
    expect(contextSnapshots).toHaveLength(2)
    expect(contextSnapshots[0]).toBe('')
    expect(contextSnapshots[1]).toContain('Retry with the new note')
  })
})
