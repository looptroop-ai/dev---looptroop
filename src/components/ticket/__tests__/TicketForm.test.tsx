import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TicketForm } from '../TicketForm'
import type { Project } from '@/hooks/useProjects'

const createTicketMutateMock = vi.fn()
const useProjectsMock = vi.fn()

vi.mock('@/hooks/useTickets', () => ({
  useCreateTicket: () => ({
    mutate: createTicketMutateMock,
    isPending: false,
  }),
}))

vi.mock('@/hooks/useProjects', () => ({
  useProjects: () => useProjectsMock(),
}))

const projects: Project[] = [
  {
    id: 1,
    name: 'Alpha Project',
    shortname: 'ALP',
    icon: 'A',
    color: '#3b82f6',
    folderPath: '/tmp/alpha',
    profileId: null,
    councilMembers: null,
    maxIterations: null,
    perIterationTimeout: null,
    councilResponseTimeout: null,
    minCouncilQuorum: null,
    interviewQuestions: null,
    ticketCounter: 3,
    createdAt: '2026-03-08T09:00:00.000Z',
    updatedAt: '2026-03-08T09:00:00.000Z',
  },
  {
    id: 2,
    name: 'Beta Project',
    shortname: 'BET',
    icon: 'B',
    color: '#10b981',
    folderPath: '/tmp/beta',
    profileId: null,
    councilMembers: null,
    maxIterations: null,
    perIterationTimeout: null,
    councilResponseTimeout: null,
    minCouncilQuorum: null,
    interviewQuestions: null,
    ticketCounter: 5,
    createdAt: '2026-03-08T09:00:00.000Z',
    updatedAt: '2026-03-08T09:00:00.000Z',
  },
]

describe('TicketForm', () => {
  beforeEach(() => {
    createTicketMutateMock.mockReset()
    useProjectsMock.mockReset()
    useProjectsMock.mockReturnValue({ data: projects })
  })

  it('shows the first project as selected by default', () => {
    render(<TicketForm onClose={() => undefined} />)

    expect(screen.getByText('Alpha Project (ALP)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create Ticket' })).toBeEnabled()
  })

  it('submits the first project when the user does not manually change the selection', () => {
    const onClose = vi.fn()
    createTicketMutateMock.mockImplementation((_input, options) => {
      options?.onSuccess?.()
    })

    render(<TicketForm onClose={onClose} />)

    fireEvent.change(screen.getByPlaceholderText('Brief summary of the work'), {
      target: { value: 'Seed default project selection' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create Ticket' }))

    expect(createTicketMutateMock).toHaveBeenCalledTimes(1)
    expect(createTicketMutateMock).toHaveBeenCalledWith(
      {
        projectId: 1,
        title: 'Seed default project selection',
        description: undefined,
        priority: 3,
      },
      expect.objectContaining({ onSuccess: onClose }),
    )
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
