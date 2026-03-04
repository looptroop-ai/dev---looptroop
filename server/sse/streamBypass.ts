import { broadcaster } from './broadcaster'

// High-frequency stream bypassing — token-by-token streaming
// bypasses XState/SQLite entirely, pipes directly to SSE
export function streamTokenDelta(ticketId: string, content: string, type: string) {
  broadcaster.broadcast(ticketId, 'log', {
    type,
    content,
    streaming: true,
  })
}

// Substantive checkpoint — goes through XState/SQLite
export function emitCheckpoint(ticketId: string, event: string, data: Record<string, unknown>) {
  // This will be called by XState actions after persisting
  broadcaster.broadcast(ticketId, 'state_change', { event, ...data })
}
