import { fireEvent, screen, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { UIContext, type UIContextValue } from '@/context/uiContextDef'
import { renderWithProviders } from '@/test/renderHelpers'
import { makeTicket } from '@/test/factories'
import { DashboardHeader } from '../DashboardHeader'

const mockUseProjects = vi.hoisted(() => vi.fn())
const mockUseProfile = vi.hoisted(() => vi.fn())
const mockUseTicketAction = vi.hoisted(() => vi.fn())
const mockUseCancelTicket = vi.hoisted(() => vi.fn())
const mockUseUpdateTicket = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/useProjects', () => ({
  useProjects: () => mockUseProjects(),
}))

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => mockUseProfile(),
}))

vi.mock('@/hooks/useTickets', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useTickets')>('@/hooks/useTickets')
  return {
    ...actual,
    useTicketAction: () => mockUseTicketAction(),
    useCancelTicket: () => mockUseCancelTicket(),
    useUpdateTicket: () => mockUseUpdateTicket(),
  }
})

function makeUIValue(ticketId: string, externalId: string): UIContextValue {
  return {
    state: {
      selectedTicketId: ticketId,
      selectedTicketExternalId: externalId,
      sidebarOpen: true,
      activeView: 'ticket',
      logPanelHeight: 320,
      filters: { projectId: null, status: null, search: '' },
      theme: 'system',
    },
    dispatch: vi.fn(),
  }
}

