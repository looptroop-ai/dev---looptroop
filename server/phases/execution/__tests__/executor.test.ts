import { afterAll, describe, expect, it, vi } from 'vitest'
import { MockOpenCodeAdapter } from '../../../opencode/adapter'
import { OPENCODE_EXECUTION_YOLO_PERMISSIONS } from '../../../opencode/permissions'
import { executeBead } from '../executor'
import type { Bead } from '../../beads/types'
import { PROFILE_DEFAULTS } from '../../../db/defaults'
import { patchTicket } from '../../../storage/tickets'
import { createInitializedTestTicket, createTestRepoManager, resetTestDb } from '../../../test/factories'
import { BEAD_RETRY_BUDGET_EXHAUSTED } from '../../../../shared/errorCodes'

class SequencedMockOpenCodeAdapter extends MockOpenCodeAdapter {
  private promptCounts = new Map<string, number>()
  public abortCalls: string[] = []
  public promptFailures = new Map<string, Error | 'stallUntilAbort'>()

  override async promptSession(...args: Parameters<MockOpenCodeAdapter['promptSession']>) {
    const sessionId = args[0]
    const nextCount = (this.promptCounts.get(sessionId) ?? 0) + 1
    this.promptCounts.set(sessionId, nextCount)

    const queuedFailure = this.promptFailures.get(`${sessionId}#${nextCount}`)
    if (queuedFailure) {
      this.promptFailures.delete(`${sessionId}#${nextCount}`)
      this.promptCalls.push({
        sessionId,
        parts: args[1],
        options: args[3],
      })
      if (queuedFailure === 'stallUntilAbort') {
        const activeSignal = args[3]?.signal ?? args[2]
        if (!activeSignal) {
          throw new Error(`Missing abort signal for stalled prompt ${sessionId}#${nextCount}`)
        }
        if (activeSignal.aborted) {
          const abortError = new Error('Aborted')
          abortError.name = 'AbortError'
          throw abortError
        }
        await new Promise<never>((_, reject) => {
          const onAbort = () => {
            const abortError = new Error('Aborted')
            abortError.name = 'AbortError'
            reject(abortError)
          }
          activeSignal.addEventListener('abort', onAbort, { once: true })
        })
      }
      throw queuedFailure
    }

    const queuedResponse = this.mockResponses.get(`${sessionId}#${nextCount}`)
    if (queuedResponse !== undefined) {
      this.mockResponses.set(sessionId, queuedResponse)
    }
    const queuedStreamEvents = this.mockStreamEvents.get(`${sessionId}#${nextCount}`)
    if (queuedStreamEvents !== undefined) {
      this.mockStreamEvents.set(sessionId, queuedStreamEvents)
    }
    const queuedAssistantInfo = this.mockAssistantInfos.get(`${sessionId}#${nextCount}`)
    if (queuedAssistantInfo !== undefined) {
      this.mockAssistantInfos.set(sessionId, queuedAssistantInfo)
    }

    return await super.promptSession(...args)
  }

  override async abortSession(sessionId: string): Promise<boolean> {
    this.abortCalls.push(sessionId)
    return await super.abortSession(sessionId)
  }
}

function buildBead(overrides: Partial<Bead> = {}): Bead {
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
    iteration: 0,
    createdAt: '',
    updatedAt: '',
    completedAt: '',
    startedAt: '',
    beadStartCommit: null,
    ...overrides,
  }
}

const repoManager = createTestRepoManager('execution-executor-')

