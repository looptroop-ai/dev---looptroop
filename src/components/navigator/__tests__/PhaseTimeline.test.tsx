import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PhaseTimeline } from '../PhaseTimeline'
import { TooltipProvider } from '@/components/ui/tooltip'

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  )
}

describe('PhaseTimeline', () => {
  it('renders phase groups', () => {
    renderWithProviders(<PhaseTimeline currentStatus="DRAFT" />)
    expect(screen.getByText('To Do')).toBeInTheDocument()
    expect(screen.getByText('Interview')).toBeInTheDocument()
    expect(screen.getByText('Specs (PRD)')).toBeInTheDocument()
    expect(screen.getByText('Blueprint (Beads)')).toBeInTheDocument()
    expect(screen.getByText('Execution')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it('shows Draft as active when currentStatus is DRAFT', () => {
    renderWithProviders(<PhaseTimeline currentStatus="DRAFT" />)
    // Planning group should be auto-expanded for DRAFT
    expect(screen.getByText('Backlog')).toBeInTheDocument()
  })

  it('calls onSelectPhase when clicking a past phase', () => {
    const onSelect = vi.fn()
    renderWithProviders(<PhaseTimeline currentStatus="DRAFTING_PRD" onSelectPhase={onSelect} />)
    // Expand To Do group to see Backlog
    fireEvent.click(screen.getByText('To Do'))
    fireEvent.click(screen.getByText('Backlog'))
    expect(onSelect).toHaveBeenCalledWith('DRAFT')
  })

  it('disables future phases', () => {
    renderWithProviders(<PhaseTimeline currentStatus="DRAFT" />)
    // Expand Execution group to see Coding
    fireEvent.click(screen.getByText('Execution'))
    const codingBtn = screen.getByText(/Implementing \(Bead \?\/\?\)/).closest('button')
    expect(codingBtn).toBeDisabled()
  })

  it('shows all phase labels', () => {
    renderWithProviders(<PhaseTimeline currentStatus="CODING" />)
    // Interview group phases - expand to see waiting label
    fireEvent.click(screen.getByText('Interview'))
    expect(screen.getByText(/Interviewing/)).toBeInTheDocument()
    // Execution group is auto-expanded since CODING is active
    expect(screen.getByText(/Implementing \(Bead \?\/\?\)/)).toBeInTheDocument()
    expect(screen.getByText('Self-Testing')).toBeInTheDocument()
  })

  it('keeps the pre-error phase and BLOCKED_ERROR selectable after canceling from an error', () => {
    const onSelect = vi.fn()
    renderWithProviders(
      <PhaseTimeline
        currentStatus="CANCELED"
        previousStatus="BLOCKED_ERROR"
        reviewCutoffStatus="CODING"
        onSelectPhase={onSelect}
      />,
    )

    fireEvent.click(screen.getByText('Execution'))

    const codingBtn = screen.getByText(/Implementing \(Bead \?\/\?\)/).closest('button')
    const blockedErrorBtn = screen.getByText('Error (reason)').closest('button')
    const finalTestBtn = screen.getByText('Self-Testing').closest('button')

    expect(codingBtn).not.toBeDisabled()
    expect(blockedErrorBtn).not.toBeDisabled()
    expect(finalTestBtn).toBeDisabled()

    fireEvent.click(codingBtn!)
    fireEvent.click(blockedErrorBtn!)

    expect(onSelect).toHaveBeenCalledWith('CODING')
    expect(onSelect).toHaveBeenCalledWith('BLOCKED_ERROR')
  })

  it('keeps ordinary canceled tickets reviewable through their last working phase', () => {
    renderWithProviders(
      <PhaseTimeline
        currentStatus="CANCELED"
        previousStatus="CODING"
        reviewCutoffStatus="CODING"
      />,
    )

    fireEvent.click(screen.getByText('Execution'))

    expect(screen.getByText(/Implementing \(Bead \?\/\?\)/).closest('button')).not.toBeDisabled()
    expect(screen.getByText('Self-Testing').closest('button')).toBeDisabled()
  })

  it('preserves live BLOCKED_ERROR phase review behavior', () => {
    const onSelect = vi.fn()
    renderWithProviders(
      <PhaseTimeline
        currentStatus="BLOCKED_ERROR"
        previousStatus="CODING"
        reviewCutoffStatus="CODING"
        onSelectPhase={onSelect}
      />,
    )

    // Execution group is auto-expanded since BLOCKED_ERROR belongs there.
    const codingBtn = screen.getByText(/Implementing \(Bead \?\/\?\)/).closest('button')
    const finalTestBtn = screen.getByText('Self-Testing').closest('button')

    expect(codingBtn).not.toBeDisabled()
    expect(finalTestBtn).toBeDisabled()

    fireEvent.click(codingBtn!)
    expect(onSelect).toHaveBeenCalledWith('CODING')
  })
})
