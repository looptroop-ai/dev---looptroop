const seenErrorTickets = new Map<string, string>()

interface ErrorTicketSnapshot {
  status: string
  updatedAt: string
  errorMessage?: string | null
}

function getErrorSeenStorageKey(ticketId: string): string {
  return `error-seen-${ticketId}`
}

export function getErrorTicketSignature(ticket: ErrorTicketSnapshot): string | null {
  if (ticket.status !== 'BLOCKED_ERROR') return null
  return [ticket.status, ticket.updatedAt, ticket.errorMessage ?? ''].join('|')
}

export function readErrorTicketSeen(
  ticketId: string,
  errorSignature: string | null,
  persistedSignature?: string | null,
): boolean {
  if (!errorSignature) return false
  if (seenErrorTickets.get(ticketId) === errorSignature) return true
  if (persistedSignature === errorSignature) {
    seenErrorTickets.set(ticketId, errorSignature)
    return true
  }
  if (typeof window === 'undefined') return false
  try {
    const stored = localStorage.getItem(getErrorSeenStorageKey(ticketId))
    const seen = stored === errorSignature || stored === '1'
    if (seen) seenErrorTickets.set(ticketId, errorSignature)
    return seen
  } catch {
    return false
  }
}

export function markErrorTicketSeen(ticketId: string, errorSignature: string | null): void {
  if (!errorSignature) return
  seenErrorTickets.set(ticketId, errorSignature)
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(getErrorSeenStorageKey(ticketId), errorSignature)
  } catch {
    // Storage failures should not block ticket navigation.
  }
}

export function clearErrorTicketSeen(ticketId: string): void {
  seenErrorTickets.delete(ticketId)
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(getErrorSeenStorageKey(ticketId))
  } catch {
    // Ignore storage cleanup failures.
  }
}


