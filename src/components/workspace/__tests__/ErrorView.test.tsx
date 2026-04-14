import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/renderHelpers'
import { makeTicket } from '@/test/factories'
import { ErrorView } from '../ErrorView'
import { BEAD_RETRY_BUDGET_EXHAUSTED } from '@shared/errorCodes'

const logSectionMock = vi.hoisted(() => vi.fn(() => <div data-testid="phase-log-section" />))

vi.mock('../CollapsiblePhaseLogSection', () => ({
  CollapsiblePhaseLogSection: logSectionMock,
}))

describe('ErrorView', () => {
  beforeEach(() => {
    logSectionMock.mockClear()
  })

  it('allows long error details to scroll within the summary area', () => {
    const ticket = makeTicket({
      status: 'BLOCKED_ERROR',
      previousStatus: 'CODING',
      errorMessage: 'A'.repeat(4000),
      availableActions: ['retry', 'cancel'],
    })

    const { container } = renderWithProviders(<ErrorView ticket={ticket} />)
    const root = container.firstElementChild as HTMLElement
    const summary = root.firstElementChild as HTMLElement

    expect(root).toHaveClass('min-h-0')
    expect(summary).toHaveClass('min-h-0', 'shrink', 'overflow-y-auto')
    expect(screen.getByTestId('phase-log-section')).toBeInTheDocument()
  })

  it('starts the error log drawer collapsed at the bottom', () => {
    const ticket = makeTicket({
      status: 'BLOCKED_ERROR',
      previousStatus: 'CODING',
    })

    renderWithProviders(<ErrorView ticket={ticket} />)

    const firstLogSectionProps = (logSectionMock.mock.calls[0] as [unknown] | undefined)?.[0]
    expect(firstLogSectionProps).toMatchObject({
      phase: 'CODING',
      defaultExpanded: false,
    })
  })

  it('shows a coding-specific retry label when the active error exhausted the bead retry budget', () => {
    const ticket = makeTicket({
      status: 'BLOCKED_ERROR',
      previousStatus: 'CODING',
      availableActions: ['retry', 'cancel'],
      activeErrorOccurrenceId: '1',
      errorOccurrences: [{
        id: '1',
        occurrenceNumber: 1,
        blockedFromStatus: 'CODING',
        errorMessage: 'Bead used its retry budget.',
        errorCodes: [BEAD_RETRY_BUDGET_EXHAUSTED],
        occurredAt: '2026-01-01T00:00:00.000Z',
        resolvedAt: null,
        resolutionStatus: null,
        resumedToStatus: null,
      }],
      runtime: {
        ...makeTicket().runtime,
        maxIterationsPerBead: 5,
      },
    })

    renderWithProviders(<ErrorView ticket={ticket} />)

    expect(screen.getByRole('button', { name: 'Try again 5 retries' })).toBeInTheDocument()
  })

  it('keeps the generic retry label for non-budget blocked errors', () => {
    const ticket = makeTicket({
      status: 'BLOCKED_ERROR',
      previousStatus: 'CODING',
      availableActions: ['retry', 'cancel'],
      activeErrorOccurrenceId: '2',
      errorOccurrences: [{
        id: '2',
        occurrenceNumber: 1,
        blockedFromStatus: 'CODING',
        errorMessage: 'Lint failed.',
        errorCodes: ['LINT_FAILED'],
        occurredAt: '2026-01-01T00:00:00.000Z',
        resolvedAt: null,
        resolutionStatus: null,
        resumedToStatus: null,
      }],
      runtime: {
        ...makeTicket().runtime,
        maxIterationsPerBead: 5,
      },
    })

    renderWithProviders(<ErrorView ticket={ticket} />)

    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
