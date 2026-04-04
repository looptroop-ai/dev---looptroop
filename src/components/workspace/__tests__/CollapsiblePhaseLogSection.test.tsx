import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/renderHelpers'

vi.mock('../VerticalResizeHandle', () => ({
  VerticalResizeHandle: () => <div data-testid="resize-handle" />,
}))

import { CollapsiblePhaseLogSection } from '../CollapsiblePhaseLogSection'
import { getFillDrawerAvailableHeight, resolveStickyFillNaturalHeight } from '../logDrawerSizing'

function makeRect(height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: height,
    right: 0,
    width: 0,
    height,
    toJSON: () => ({}),
  } as DOMRect
}

describe('CollapsiblePhaseLogSection', () => {
  it('derives available fill height from the space left after the content above the log', () => {
    const parent = document.createElement('div')
    const artifacts = document.createElement('div')
    const details = document.createElement('div')
    const root = document.createElement('div')

    Object.defineProperty(parent, 'clientHeight', {
      configurable: true,
      get: () => 720,
    })

    vi.spyOn(artifacts, 'getBoundingClientRect').mockReturnValue(makeRect(260))
    vi.spyOn(details, 'getBoundingClientRect').mockReturnValue(makeRect(140))
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(makeRect(80))

    parent.append(artifacts, details, root)

    expect(getFillDrawerAvailableHeight(parent, root)).toBe(320)
  })

  it('keeps the largest natural height within a phase but resets for a new phase', () => {
    expect(resolveStickyFillNaturalHeight(null, 'CODING', 240)).toEqual({
      phase: 'CODING',
      height: 240,
    })

    expect(resolveStickyFillNaturalHeight({ phase: 'CODING', height: 240 }, 'CODING', 80)).toEqual({
      phase: 'CODING',
      height: 240,
    })

    expect(resolveStickyFillNaturalHeight({ phase: 'CODING', height: 240 }, 'REVIEWING', 120)).toEqual({
      phase: 'REVIEWING',
      height: 120,
    })
  })

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
