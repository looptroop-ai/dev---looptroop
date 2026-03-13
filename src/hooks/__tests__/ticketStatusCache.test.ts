import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { mergeTicketInCache, patchTicketStatusInCache } from '../ticketStatusCache'

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

describe('mergeTicketInCache', () => {
  it('merges newly returned ticket fields into the detail cache and every ticket list cache immediately', () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })

    const ticketId = '1:T-42'
    const originalTicket = {
      id: ticketId,
      status: 'DRAFT',
      title: 'Sync live phases',
      lockedMainImplementer: null as string | null,
      lockedCouncilMembers: [] as string[],
    }
    const updatedTicket = {
      ...originalTicket,
      lockedMainImplementer: 'openai/gpt-5-codex',
      lockedCouncilMembers: ['openai/gpt-5-codex', 'openai/gpt-5-mini'],
    }
    const otherTicket = {
      id: '1:T-43',
      status: 'CODING',
      title: 'Leave untouched',
      lockedMainImplementer: null as string | null,
      lockedCouncilMembers: [] as string[],
    }

    queryClient.setQueryData(['ticket', ticketId], originalTicket)
    queryClient.setQueryData(['tickets'], [originalTicket, otherTicket])
    queryClient.setQueryData(['tickets', { projectId: 7 }], [originalTicket])

    mergeTicketInCache(queryClient, updatedTicket)

    expect(queryClient.getQueryData(['ticket', ticketId])).toEqual(updatedTicket)
    expect(queryClient.getQueryData(['tickets'])).toEqual([
      updatedTicket,
      otherTicket,
    ])
    expect(queryClient.getQueryData(['tickets', { projectId: 7 }])).toEqual([
      updatedTicket,
    ])
  })
})
