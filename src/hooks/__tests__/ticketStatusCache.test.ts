import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { patchTicketStatusInCache } from '../ticketStatusCache'

interface TestTicket {
  id: string
  status: string
  title: string
}

describe('patchTicketStatusInCache', () => {
  it('updates the ticket detail cache and every ticket list cache immediately', () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })

    const ticketId = '1:T-42'
    const originalTicket: TestTicket = {
      id: ticketId,
      status: 'DRAFTING_PRD',
      title: 'Sync live phases',
    }
    const otherTicket: TestTicket = {
      id: '1:T-43',
      status: 'CODING',
      title: 'Leave untouched',
    }

    queryClient.setQueryData(['ticket', ticketId], originalTicket)
    queryClient.setQueryData(['tickets'], [originalTicket, otherTicket])
    queryClient.setQueryData(['tickets', { projectId: 7 }], [originalTicket])

    patchTicketStatusInCache<TestTicket>(queryClient, ticketId, 'REFINING_PRD')

    expect(queryClient.getQueryData<TestTicket>(['ticket', ticketId])).toEqual({
      ...originalTicket,
      status: 'REFINING_PRD',
    })
    expect(queryClient.getQueryData<TestTicket[]>(['tickets'])).toEqual([
      { ...originalTicket, status: 'REFINING_PRD' },
      otherTicket,
    ])
    expect(queryClient.getQueryData<TestTicket[]>(['tickets', { projectId: 7 }])).toEqual([
      { ...originalTicket, status: 'REFINING_PRD' },
    ])
  })
})
