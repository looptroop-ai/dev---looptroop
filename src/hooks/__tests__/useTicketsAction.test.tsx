import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTicketAction, type Ticket } from '../useTickets'

function createJsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => data,
  } as Response
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function seedTicketCaches(queryClient: QueryClient, ticket: Ticket) {
  queryClient.setQueryData(['ticket', ticket.id], ticket)
  queryClient.setQueryData(['tickets'], [ticket])
  queryClient.setQueryData(['tickets', { projectId: ticket.projectId }], [ticket])
}

const baseTicket: Ticket = {
  id: '7:LOOP-42',
  externalId: 'LOOP-42',
  projectId: 7,
  title: 'Test ticket',
  description: 'Test description',
  priority: 3,
  status: 'DRAFT',
  xstateSnapshot: null,
  branchName: null,
  currentBead: null,
  totalBeads: null,
  percentComplete: null,
  errorMessage: null,
  lockedMainImplementer: null,
  lockedCouncilMembers: null,
  startedAt: null,
  plannedDate: null,
  createdAt: '2026-03-08T09:00:00.000Z',
  updatedAt: '2026-03-08T09:00:00.000Z',
}

describe('useTicketAction', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('patches single-ticket and ticket-list caches when the action response includes status', async () => {
    const queryClient = createQueryClient()
    const wrapper = createWrapper(queryClient)
    seedTicketCaches(queryClient, baseTicket)

    fetchMock.mockResolvedValueOnce(createJsonResponse({
      message: 'Start action accepted',
      ticketId: baseTicket.id,
      status: 'COUNCIL_DELIBERATING',
      state: 'COUNCIL_DELIBERATING',
    }))

    const { result } = renderHook(() => useTicketAction(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ id: baseTicket.id, action: 'start' })
    })

    expect(queryClient.getQueryData<Ticket>(['ticket', baseTicket.id])?.status).toBe('COUNCIL_DELIBERATING')
    expect(queryClient.getQueryData<Ticket[]>(['tickets'])?.[0]?.status).toBe('COUNCIL_DELIBERATING')
    expect(queryClient.getQueryData<Ticket[]>(['tickets', { projectId: baseTicket.projectId }])?.[0]?.status).toBe('COUNCIL_DELIBERATING')
    expect(fetchMock).toHaveBeenCalledWith(`/api/tickets/${baseTicket.id}/start`, { method: 'POST' })
  })

  it('does not invent a client-only status when the action response omits status', async () => {
    const queryClient = createQueryClient()
    const wrapper = createWrapper(queryClient)
    seedTicketCaches(queryClient, baseTicket)

    fetchMock.mockResolvedValueOnce(createJsonResponse({
      message: 'Start action accepted',
      ticketId: baseTicket.id,
    }))

    const { result } = renderHook(() => useTicketAction(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ id: baseTicket.id, action: 'start' })
    })

    expect(queryClient.getQueryData<Ticket>(['ticket', baseTicket.id])?.status).toBe('DRAFT')
    expect(queryClient.getQueryData<Ticket[]>(['tickets'])?.[0]?.status).toBe('DRAFT')
    expect(queryClient.getQueryData<Ticket[]>(['tickets', { projectId: baseTicket.projectId }])?.[0]?.status).toBe('DRAFT')
  })

  it('uses the live actor state when status is omitted from the action response', async () => {
    const queryClient = createQueryClient()
    const wrapper = createWrapper(queryClient)
    seedTicketCaches(queryClient, {
      ...baseTicket,
      status: 'CODING',
    })

    fetchMock.mockResolvedValueOnce(createJsonResponse({
      message: 'Cancel action accepted',
      ticketId: baseTicket.id,
      state: 'CANCELED',
    }))

    const { result } = renderHook(() => useTicketAction(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ id: baseTicket.id, action: 'cancel' })
    })

    expect(queryClient.getQueryData<Ticket>(['ticket', baseTicket.id])?.status).toBe('CANCELED')
    expect(queryClient.getQueryData<Ticket[]>(['tickets'])?.[0]?.status).toBe('CANCELED')
    expect(queryClient.getQueryData<Ticket[]>(['tickets', { projectId: baseTicket.projectId }])?.[0]?.status).toBe('CANCELED')
  })

  it('patches caches for other workflow actions that return a next status', async () => {
    const queryClient = createQueryClient()
    const wrapper = createWrapper(queryClient)
    const approvalTicket: Ticket = {
      ...baseTicket,
      status: 'WAITING_PRD_APPROVAL',
    }
    seedTicketCaches(queryClient, approvalTicket)

    fetchMock.mockResolvedValueOnce(createJsonResponse({
      message: 'Approve action accepted',
      ticketId: approvalTicket.id,
      status: 'DRAFTING_BEADS',
      state: 'DRAFTING_BEADS',
    }))

    const { result } = renderHook(() => useTicketAction(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ id: approvalTicket.id, action: 'approve' })
    })

    expect(queryClient.getQueryData<Ticket>(['ticket', approvalTicket.id])?.status).toBe('DRAFTING_BEADS')
    expect(queryClient.getQueryData<Ticket[]>(['tickets'])?.[0]?.status).toBe('DRAFTING_BEADS')
    expect(queryClient.getQueryData<Ticket[]>(['tickets', { projectId: approvalTicket.projectId }])?.[0]?.status).toBe('DRAFTING_BEADS')
    expect(fetchMock).toHaveBeenCalledWith(`/api/tickets/${approvalTicket.id}/approve`, { method: 'POST' })
  })
})
