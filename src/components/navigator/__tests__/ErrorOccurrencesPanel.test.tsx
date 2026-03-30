import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Ticket } from '@/hooks/useTickets'
import { ErrorOccurrencesPanel } from '../ErrorOccurrencesPanel'

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: '1:T-42',
    externalId: 'T-42',
    projectId: 1,
    title: 'Inspect hidden errors',
    description: null,
    priority: 3,
    status: 'BLOCKED_ERROR',
    xstateSnapshot: null,
    branchName: null,
    currentBead: null,
    totalBeads: null,
    percentComplete: null,
    errorMessage: 'The worker crashed.',
    errorSeenSignature: null,
    errorOccurrences: [],
    activeErrorOccurrenceId: null,
    hasPastErrors: false,
    lockedMainImplementer: null,
    lockedCouncilMembers: ['openai/gpt-5-mini'],
    availableActions: [],
    previousStatus: 'CODING',
    reviewCutoffStatus: null,
    runtime: {
      baseBranch: 'main',
      currentBead: 0,
      completedBeads: 0,
      totalBeads: 0,
      percentComplete: 0,
      iterationCount: 0,
      maxIterations: null,
      artifactRoot: '/tmp/ticket',
      beads: [],
      candidateCommitSha: null,
      preSquashHead: null,
      finalTestStatus: 'pending',
    },
    startedAt: null,
    plannedDate: null,
    createdAt: '2026-03-11T10:00:00.000Z',
    updatedAt: '2026-03-11T10:15:00.000Z',
    ...overrides,
  }
}

describe('ErrorOccurrencesPanel', () => {
  it('keeps historical errors collapsed by default', () => {
    const ticket = makeTicket({
      status: 'CANCELED',
      errorOccurrences: [
        {
          id: 'error-1',
          occurrenceNumber: 1,
          blockedFromStatus: 'CODING',
          errorMessage: 'First crash',
          errorCodes: [],
          occurredAt: '2026-03-11T10:10:00.000Z',
          resolvedAt: '2026-03-11T10:11:00.000Z',
          resolutionStatus: 'RETRIED',
          resumedToStatus: 'REFINING_PRD',
        },
      ],
      activeErrorOccurrenceId: null,
      hasPastErrors: true,
    })

    render(
      <ErrorOccurrencesPanel
        ticket={ticket}
        selectedErrorOccurrenceId={null}
        onSelectErrorOccurrence={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /errors/i })).toBeInTheDocument()
    expect(screen.queryByText('Error 1 — Implementing (Bead ?/?)')).not.toBeInTheDocument()
  })

  it('auto-expands for a live blocked ticket and lists all errors in one section', () => {
    const onSelect = vi.fn()
    const ticket = makeTicket({
      errorOccurrences: [
        {
          id: 'error-1',
          occurrenceNumber: 1,
          blockedFromStatus: 'CODING',
          errorMessage: 'First crash',
          errorCodes: ['E1'],
          occurredAt: '2026-03-11T10:10:00.000Z',
          resolvedAt: '2026-03-11T10:11:00.000Z',
          resolutionStatus: 'RETRIED',
          resumedToStatus: 'REFINING_PRD',
        },
        {
          id: 'error-2',
          occurrenceNumber: 2,
          blockedFromStatus: 'REFINING_PRD',
          errorMessage: 'Second crash',
          errorCodes: ['E2'],
          occurredAt: '2026-03-11T10:15:00.000Z',
          resolvedAt: null,
          resolutionStatus: null,
          resumedToStatus: null,
        },
      ],
      activeErrorOccurrenceId: 'error-2',
    })

    render(
      <ErrorOccurrencesPanel
        ticket={ticket}
        selectedErrorOccurrenceId={null}
        onSelectErrorOccurrence={onSelect}
      />,
    )

    expect(screen.getByRole('button', { name: /errors/i })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Error 2 — Refining Specs')).toBeInTheDocument()
    expect(screen.getByText('Error 1 — Implementing (Bead ?/?)')).toBeInTheDocument()
    expect(screen.queryByText('Current')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /past errors/i })).not.toBeInTheDocument()

    const pastError = screen.getByRole('button', { name: /error 1/i })
    fireEvent.click(pastError)

    expect(onSelect).toHaveBeenCalledWith('error-1')
  })

  it('auto-expands when a resolved occurrence is selected', () => {
    const ticket = makeTicket({
      status: 'CANCELED',
      errorOccurrences: [
        {
          id: 'error-1',
          occurrenceNumber: 1,
          blockedFromStatus: 'CODING',
          errorMessage: 'First crash',
          errorCodes: [],
          occurredAt: '2026-03-11T10:10:00.000Z',
          resolvedAt: '2026-03-11T10:11:00.000Z',
          resolutionStatus: 'RETRIED',
          resumedToStatus: 'REFINING_PRD',
        },
      ],
      activeErrorOccurrenceId: null,
      hasPastErrors: true,
    })

    render(
      <ErrorOccurrencesPanel
        ticket={ticket}
        selectedErrorOccurrenceId="error-1"
        onSelectErrorOccurrence={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /errors/i })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Error 1 — Implementing (Bead ?/?)')).toBeInTheDocument()
  })
})
