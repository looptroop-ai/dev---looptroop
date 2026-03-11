import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { UIProvider, useUI } from '@/context/UIContext'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TicketCard } from '../TicketCard'
import { getErrorTicketSignature } from '@/lib/errorTicketSeen'

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <UIProvider>{ui}</UIProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

function SelectedTicketProbe() {
  const { state } = useUI()
  return <div data-testid="selected-ticket">{state.selectedTicketId ?? 'none'}</div>
}

const baseTicket = {
  id: '3:BSM-2',
  externalId: 'BSM-2',
  title: 'Interview happy-path smoke ticket',
  priority: 3,
  status: 'BLOCKED_ERROR',
  updatedAt: '2026-03-11T10:42:29.354Z',
  projectId: 3,
  currentBead: null,
  totalBeads: null,
  errorMessage: 'Council quorum not met for interview_draft',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TicketCard', () => {
  it('renders blocked error tickets even when localStorage reads fail', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('localStorage unavailable')
    })

    renderWithProviders(
      <>
        <TicketCard ticket={baseTicket} projectName="Browser Smoke Project" />
        <SelectedTicketProbe />
      </>,
    )

    expect(screen.getByText(baseTicket.title)).toBeInTheDocument()
    expect(screen.getByTestId('selected-ticket')).toHaveTextContent('none')
  })

  it('opens blocked error tickets and marks them seen on first open', () => {
    const setItemSpy = vi.spyOn(window.localStorage, 'setItem')
    const expectedSignature = getErrorTicketSignature(baseTicket)

    renderWithProviders(
      <>
        <TicketCard ticket={baseTicket} projectName="Browser Smoke Project" />
        <SelectedTicketProbe />
      </>,
    )

    const ticketTitle = screen.getByText(baseTicket.title)
    const card = ticketTitle.closest('[aria-label="Open ticket BSM-2"]')
    expect(card).toHaveClass('animate-pulse')

    fireEvent.click(ticketTitle)

    expect(screen.getByTestId('selected-ticket')).toHaveTextContent(baseTicket.id)
    expect(setItemSpy).toHaveBeenCalledWith('error-seen-3:BSM-2', expectedSignature)
    expect(card).not.toHaveClass('animate-pulse')
  })
})
