import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/renderHelpers'
import { TEST } from '@/test/factories'
import { ContextTree } from '../ContextTree'

describe('ContextTree', () => {
  it('shows Drafting PRD as two context parts', () => {
    renderWithProviders(<ContextTree selectedPhase="DRAFTING_PRD" ticketId={TEST.ticketId} />)

    fireEvent.click(screen.getByRole('button', { name: /context & output/i }))

    expect(screen.getByText('Allowed Context')).toBeInTheDocument()
    expect(screen.getByText('Part 1')).toBeInTheDocument()
    expect(screen.getByText(/Answering Skipped Questions/)).toBeInTheDocument()
    expect(screen.getByText('Part 2')).toBeInTheDocument()
    expect(screen.getByText(/Generating PRD Drafts/)).toBeInTheDocument()
    expect(screen.getAllByText('Relevant Files')).toHaveLength(2)
    expect(screen.getAllByText('Ticket Details')).toHaveLength(2)
    expect(screen.getByText('Interview Results')).toBeInTheDocument()
    expect(screen.getAllByText('Full Answers')).toHaveLength(2)
    expect(screen.getByText('Output')).toBeInTheDocument()
    expect(screen.getByText('PRD Drafts')).toBeInTheDocument()
  })

  it('shows Beads coverage as review followed by final expansion', () => {
    renderWithProviders(<ContextTree selectedPhase="VERIFYING_BEADS_COVERAGE" ticketId={TEST.ticketId} />)

    fireEvent.click(screen.getByRole('button', { name: /context & output/i }))

    expect(screen.getByText('Part 1')).toBeInTheDocument()
    expect(screen.getByText(/Coverage Review/)).toBeInTheDocument()
    expect(screen.getByText('Part 2')).toBeInTheDocument()
    expect(screen.getByText(/Final Expansion/)).toBeInTheDocument()
    expect(screen.getAllByText('PRD')).toHaveLength(2)
    expect(screen.getAllByText('Beads Plan')).toHaveLength(2)
    expect(screen.getAllByText('Semantic Blueprint')).toHaveLength(2)
    expect(screen.getByText('Relevant Files')).toBeInTheDocument()
    expect(screen.getByText('Ticket Details')).toBeInTheDocument()
    expect(screen.getByText('Output')).toBeInTheDocument()
    expect(screen.getByTitle('Execution-ready tasks for approval.')).toBeInTheDocument()
  })

  it('uses curated output labels for council drafting', () => {
    renderWithProviders(<ContextTree selectedPhase="COUNCIL_DELIBERATING" ticketId={TEST.ticketId} />)

    fireEvent.click(screen.getByRole('button', { name: /context & output/i }))

    expect(screen.getByText('Interview Drafts')).toBeInTheDocument()
    expect(screen.getByTitle('Candidate question sets for voting.')).toBeInTheDocument()
    expect(screen.queryByText('Pull Request')).toBeNull()
  })

  it('shows the selected winner as the voting output', () => {
    renderWithProviders(<ContextTree selectedPhase="COUNCIL_VOTING_INTERVIEW" ticketId={TEST.ticketId} />)

    fireEvent.click(screen.getByRole('button', { name: /context & output/i }))

    expect(screen.getByText('Winning Draft')).toBeInTheDocument()
    expect(screen.getByTitle('Selected draft used to build the interview.')).toBeInTheDocument()
    expect(screen.queryByText('Council Votes')).toBeNull()
  })
})
