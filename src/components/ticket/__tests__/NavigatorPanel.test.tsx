import { screen } from '@testing-library/react'
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
})
