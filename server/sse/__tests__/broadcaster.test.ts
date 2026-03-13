import { describe, expect, it, vi } from 'vitest'
import { SSEBroadcaster } from '../broadcaster'

describe('SSEBroadcaster', () => {
  it('preserves a provided timestamp in the SSE payload', () => {
    const sent = vi.fn()
    const broadcaster = new SSEBroadcaster()
    const timestamp = '2026-03-13T12:00:00.000Z'

    broadcaster.addClient('1:T-42', {
      id: 'client-1',
      ticketId: '1:T-42',
      send: sent,
      close: () => undefined,
    })

    broadcaster.broadcast('1:T-42', 'log', {
      type: 'info',
      content: 'Log message',
      timestamp,
    })

    expect(sent).toHaveBeenCalledTimes(1)
    const [, payload] = sent.mock.calls[0] as [string, string, string]
    expect(JSON.parse(payload)).toMatchObject({ timestamp })
  })
})