describe('DashboardHeader', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      writable: true,
      value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0),
    })
  })

  beforeEach(() => {
    mockUseProjects.mockReturnValue({
      data: [
        {
          id: 1,
          name: 'Acme Console',
          shortname: 'ACME',
          icon: '🧭',
          color: '#2563eb',
          folderPath: '/tmp/acme-console',
          profileId: null,
          councilMembers: null,
          maxIterations: null,
          perIterationTimeout: null,
          councilResponseTimeout: null,
          minCouncilQuorum: null,
          interviewQuestions: null,
          ticketCounter: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
    mockUseProfile.mockReturnValue({ data: null })
    mockUseTicketAction.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mockUseCancelTicket.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mockUseUpdateTicket.mockReturnValue({ mutateAsync: vi.fn() })
  })

  it('shows the project as its own details field above priority', async () => {
    const ticket = makeTicket({
      status: 'DRAFTING_PRD',
      availableActions: ['cancel'],
    })

    renderWithProviders(
      <UIContext.Provider value={makeUIValue(ticket.id, ticket.externalId)}>
        <DashboardHeader ticket={ticket} />
      </UIContext.Provider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /details/i }))

    const titleSection = screen.getByText('Title').parentElement
    const projectSection = screen.getByText('Project').parentElement
    expect(titleSection).not.toBeNull()
    expect(projectSection).not.toBeNull()
    expect(within(titleSection as HTMLElement).getByText(ticket.title)).toBeInTheDocument()
    expect(within(projectSection as HTMLElement).getByText('Acme Console')).toBeInTheDocument()
    expect(within(projectSection as HTMLElement).getByText('🧭')).toBeInTheDocument()
  })

  it('shows the cancel button labeled "Cancel…" when cancel action is available on a non-DRAFT ticket', () => {
    const ticket = makeTicket({ status: 'DRAFTING_PRD', availableActions: ['cancel'] })

    renderWithProviders(
      <UIContext.Provider value={makeUIValue(ticket.id, ticket.externalId)}>
        <DashboardHeader ticket={ticket} />
      </UIContext.Provider>,
    )

    expect(screen.getByRole('button', { name: /cancel…/i })).toBeInTheDocument()
  })

  it('shows the cancel button labeled "Cancel" (no ellipsis) for a DRAFT ticket', () => {
    const ticket = makeTicket({ status: 'DRAFT', availableActions: ['cancel'] })

    renderWithProviders(
      <UIContext.Provider value={makeUIValue(ticket.id, ticket.externalId)}>
        <DashboardHeader ticket={ticket} />
      </UIContext.Provider>,
    )

    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /cancel…/i })).not.toBeInTheDocument()
  })

  it('cancels a DRAFT ticket immediately without opening a dialog', () => {
    const cancelMutate = vi.fn()
    mockUseCancelTicket.mockReturnValue({ mutate: cancelMutate, isPending: false })

    const ticket = makeTicket({ status: 'DRAFT', availableActions: ['cancel'] })

    renderWithProviders(
      <UIContext.Provider value={makeUIValue(ticket.id, ticket.externalId)}>
        <DashboardHeader ticket={ticket} />
      </UIContext.Provider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))

    expect(cancelMutate).toHaveBeenCalledWith({
      id: ticket.id,
      options: { deleteContent: false, deleteLog: false },
    })
    expect(screen.queryByText('Cancel Ticket')).not.toBeInTheDocument()
  })

  it('opens cancel confirmation dialog with both checkboxes unchecked', () => {
    const ticket = makeTicket({ status: 'DRAFTING_PRD', availableActions: ['cancel'] })

    renderWithProviders(
      <UIContext.Provider value={makeUIValue(ticket.id, ticket.externalId)}>
        <DashboardHeader ticket={ticket} />
      </UIContext.Provider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /cancel…/i }))

    expect(screen.getByText('Cancel Ticket')).toBeInTheDocument()
    const deleteContentCheckbox = screen.getByTestId('delete-content-checkbox') as HTMLInputElement
    const deleteLogCheckbox = screen.getByTestId('delete-log-checkbox') as HTMLInputElement
    expect(deleteContentCheckbox.checked).toBe(false)
    expect(deleteLogCheckbox.checked).toBe(false)
  })

  it('calls cancelTicket with deleteContent=false and deleteLog=false by default', () => {
    const cancelMutate = vi.fn()
    mockUseCancelTicket.mockReturnValue({ mutate: cancelMutate, isPending: false })

    const ticket = makeTicket({ status: 'DRAFTING_PRD', availableActions: ['cancel'] })

    renderWithProviders(
      <UIContext.Provider value={makeUIValue(ticket.id, ticket.externalId)}>
        <DashboardHeader ticket={ticket} />
      </UIContext.Provider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /cancel…/i }))
    fireEvent.click(screen.getByRole('button', { name: /yes, cancel ticket/i }))

    expect(cancelMutate).toHaveBeenCalledWith({
      id: ticket.id,
      options: { deleteContent: false, deleteLog: false },
    })
  })

  it('passes deleteContent=true when the checkbox is checked before confirming', () => {
    const cancelMutate = vi.fn()
    mockUseCancelTicket.mockReturnValue({ mutate: cancelMutate, isPending: false })

    const ticket = makeTicket({ status: 'DRAFTING_PRD', availableActions: ['cancel'] })

    renderWithProviders(
      <UIContext.Provider value={makeUIValue(ticket.id, ticket.externalId)}>
        <DashboardHeader ticket={ticket} />
      </UIContext.Provider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /cancel…/i }))
    fireEvent.click(screen.getByTestId('delete-content-checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /yes, cancel ticket/i }))

    expect(cancelMutate).toHaveBeenCalledWith({
      id: ticket.id,
      options: { deleteContent: true, deleteLog: false },
    })
  })

  it('passes deleteLog=true when only the log checkbox is checked', () => {
    const cancelMutate = vi.fn()
    mockUseCancelTicket.mockReturnValue({ mutate: cancelMutate, isPending: false })

    const ticket = makeTicket({ status: 'DRAFTING_PRD', availableActions: ['cancel'] })

    renderWithProviders(
      <UIContext.Provider value={makeUIValue(ticket.id, ticket.externalId)}>
        <DashboardHeader ticket={ticket} />
      </UIContext.Provider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /cancel…/i }))
    fireEvent.click(screen.getByTestId('delete-log-checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /yes, cancel ticket/i }))

    expect(cancelMutate).toHaveBeenCalledWith({
      id: ticket.id,
      options: { deleteContent: false, deleteLog: true },
    })
  })

  it('resets checkboxes to unchecked when dialog is closed via Keep Ticket', () => {
    const ticket = makeTicket({ status: 'DRAFTING_PRD', availableActions: ['cancel'] })

    renderWithProviders(
      <UIContext.Provider value={makeUIValue(ticket.id, ticket.externalId)}>
        <DashboardHeader ticket={ticket} />
      </UIContext.Provider>,
    )

    // Open and check a box, then close
    fireEvent.click(screen.getByRole('button', { name: /cancel…/i }))
    fireEvent.click(screen.getByTestId('delete-content-checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /keep ticket/i }))

    // Re-open and verify the box is reset
    fireEvent.click(screen.getByRole('button', { name: /cancel…/i }))
    const deleteContentCheckbox = screen.getByTestId('delete-content-checkbox') as HTMLInputElement
    expect(deleteContentCheckbox.checked).toBe(false)
  })
})
