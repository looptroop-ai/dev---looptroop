import { fireEvent, screen, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { UIContext, type UIContextValue } from '@/context/uiContextDef'
import { renderWithProviders } from '@/test/renderHelpers'
import { makeTicket } from '@/test/factories'
import { DashboardHeader } from '../DashboardHeader'

const mockUseProjects = vi.hoisted(() => vi.fn())
const mockUseProfile = vi.hoisted(() => vi.fn())
const mockUseTicketAction = vi.hoisted(() => vi.fn())
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
    useUpdateTicket: () => mockUseUpdateTicket(),
  }
})

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
    mockUseUpdateTicket.mockReturnValue({ mutateAsync: vi.fn() })
  })

  it('shows the project as its own details field above priority', async () => {
    const ticket = makeTicket({
      status: 'DRAFTING_PRD',
      availableActions: ['cancel'],
    })
    const uiValue: UIContextValue = {
      state: {
        selectedTicketId: ticket.id,
        selectedTicketExternalId: ticket.externalId,
        sidebarOpen: true,
        activeView: 'ticket',
        logPanelHeight: 320,
        filters: {
          projectId: null,
          status: null,
          search: '',
        },
        theme: 'system',
      },
      dispatch: vi.fn(),
    }

    renderWithProviders(
      <UIContext.Provider value={uiValue}>
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
})
