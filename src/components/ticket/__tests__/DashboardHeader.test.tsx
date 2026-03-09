import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { UIProvider } from '@/context/UIContext'
import { DashboardHeader } from '../DashboardHeader'
import type { Ticket } from '@/hooks/useTickets'

const cancelMutateMock = vi.fn()
const deleteMutateMock = vi.fn()
const resetMock = vi.fn()

vi.mock('@/hooks/useTickets', () => ({
  useTicketAction: () => ({
    mutate: cancelMutateMock,
    isPending: false,
  }),
  useDeleteTicket: () => ({
    mutate: deleteMutateMock,
    isPending: false,
    error: null,
    reset: resetMock,
  }),
}))

vi.mock('@/hooks/useProjects', () => ({
  useProjects: () => ({
    data: [],
  }),
}))

const baseTicket: Ticket = {
  id: '7:LOOP-42',
  externalId: 'LOOP-42',
  projectId: 7,
  title: 'Test ticket',
  description: 'Test description',
  priority: 3,
  status: 'COMPLETED',
  xstateSnapshot: null,
  branchName: 'LOOP-42',
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

function renderHeader(ticketOverrides: Partial<Ticket> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <UIProvider>
        <DashboardHeader ticket={{ ...baseTicket, ...ticketOverrides }} />
      </UIProvider>
    </QueryClientProvider>,
  )
}

describe('DashboardHeader', () => {
  beforeEach(() => {
    cancelMutateMock.mockReset()
    deleteMutateMock.mockReset()
    resetMock.mockReset()
  })

  it('places delete between details and close for completed tickets', () => {
    renderHeader({ status: 'COMPLETED' })

    const details = screen.getByRole('button', { name: 'Details' })
    const deleteButton = screen.getByRole('button', { name: 'Delete' })
    const close = screen.getByRole('button', { name: 'Close dashboard' })

    expect(details.compareDocumentPosition(deleteButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(deleteButton.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows cancel instead of delete for non-terminal tickets', () => {
    renderHeader({ status: 'CODING' })

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })
})
