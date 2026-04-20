import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLogEvent, appendLogEvent } from '../executionLog'
import * as ticketsModule from '../../storage/tickets'
import * as atomicAppendModule from '../../io/atomicAppend'

const mockGetTicketPaths = vi.spyOn(ticketsModule, 'getTicketPaths').mockReturnValue({
  executionLogPath: '/tmp/test-execution-log.jsonl',
  worktreePath: '/tmp/test-worktree',
  ticketDir: '/tmp/test-ticket-dir',
  executionSetupDir: '/tmp/test-ticket-dir/.ticket/runtime/execution-setup',
  executionSetupProfilePath: '/tmp/test-ticket-dir/.ticket/runtime/execution-setup-profile.json',
  baseBranch: 'main',
  beadsPath: '/tmp/test-beads.jsonl',
})

const mockAppend = vi.spyOn(atomicAppendModule, 'safeAtomicAppend').mockImplementation(() => {})

describe('createLogEvent', () => {
  it('preserves a provided timestamp so live and persisted log entries stay aligned', () => {
    const timestamp = '2026-03-13T12:00:00.000Z'

    const event = createLogEvent(
      '1:T-42',
      'info',
      'CODING',
      'Log message',
      { timestamp },
      'system',
      'CODING',
    )

    expect(event.timestamp).toBe(timestamp)
  })
})

describe('appendLogEvent', () => {
  beforeEach(() => {
    mockAppend.mockClear()
    mockGetTicketPaths.mockClear()
  })

  it('does not persist streaming upserts to disk', () => {
    appendLogEvent(
      '1:T-42',
      'model_output',
      'CODING',
      'partial content',
      { timestamp: '2026-03-13T12:00:00.000Z' },
      undefined,
      'CODING',
      { op: 'upsert', streaming: true, entryId: 'session:part1' },
    )

    expect(mockAppend).not.toHaveBeenCalled()
  })

  it('persists finalize events to disk', () => {

    appendLogEvent(
      '1:T-42',
      'model_output',
      'CODING',
      'final content',
      { timestamp: '2026-03-13T12:00:00.000Z' },
      undefined,
      'CODING',
      { op: 'finalize', entryId: 'session:part1', streaming: false },
    )

    expect(mockAppend).toHaveBeenCalledOnce()
    const written = JSON.parse(mockAppend.mock.calls[0]![1]!)
    expect(written.op).toBe('finalize')
    expect(written.content).toBe('final content')
  })

  it('strips redundant structured fields and internal flags from persisted data', () => {

    appendLogEvent(
      '1:T-42',
      'info',
      'CODING',
      'some log',
      {
        timestamp: '2026-03-13T12:00:00.000Z',
        suppressDebugMirror: true,
        entryId: 'e1',
        sessionId: 's1',
        source: 'opencode',
        modelId: 'm1',
        streaming: false,
        audience: 'all',
        kind: 'milestone',
        op: 'append',
        customField: 'keep-this',
      },
      'system',
      'CODING',
    )

    expect(mockAppend).toHaveBeenCalledOnce()
    const written = JSON.parse(mockAppend.mock.calls[0]![1]!)
    // Internal flag should be gone
    expect(written.data?.suppressDebugMirror).toBeUndefined()
    // Structured keys should be gone from data (they're top-level)
    expect(written.data?.entryId).toBeUndefined()
    expect(written.data?.sessionId).toBeUndefined()
    expect(written.data?.source).toBeUndefined()
    // Custom fields should be preserved
    expect(written.data?.customField).toBe('keep-this')
    // Structured fields should be at top level
    expect(written.entryId).toBe('e1')
    expect(written.sessionId).toBe('s1')
  })

  it('persists normal append events', () => {

    appendLogEvent(
      '1:T-42',
      'info',
      'CODING',
      'Status update',
      { timestamp: '2026-03-13T12:00:00.000Z' },
      'system',
      'CODING',
    )

    expect(mockAppend).toHaveBeenCalledOnce()
  })

  it('skips persisting repeated append events with the same fingerprint', () => {
    appendLogEvent(
      '1:T-42',
      'info',
      'CODING',
      '[QUESTION] AI question answered.',
      {
        timestamp: '2026-04-20T10:00:00.000Z',
        fingerprint: 'opencode-question:session-1:req-1:replied',
      },
      'opencode',
      'CODING',
    )

    appendLogEvent(
      '1:T-42',
      'info',
      'CODING',
      '[QUESTION] AI question answered.',
      {
        timestamp: '2026-04-20T10:00:01.000Z',
        fingerprint: 'opencode-question:session-1:req-1:replied',
      },
      'opencode',
      'CODING',
    )

    expect(mockAppend).toHaveBeenCalledOnce()
  })
})
