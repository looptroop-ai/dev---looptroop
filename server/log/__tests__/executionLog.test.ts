import { describe, expect, it, vi } from 'vitest'
import { createLogEvent, appendLogEvent } from '../executionLog'

vi.mock('../../storage/tickets', () => ({
  getTicketPaths: () => ({
    executionLogPath: '/tmp/test-execution-log.jsonl',
  }),
}))

vi.mock('../../io/atomicAppend', () => ({
  safeAtomicAppend: vi.fn(),
}))

import { safeAtomicAppend } from '../../io/atomicAppend'

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
  it('does not persist streaming upserts to disk', () => {
    const mockAppend = vi.mocked(safeAtomicAppend)
    mockAppend.mockClear()

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
    const mockAppend = vi.mocked(safeAtomicAppend)
    mockAppend.mockClear()

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
    const mockAppend = vi.mocked(safeAtomicAppend)
    mockAppend.mockClear()

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
    const mockAppend = vi.mocked(safeAtomicAppend)
    mockAppend.mockClear()

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
})
