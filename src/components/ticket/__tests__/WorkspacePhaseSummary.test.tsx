import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makeTicket } from '@/test/factories'
import { renderWithProviders } from '@/test/renderHelpers'
import { WorkspacePhaseSummary } from '../WorkspacePhaseSummary'

describe('WorkspacePhaseSummary', () => {
  it('renders the phase description and opens detailed status copy', () => {
    const ticket = makeTicket({ status: 'DRAFTING_PRD' })

    renderWithProviders(
      <WorkspacePhaseSummary phase="DRAFTING_PRD" ticket={ticket} />,
    )

    expect(screen.getByText('Models produce competing PRD drafts.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /show detailed explanation for drafting specs/i }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('LoopTroop loads the approved interview, ticket details, and relevant-files context into the PRD drafting prompt.')).toBeInTheDocument()
    expect(screen.getByText('Competing PRD drafts.')).toBeInTheDocument()
    expect(screen.getByText('When enough valid PRD drafts are ready, the workflow advances to Voting on Specs.')).toBeInTheDocument()
  })

  it('collapses and re-expands the description when clicking the phase name', () => {
    const ticket = makeTicket({ status: 'DRAFTING_PRD' })

    renderWithProviders(
      <WorkspacePhaseSummary phase="DRAFTING_PRD" ticket={ticket} />,
    )

    const toggle = screen.getByRole('button', { name: 'Drafting Specs' })
    expect(screen.getByText('Models produce competing PRD drafts.')).toBeInTheDocument()

    fireEvent.click(toggle)
    expect(screen.queryByText('Models produce competing PRD drafts.')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(screen.getByText('Models produce competing PRD drafts.')).toBeInTheDocument()
  })

  it('uses the error reason when rendering the blocked-error label', () => {
    const ticket = makeTicket({ status: 'BLOCKED_ERROR' })

    renderWithProviders(
      <WorkspacePhaseSummary
        phase="BLOCKED_ERROR"
        ticket={ticket}
        errorMessage="The runner crashed while executing bead B-12."
      />,
    )

    expect(screen.getByText(/Error \(The runner crashed while executing bead B-12\.\)/)).toBeInTheDocument()
    expect(screen.getByText('A blocking error requires retry or cancel.')).toBeInTheDocument()
  })
})
