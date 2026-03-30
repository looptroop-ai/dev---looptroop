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
})
