import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/renderHelpers'

vi.mock('../VerticalResizeHandle', () => ({
  VerticalResizeHandle: () => <div data-testid="resize-handle" />,
}))

import { CollapsiblePhaseLogSection } from '../CollapsiblePhaseLogSection'

describe('CollapsiblePhaseLogSection', () => {
  it('renders expanded by default outside the existing collapsed views', () => {
    renderWithProviders(<CollapsiblePhaseLogSection phase="CODING" />)

    expect(screen.getByRole('button', { name: /^Log — /i })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/AI coding agent executes beads/i)).toBeInTheDocument()
  })

  it('pins collapsed fill logs to the bottom edge of the view', () => {
    renderWithProviders(<CollapsiblePhaseLogSection phase="CODING" />)

    const toggle = screen.getByRole('button', { name: /^Log — /i })
    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle.parentElement).toHaveClass('mt-auto')
  })

  it('supports default-collapsed bottom drawer behavior', () => {
    renderWithProviders(
      <CollapsiblePhaseLogSection
        phase="WAITING_INTERVIEW_APPROVAL"
        defaultExpanded={false}
        variant="bottom"
      />,
    )

    const toggle = screen.getByRole('button', { name: /^Log — /i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/Interview results ready for user review and approval/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('resize-handle')).not.toBeInTheDocument()

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/Interview results ready for user review and approval/i)).toBeInTheDocument()
  })
})
