import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/renderHelpers'
import { makeTicket } from '@/test/factories'
import { ErrorView } from '../ErrorView'

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

    expect(logSectionMock.mock.calls[0]?.[0]).toMatchObject({
      phase: 'CODING',
      defaultExpanded: false,
    })
  })
})
