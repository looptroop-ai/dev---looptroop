import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PhaseTimeline } from '../PhaseTimeline'
import { TooltipProvider } from '@/components/ui/tooltip'

function renderWithProviders(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

describe('PhaseTimeline', () => {
  it('renders phase groups', () => {
    renderWithProviders(<PhaseTimeline currentStatus="DRAFT" />)
    expect(screen.getByText('Planning')).toBeInTheDocument()
    expect(screen.getByText('PRD')).toBeInTheDocument()
    expect(screen.getByText('Beads')).toBeInTheDocument()
    expect(screen.getByText('Execution')).toBeInTheDocument()
  })

  it('shows Draft as active when currentStatus is DRAFT', () => {
    renderWithProviders(<PhaseTimeline currentStatus="DRAFT" />)
    // Planning group should be auto-expanded for DRAFT
    expect(screen.getByText('Draft')).toBeInTheDocument()
  })

  it('calls onSelectPhase when clicking a past phase', () => {
    const onSelect = vi.fn()
    renderWithProviders(<PhaseTimeline currentStatus="DRAFTING_PRD" onSelectPhase={onSelect} />)
    // Expand Planning group to see Draft
    fireEvent.click(screen.getByText('Planning'))
    fireEvent.click(screen.getByText('Draft'))
    expect(onSelect).toHaveBeenCalledWith('DRAFT')
  })

  it('disables future phases', () => {
    renderWithProviders(<PhaseTimeline currentStatus="DRAFT" />)
    // Expand Execution group to see Coding
    fireEvent.click(screen.getByText('Execution'))
    const codingBtn = screen.getByText('Coding').closest('button')
    expect(codingBtn).toBeDisabled()
  })

  it('shows all phase labels', () => {
    renderWithProviders(<PhaseTimeline currentStatus="CODING" />)
    // Planning group phases - expand to see them
    fireEvent.click(screen.getByText('Planning'))
    expect(screen.getByText('Interview Q&A')).toBeInTheDocument()
    // Execution group is auto-expanded since CODING is active
    expect(screen.getByText('Coding')).toBeInTheDocument()
    expect(screen.getByText('Final Test')).toBeInTheDocument()
  })
})
