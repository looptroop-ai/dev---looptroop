import { describe, expect, it } from 'vitest'
import { createLogEvent } from '../executionLog'

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
