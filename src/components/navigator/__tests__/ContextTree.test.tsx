import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/renderHelpers'
import { TEST } from '@/test/factories'
import { ContextTree } from '../ContextTree'

describe('ContextTree', () => {
  it('shows Drafting PRD as two context parts', () => {
    renderWithProviders(<ContextTree selectedPhase="DRAFTING_PRD" ticketId={TEST.ticketId} />)

    fireEvent.click(screen.getByRole('button', { name: /allowed context/i }))

    expect(screen.getByText('Part 1')).toBeInTheDocument()
    expect(screen.getByText(/Answering Skipped Questions/)).toBeInTheDocument()
    expect(screen.getByText('Part 2')).toBeInTheDocument()
    expect(screen.getByText(/Generating PRD Drafts/)).toBeInTheDocument()
    expect(screen.getAllByText('Relevant Files')).toHaveLength(2)
    expect(screen.getAllByText('Ticket Details')).toHaveLength(2)
    expect(screen.getByText('Interview Results')).toBeInTheDocument()
    expect(screen.getByText('Full Answers')).toBeInTheDocument()
  })

  it('shows Beads coverage as review followed by final expansion', () => {
    renderWithProviders(<ContextTree selectedPhase="VERIFYING_BEADS_COVERAGE" ticketId={TEST.ticketId} />)

    fireEvent.click(screen.getByRole('button', { name: /allowed context/i }))

    expect(screen.getByText('Part 1')).toBeInTheDocument()
    expect(screen.getByText(/Coverage Review/)).toBeInTheDocument()
    expect(screen.getByText('Part 2')).toBeInTheDocument()
    expect(screen.getByText(/Final Expansion/)).toBeInTheDocument()
    expect(screen.getAllByText('PRD')).toHaveLength(2)
    expect(screen.getByText('Beads Plan')).toBeInTheDocument()
    expect(screen.getByText('Semantic Blueprint')).toBeInTheDocument()
    expect(screen.getByText('Relevant Files')).toBeInTheDocument()
    expect(screen.getByText('Ticket Details')).toBeInTheDocument()
  })
})
