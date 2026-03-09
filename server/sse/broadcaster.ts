import type { SSEEventType } from './eventTypes'

interface SSEClient {
  id: string
  ticketId: string
  send: (event: string, data: string, id: string) => void
  close: () => void
}

class SSEBroadcaster {
  private clients = new Map<string, SSEClient[]>()
  private eventCounter = 0
  private eventBuffer = new Map<string, { id: string; event: string; data: string; timestamp: number }[]>()
  private readonly MAX_BUFFER_SIZE = 1000
  private readonly BUFFER_TTL = 300000 // 5 minutes

  addClient(ticketId: string, client: SSEClient) {
    const existing = this.clients.get(ticketId) ?? []
    existing.push(client)
    this.clients.set(ticketId, existing)
  }

  removeClient(ticketId: string, clientId: string) {
    const existing = this.clients.get(ticketId)
    if (existing) {
      const filtered = existing.filter(c => c.id !== clientId)
      if (filtered.length === 0) {
        this.clients.delete(ticketId)
      } else {
        this.clients.set(ticketId, filtered)
      }
    }
  }

  broadcast(ticketId: string, event: SSEEventType, data: Record<string, unknown>) {
    const id = String(++this.eventCounter)
    const payload = JSON.stringify({ ...data, timestamp: new Date().toISOString() })

    // Buffer for replay
    const buffer = this.eventBuffer.get(ticketId) ?? []
    buffer.push({ id, event, data: payload, timestamp: Date.now() })
    // Trim old events
    while (buffer.length > this.MAX_BUFFER_SIZE) {
      buffer.shift()
    }
    this.eventBuffer.set(ticketId, buffer)

    // Broadcast to all connected clients for this ticket
    const clients = this.clients.get(ticketId) ?? []
    for (const client of clients) {
      try {
        client.send(event, payload, id)
      } catch {
        this.removeClient(ticketId, client.id)
      }
    }
  }

  // Replay events since lastEventId
  getEventsSince(ticketId: string, lastEventId: string): { id: string; event: string; data: string }[] {
    const buffer = this.eventBuffer.get(ticketId) ?? []
    const lastId = parseInt(lastEventId, 10)
    if (isNaN(lastId)) return buffer
    return buffer.filter(e => parseInt(e.id, 10) > lastId)
  }

  getClientCount(ticketId: string): number {
    return (this.clients.get(ticketId) ?? []).length
  }

  clearTicket(ticketId: string) {
    const clients = this.clients.get(ticketId) ?? []
    for (const client of clients) {
      try {
        client.close()
      } catch {
        // Ignore close errors during cleanup.
      }
    }

    this.clients.delete(ticketId)
    this.eventBuffer.delete(ticketId)
  }

  // Cleanup expired buffer entries
  cleanup() {
    const now = Date.now()
    for (const [ticketId, buffer] of this.eventBuffer) {
      const filtered = buffer.filter(e => now - e.timestamp < this.BUFFER_TTL)
      if (filtered.length === 0) {
        this.eventBuffer.delete(ticketId)
      } else {
        this.eventBuffer.set(ticketId, filtered)
      }
    }
  }
}

export const broadcaster = new SSEBroadcaster()
export { SSEBroadcaster }
