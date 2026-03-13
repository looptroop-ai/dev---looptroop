import type { QueryClient } from '@tanstack/react-query'

interface TicketStatusRecord {
  id: string
  status: string
}

interface TicketRecord {
  id: string
}

export function patchTicketStatus<T extends TicketStatusRecord>(
  ticket: T,
  ticketId: string,
  status: string,
): T {
  if (ticket.id !== ticketId || ticket.status === status) return ticket
  return { ...ticket, status }
}

export function mergeTicket<T extends TicketRecord>(
  ticket: T,
  incomingTicket: T,
): T {
  if (ticket.id !== incomingTicket.id) return ticket
  return { ...ticket, ...incomingTicket }
}

export function mergeTicketInCache<T extends TicketRecord>(
  queryClient: QueryClient,
  incomingTicket: T,
) {
  queryClient.setQueryData<T | undefined>(['ticket', incomingTicket.id], (ticket) =>
    ticket ? mergeTicket(ticket, incomingTicket) : incomingTicket,
  )

  queryClient.setQueriesData<T[]>({ queryKey: ['tickets'] }, (tickets) => {
    if (!tickets) return tickets

    let changed = false
    const nextTickets = tickets.map((ticket) => {
      const nextTicket = mergeTicket(ticket, incomingTicket)
      if (nextTicket !== ticket) changed = true
      return nextTicket
    })

    return changed ? nextTickets : tickets
  })
}

export function patchTicketStatusInCache<T extends TicketStatusRecord>(
  queryClient: QueryClient,
  ticketId: string,
  status: string,
) {
  queryClient.setQueryData<T | undefined>(['ticket', ticketId], (ticket) =>
    ticket ? patchTicketStatus(ticket, ticketId, status) : ticket,
  )

  queryClient.setQueriesData<T[]>({ queryKey: ['tickets'] }, (tickets) => {
    if (!tickets) return tickets

    let changed = false
    const nextTickets = tickets.map((ticket) => {
      const nextTicket = patchTicketStatus(ticket, ticketId, status)
      if (nextTicket !== ticket) changed = true
      return nextTicket
    })

    return changed ? nextTickets : tickets
  })
}
