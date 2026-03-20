import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { broadcaster } from '../sse/broadcaster'
import { warnIfVerbose } from '../runtime'

const streamRouter = new Hono()

streamRouter.get('/stream', (c) => {
  const ticketId = c.req.query('ticketId')
  if (!ticketId) {
    return c.json({ error: 'ticketId query parameter required' }, 400)
  }

  const lastEventId = c.req.header('Last-Event-ID') ?? c.req.query('lastEventId')

  return streamSSE(c, async (stream) => {
    const clientId = `${ticketId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // Register client with broadcaster
    broadcaster.addClient(ticketId, {
      id: clientId,
      ticketId,
      send: (event: string, data: string, id: string) => {
        stream.writeSSE({ event, data, id }).catch((err) => {
          warnIfVerbose(`[stream] SSE write failed for client ${clientId}:`, err)
          broadcaster.removeClient(ticketId, clientId)
        })
      },
      close: () => {
        // stream cleanup handled by onAbort
      },
    })

    // Send initial connection event
    await stream.writeSSE({
      event: 'connected',
      data: JSON.stringify({ ticketId, clientId, timestamp: new Date().toISOString() }),
      id: '0',
    })

    // Replay missed events if reconnecting
    if (lastEventId) {
      const missed = broadcaster.getEventsSince(ticketId, lastEventId)
      for (const evt of missed) {
        await stream.writeSSE({ event: evt.event, data: evt.data, id: evt.id })
      }
    }

    // Keep connection alive with heartbeat
    const interval = setInterval(async () => {
      try {
        await stream.writeSSE({
          event: 'heartbeat',
          data: JSON.stringify({ timestamp: new Date().toISOString() }),
        })
      } catch {
        clearInterval(interval)
      }
    }, 30000)

    // Clean up on close
    stream.onAbort(() => {
      clearInterval(interval)
      broadcaster.removeClient(ticketId, clientId)
    })

    // Keep stream open
    await new Promise(() => {})
  })
})

export { streamRouter }
