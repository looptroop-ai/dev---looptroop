import { describe, expect, it } from 'vitest'
import { foldPersistedLogEntries } from '../readDedupe'

describe('foldPersistedLogEntries', () => {
  it('dedupes append entries that share a fingerprint', () => {
    const folded = foldPersistedLogEntries([
      {
        timestamp: '2026-04-20T10:00:00.000Z',
        type: 'info',
        phase: 'CODING',
        status: 'CODING',
        entryId: 'session-1:question:req-1:replied',
        fingerprint: 'opencode-question:session-1:req-1:replied',
        content: '[QUESTION] AI question answered.',
        op: 'append',
      },
      {
        timestamp: '2026-04-20T10:00:01.000Z',
        type: 'info',
        phase: 'CODING',
        status: 'CODING',
        entryId: 'duplicate-entry-id',
        fingerprint: 'opencode-question:session-1:req-1:replied',
        content: '[QUESTION] AI question answered.',
        op: 'append',
      },
    ])

    expect(folded).toHaveLength(1)
    expect(folded[0]?.timestamp).toBe('2026-04-20T10:00:00.000Z')
    expect(folded[0]?.entryId).toBe('session-1:question:req-1:replied')
  })

  it('continues to fold streaming entries by entryId', () => {
    const folded = foldPersistedLogEntries([
      {
        timestamp: '2026-04-20T10:00:00.000Z',
        type: 'model_output',
        entryId: 'session-1:text',
        op: 'upsert',
        streaming: true,
        content: 'partial',
      },
      {
        timestamp: '2026-04-20T10:00:01.000Z',
        type: 'model_output',
        entryId: 'session-1:text',
        op: 'finalize',
        streaming: false,
        content: 'final',
      },
    ])

    expect(folded).toHaveLength(1)
    expect(folded[0]).toMatchObject({
      entryId: 'session-1:text',
      op: 'finalize',
      content: 'final',
      streaming: false,
    })
  })
})
