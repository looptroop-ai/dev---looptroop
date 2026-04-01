import { describe, expect, it } from 'vitest'
import type { SessionStatusStreamEvent } from '../../opencode/types'
import { buildSessionStatusLogEntries } from '../sessionStatusLogging'

describe.concurrent('buildSessionStatusLogEntries', () => {
  it('keeps retry reasons as separate error entries and preserves the status line', () => {
    const event: SessionStatusStreamEvent = {
      type: 'session_status',
      sessionId: 'ses-1',
      status: 'retry',
      attempt: 2,
      message: 'The usage limit has been reached\nPlease try again later.',
      next: 1000,
    }

    expect(buildSessionStatusLogEntries('ses-1', event)).toEqual([
      {
        entryId: 'ses-1:retry:2',
        type: 'error',
        kind: 'error',
        op: 'append',
        content: 'Session retry #2: The usage limit has been reached Please try again later.',
      },
      {
        entryId: 'ses-1:status',
        type: 'info',
        kind: 'session',
        op: 'upsert',
        content: 'Session status: retry (attempt 2).',
      },
    ])
  })

  it('finalizes idle status updates without creating extra error entries', () => {
    const event: SessionStatusStreamEvent = {
      type: 'session_status',
      sessionId: 'ses-1',
      status: 'idle',
    }

    expect(buildSessionStatusLogEntries('ses-1', event)).toEqual([
      {
        entryId: 'ses-1:status',
        type: 'info',
        kind: 'session',
        op: 'finalize',
        content: 'Session status: idle.',
      },
    ])
  })
})
