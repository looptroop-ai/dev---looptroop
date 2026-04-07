import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeTicket } from '@/test/factories'
import { renderWithProviders } from '@/test/renderHelpers'
import { NavigatorPanel } from '../NavigatorPanel'

const errorOccurrence = {
  id: 'error-1',
  occurrenceNumber: 1,
  blockedFromStatus: 'CODING',
  errorMessage: 'First crash',
  errorCodes: [] as string[],
  occurredAt: '2026-03-11T10:10:00.000Z',
  resolvedAt: '2026-03-11T10:11:00.000Z',
  resolutionStatus: 'RETRIED' as const,
  resumedToStatus: 'REFINING_PRD',
}

describe('NavigatorPanel', () => {
  it('renders the errors section after the timeline with a separator', () => {
    const { container } = renderWithProviders(
      <NavigatorPanel
        ticketId="1:T-42"
        ticket={makeTicket({ status: 'DRAFT', errorOccurrences: [errorOccurrence], hasPastErrors: true, previousStatus: 'CODING' })}
        currentStatus="DRAFT"
        selectedPhase="DRAFT"
        selectedErrorOccurrenceId={null}
        onSelectPhase={vi.fn()}
        onSelectErrorOccurrence={vi.fn()}
        contextPhase="DRAFT"
      />,
    )

    const doneButton = screen.getByText('Done').closest('button')
    const errorsButton = screen.getByRole('button', { name: /errors/i })

    expect(doneButton).not.toBeNull()
    expect(doneButton!.compareDocumentPosition(errorsButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelector('[data-orientation="horizontal"]')).not.toBeNull()
  })

  it('does not show "Full Log" button when ticket is in DRAFT status', () => {
    renderWithProviders(
      <NavigatorPanel
        ticketId="1:T-42"
        ticket={makeTicket({ status: 'DRAFT' })}
        currentStatus="DRAFT"
        selectedPhase="DRAFT"
        selectedErrorOccurrenceId={null}
        onSelectPhase={vi.fn()}
        onSelectErrorOccurrence={vi.fn()}
        contextPhase="DRAFT"
      />,
    )

    expect(screen.queryByRole('button', { name: /full log/i })).toBeNull()
  })

  it('shows "Full Log" button when ticket is past DRAFT', () => {
    renderWithProviders(
      <NavigatorPanel
        ticketId="1:T-42"
        ticket={makeTicket({ status: 'CODING' })}
        currentStatus="CODING"
        selectedPhase="CODING"
        selectedErrorOccurrenceId={null}
        onSelectPhase={vi.fn()}
        onSelectErrorOccurrence={vi.fn()}
        contextPhase="CODING"
      />,
    )

    expect(screen.getByRole('button', { name: /full log/i })).toBeTruthy()
  })

  it('calls onOpenFullLog when "Full Log" button is clicked', () => {
    const onOpenFullLog = vi.fn()
    renderWithProviders(
      <NavigatorPanel
        ticketId="1:T-42"
        ticket={makeTicket({ status: 'CODING' })}
        currentStatus="CODING"
        selectedPhase="CODING"
        selectedErrorOccurrenceId={null}
        onSelectPhase={vi.fn()}
        onSelectErrorOccurrence={vi.fn()}
        onOpenFullLog={onOpenFullLog}
        contextPhase="CODING"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /full log/i }))
    expect(onOpenFullLog).toHaveBeenCalledTimes(1)
  })

  it('hides "Allowed Context" when fullLogOpen is true', () => {
    renderWithProviders(
      <NavigatorPanel
        ticketId="1:T-42"
        ticket={makeTicket({ status: 'CODING' })}
        currentStatus="CODING"
        selectedPhase="CODING"
        selectedErrorOccurrenceId={null}
        fullLogOpen={true}
        onSelectPhase={vi.fn()}
        onSelectErrorOccurrence={vi.fn()}
        onOpenFullLog={vi.fn()}
        contextPhase="CODING"
      />,
    )

    expect(screen.queryByText(/allowed context/i)).toBeNull()
  })

  it('shows "Allowed Context" when fullLogOpen is false', () => {
    renderWithProviders(
      <NavigatorPanel
        ticketId="1:T-42"
        ticket={makeTicket({ status: 'CODING' })}
        currentStatus="CODING"
        selectedPhase="CODING"
        selectedErrorOccurrenceId={null}
        fullLogOpen={false}
        onSelectPhase={vi.fn()}
        onSelectErrorOccurrence={vi.fn()}
        onOpenFullLog={vi.fn()}
        contextPhase="CODING"
      />,
    )

    expect(screen.getByText(/allowed context/i)).toBeTruthy()
  })

  it('shows "Back to live" button when fullLogOpen is true', () => {
    renderWithProviders(
      <NavigatorPanel
        ticketId="1:T-42"
        ticket={makeTicket({ status: 'CODING' })}
        currentStatus="CODING"
        selectedPhase="CODING"
        selectedErrorOccurrenceId={null}
        fullLogOpen={true}
        onSelectPhase={vi.fn()}
        onSelectErrorOccurrence={vi.fn()}
        onOpenFullLog={vi.fn()}
        contextPhase="CODING"
      />,
    )

    expect(screen.getByText(/back to live/i)).toBeTruthy()
  })
})