describe('executeBead', () => {
  afterAll(() => {
    resetTestDb()
    repoManager.cleanup()
  })

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
    adapter.mockResponses.set('mock-session-1#2', 'Iteration 1 failed because: no completion marker output.')

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
    expect(adapter.sessions.map((session) => session.id)).toEqual(['mock-session-1'])
  })

  it('creates YOLO sessions for owned coding attempts', async () => {
    resetTestDb()
    const { ticket, paths } = createInitializedTestTicket(repoManager, {
      title: 'Owned coding session permissions',
    })
    patchTicket(ticket.id, { status: 'CODING' })

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
      paths.worktreePath,
      1,
      PROFILE_DEFAULTS.perIterationTimeout,
      undefined,
      {
        ticketId: ticket.id,
        model: 'model-a',
      },
    )

    expect(result.success).toBe(true)
    expect(adapter.sessionCreateCalls).toHaveLength(1)
    expect(adapter.sessionCreateCalls[0]?.options?.permission).toEqual(OPENCODE_EXECUTION_YOLO_PERMISSIONS)
  })

  it('recreates YOLO sessions on fresh owned coding retries', async () => {
    resetTestDb()
    const { ticket, paths } = createInitializedTestTicket(repoManager, {
      title: 'Owned coding session retries',
    })
    patchTicket(ticket.id, { status: 'CODING' })

    const adapter = new SequencedMockOpenCodeAdapter()
    adapter.mockResponses.set('mock-session-1#1', '')
    adapter.mockResponses.set('mock-session-2#1', [
      '<BEAD_STATUS>',
      '{"bead_id":"bead-1","status":"done","checks":{"tests":"pass","lint":"pass","typecheck":"pass","qualitative":"pass"}}',
      '</BEAD_STATUS>',
    ].join('\n'))

    const result = await executeBead(
      adapter,
      buildBead(),
      [{ type: 'text', content: 'Bead context' }],
      paths.worktreePath,
      1,
      PROFILE_DEFAULTS.perIterationTimeout,
      undefined,
      {
        ticketId: ticket.id,
        model: 'model-a',
      },
    )

    expect(result.success).toBe(true)
    expect(adapter.sessionCreateCalls).toHaveLength(2)
    expect(adapter.sessionCreateCalls.every((call) => (
      JSON.stringify(call.options?.permission) === JSON.stringify(OPENCODE_EXECUTION_YOLO_PERMISSIONS)
    ))).toBe(true)
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

  it('restarts the bead iteration in a fresh session after a provider session error', async () => {
    const adapter = new SequencedMockOpenCodeAdapter()
    adapter.mockResponses.set('mock-session-1#1', [
      '<BEAD_STATUS>',
      '{"bead_id":"bead-1","status":"done","checks":{"tests":"pass","lint":"pass","typecheck":"pass","qualitative":"pass"}}',
      '</BEAD_STATUS>',
    ].join('\n'))
    adapter.mockStreamEvents.set('mock-session-1#1', [{
      type: 'session_error',
      sessionId: 'mock-session-1',
      error: "Provider returned error: The last message cannot have role 'assistant'",
    }])
    adapter.mockResponses.set('mock-session-2#1', [
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
    adapter.mockResponses.set('mock-session-1#2', 'Retry with the new note about the missing completion marker.')
    adapter.mockResponses.set('mock-session-2#1', [
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

  it('starts a recovered bead on the next absolute iteration instead of resetting to 1', async () => {
    const adapter = new SequencedMockOpenCodeAdapter()
    adapter.mockResponses.set('mock-session-1#1', [
      '<BEAD_STATUS>',
      '{"bead_id":"bead-1","status":"done","checks":{"tests":"pass","lint":"pass","typecheck":"pass","qualitative":"pass"}}',
      '</BEAD_STATUS>',
    ].join('\n'))

    const sessionIterations: number[] = []
    const result = await executeBead(
      adapter,
      buildBead({ iteration: 5 }),
      [{ type: 'text', content: 'Recovered bead context' }],
      '/tmp/test',
      5,
      PROFILE_DEFAULTS.perIterationTimeout,
      undefined,
      {
        onSessionCreated: (_sessionId, iteration) => {
          sessionIterations.push(iteration)
        },
      },
    )

    expect(result.success).toBe(true)
    expect(result.iteration).toBe(6)
    expect(sessionIterations).toEqual([6])
  })

  it('exhausts a recovered bead retry window at the correct absolute iteration', async () => {
    vi.useFakeTimers()
    try {
      const adapter = new SequencedMockOpenCodeAdapter()
      for (let index = 1; index <= 5; index += 1) {
        adapter.promptFailures.set(`mock-session-${index}#1`, 'stallUntilAbort')
        adapter.mockResponses.set(`mock-session-${index}#2`, `Recovered bead note ${index}`)
      }

      const runPromise = executeBead(
        adapter,
        buildBead({ iteration: 5 }),
        [{ type: 'text', content: 'Recovered bead context' }],
        '/tmp/test',
        5,
        1,
      )

      await vi.runAllTimersAsync()
      const result = await runPromise

      expect(result.success).toBe(false)
      expect(result.iteration).toBe(10)
      expect(result.errorCodes).toEqual([BEAD_RETRY_BUDGET_EXHAUSTED])
      expect(result.errors).toContain('Reached the configured per-bead retry budget at iteration 10.')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reuses the timed-out session for PROM51 before starting the next coding session', async () => {
    const adapter = new SequencedMockOpenCodeAdapter()
    adapter.promptFailures.set('mock-session-1#1', 'stallUntilAbort')
    adapter.mockResponses.set('mock-session-1#2', 'Timeout note from the stalled session.')
    adapter.mockResponses.set('mock-session-2#1', [
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
      25,
    )

    expect(result.success).toBe(true)
    expect(adapter.abortCalls).toEqual(['mock-session-1'])
    expect(adapter.promptCalls.map((call) => call.sessionId)).toEqual([
      'mock-session-1',
      'mock-session-1',
      'mock-session-2',
    ])
    expect(adapter.sessions.map((session) => session.id)).toEqual(['mock-session-1', 'mock-session-2'])
    expect(contextSnapshots).toHaveLength(2)
    expect(contextSnapshots[0]).toBe('')
    expect(contextSnapshots[1]).toContain('Timeout note from the stalled session.')

    const timeoutNotePrompt = adapter.promptCalls[1]?.parts[0]?.content
    expect(typeof timeoutNotePrompt).toBe('string')
    expect(timeoutNotePrompt).toContain('EXISTING SESSION:')
    expect(timeoutNotePrompt).not.toContain('CONTEXT REFRESH:')
  })

  it('uses the configured profile default timeout when no bead timeout is passed explicitly', async () => {
    vi.useFakeTimers()
    try {
      const adapter = new SequencedMockOpenCodeAdapter()
      adapter.promptFailures.set('mock-session-1#1', 'stallUntilAbort')
      adapter.mockResponses.set('mock-session-1#2', 'Timed out using the profile default timeout.')

      const runPromise = executeBead(
        adapter,
        buildBead(),
        [{ type: 'text', content: 'Bead context' }],
        '/tmp/test',
        1,
      )

      await vi.advanceTimersByTimeAsync(PROFILE_DEFAULTS.perIterationTimeout - 1)
      expect(adapter.abortCalls).toEqual([])

      await vi.advanceTimersByTimeAsync(1)
      const result = await runPromise

      expect(result.success).toBe(false)
      expect(adapter.abortCalls).toEqual(['mock-session-1'])
    } finally {
      vi.useRealTimers()
    }
  })
})
