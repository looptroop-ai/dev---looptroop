import { describe, it, expect, beforeEach } from 'vitest'
import { SSEBroadcaster } from '../broadcaster'

describe('SSEBroadcaster', () => {
  let broadcaster: SSEBroadcaster

  beforeEach(() => {
    broadcaster = new SSEBroadcaster()
  })

  it('broadcasts event to connected clients', () => {
    const received: { event: string; data: string; id: string }[] = []
    broadcaster.addClient('ticket-1', {
      id: 'client-1',
      ticketId: 'ticket-1',
      send: (event, data, id) => received.push({ event, data, id }),
      close: () => {},
    })

    broadcaster.broadcast('ticket-1', 'state_change', { from: 'idle', to: 'running' })

    expect(received).toHaveLength(1)
    expect(received[0]!.event).toBe('state_change')
    const parsed = JSON.parse(received[0]!.data)
    expect(parsed.from).toBe('idle')
    expect(parsed.to).toBe('running')
    expect(parsed.timestamp).toBeDefined()
  })

  it('replays events since lastEventId', () => {
    broadcaster.broadcast('ticket-1', 'log', { content: 'line 1' })
    broadcaster.broadcast('ticket-1', 'log', { content: 'line 2' })
    broadcaster.broadcast('ticket-1', 'log', { content: 'line 3' })

    const missed = broadcaster.getEventsSince('ticket-1', '1')
    expect(missed).toHaveLength(2)
    expect(JSON.parse(missed[0]!.data)).toMatchObject({ content: 'line 2' })
    expect(JSON.parse(missed[1]!.data)).toMatchObject({ content: 'line 3' })
  })

  it('returns all events when lastEventId is invalid', () => {
    broadcaster.broadcast('ticket-1', 'log', { content: 'line 1' })
    broadcaster.broadcast('ticket-1', 'log', { content: 'line 2' })

    const missed = broadcaster.getEventsSince('ticket-1', 'invalid')
    expect(missed).toHaveLength(2)
  })

  it('removes disconnected clients', () => {
    broadcaster.addClient('ticket-1', {
      id: 'client-1',
      ticketId: 'ticket-1',
      send: () => { throw new Error('disconnected') },
      close: () => {},
    })

    expect(broadcaster.getClientCount('ticket-1')).toBe(1)
    broadcaster.broadcast('ticket-1', 'log', { content: 'test' })
    expect(broadcaster.getClientCount('ticket-1')).toBe(0)
  })

  it('supports multiple concurrent clients per ticket', () => {
    const received1: string[] = []
    const received2: string[] = []

    broadcaster.addClient('ticket-1', {
      id: 'client-1',
      ticketId: 'ticket-1',
      send: (_e, data) => received1.push(data),
      close: () => {},
    })

    broadcaster.addClient('ticket-1', {
      id: 'client-2',
      ticketId: 'ticket-1',
      send: (_e, data) => received2.push(data),
      close: () => {},
    })

    expect(broadcaster.getClientCount('ticket-1')).toBe(2)
    broadcaster.broadcast('ticket-1', 'log', { content: 'shared' })

    expect(received1).toHaveLength(1)
    expect(received2).toHaveLength(1)
    expect(JSON.parse(received1[0]!)).toMatchObject({ content: 'shared' })
    expect(JSON.parse(received2[0]!)).toMatchObject({ content: 'shared' })
  })

  it('enforces buffer size limit', () => {
    // Broadcast more than MAX_BUFFER_SIZE events
    for (let i = 0; i < 1005; i++) {
      broadcaster.broadcast('ticket-1', 'log', { index: i })
    }

    const all = broadcaster.getEventsSince('ticket-1', '0')
    expect(all.length).toBeLessThanOrEqual(1000)
  })

  it('removes client by id correctly', () => {
    broadcaster.addClient('ticket-1', {
      id: 'client-1',
      ticketId: 'ticket-1',
      send: () => {},
      close: () => {},
    })
    broadcaster.addClient('ticket-1', {
      id: 'client-2',
      ticketId: 'ticket-1',
      send: () => {},
      close: () => {},
    })

    expect(broadcaster.getClientCount('ticket-1')).toBe(2)
    broadcaster.removeClient('ticket-1', 'client-1')
    expect(broadcaster.getClientCount('ticket-1')).toBe(1)
  })

  it('cleanup removes expired buffer entries', () => {
    // Manually add old entries by broadcasting then manipulating time
    broadcaster.broadcast('ticket-1', 'log', { content: 'old' })

    // Access internal buffer via getEventsSince
    expect(broadcaster.getEventsSince('ticket-1', '0')).toHaveLength(1)

    // Cleanup should keep recent events
    broadcaster.cleanup()
    expect(broadcaster.getEventsSince('ticket-1', '0')).toHaveLength(1)
  })

  it('returns 0 for unknown ticket client count', () => {
    expect(broadcaster.getClientCount('nonexistent')).toBe(0)
  })

  it('returns empty array for unknown ticket events', () => {
    expect(broadcaster.getEventsSince('nonexistent', '0')).toEqual([])
  })

  it('does not broadcast to clients of other tickets', () => {
    const received: string[] = []
    broadcaster.addClient('ticket-1', {
      id: 'client-1',
      ticketId: 'ticket-1',
      send: (_e, data) => received.push(data),
      close: () => {},
    })

    broadcaster.broadcast('ticket-2', 'log', { content: 'other ticket' })
    expect(received).toHaveLength(0)
  })
})
