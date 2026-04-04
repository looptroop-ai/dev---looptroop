import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/renderHelpers'

vi.mock('../VerticalResizeHandle', () => ({
  VerticalResizeHandle: () => <div data-testid="resize-handle" />,
}))

import { CollapsiblePhaseLogSection } from '../CollapsiblePhaseLogSection'

describe('CollapsiblePhaseLogSection', () => {
  it('renders expanded by default as a bottom-anchored log drawer', () => {
    const { container } = renderWithProviders(<CollapsiblePhaseLogSection phase="CODING" />)
    const root = container.firstElementChild as HTMLElement

    expect(root).toHaveClass('mt-auto')

    expect(screen.getByRole('button', { name: /^Log$/i })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'ALL' })).toBeInTheDocument()
  })

  it('pins collapsed fill logs to the bottom edge of the view', () => {
    renderWithProviders(<CollapsiblePhaseLogSection phase="CODING" />)

    fireEvent.click(screen.getByRole('button', { name: /^Log$/i }))
    const collapsedToggle = screen.getByRole('button', { name: /^Log$/i })

    expect(collapsedToggle).toHaveAttribute('aria-expanded', 'false')
    expect(collapsedToggle.parentElement).toHaveClass('mt-auto')
  })

  it('supports default-collapsed bottom drawer behavior', () => {
    renderWithProviders(
      <CollapsiblePhaseLogSection
        phase="WAITING_INTERVIEW_APPROVAL"
        defaultExpanded={false}
        variant="bottom"
      />,
    )

    const toggle = screen.getByRole('button', { name: /^Log$/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'ALL' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('resize-handle')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    const expandedToggle = screen.getByRole('button', { name: /^Log$/i })

    expect(expandedToggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'ALL' })).toBeInTheDocument()
  })
})
