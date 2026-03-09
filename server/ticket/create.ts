import { createTicket as createTicketRecord } from '../storage/tickets'

export interface CreateTicketOptions {
  projectId: number
  title: string
  description?: string
  priority?: number
}

export function createTicket(options: CreateTicketOptions) {
  return createTicketRecord(options)
}
