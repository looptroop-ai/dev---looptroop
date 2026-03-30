import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Ticket } from '@/hooks/useTickets'
import { NavigatorPanel } from '../NavigatorPanel'

function renderWithProviders(ui: ReactElement) {
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

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: '1:T-42',
    externalId: 'T-42',
    projectId: 1,
    title: 'Inspect hidden errors',
    description: null,
    priority: 3,
    status: 'CANCELED',
    xstateSnapshot: null,
    branchName: null,
    currentBead: null,
    totalBeads: null,
    percentComplete: null,
    errorMessage: null,
    errorSeenSignature: null,
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

describe('NavigatorPanel', () => {
  it('renders the errors section after the timeline with a separator', () => {
    const { container } = renderWithProviders(
      <NavigatorPanel
        ticketId="1:T-42"
        ticket={makeTicket({ status: 'DRAFT' })}
        currentStatus="DRAFT"
        selectedPhase="DRAFT"
        selectedErrorOccurrenceId={null}
        onSelectPhase={vi.fn()}
        onSelectErrorOccurrence={vi.fn()}
        contextPhase="DRAFT"
      />,
    )

    const doneButton = screen.getByText('Done').closest('button')
    const errorsButton = screen.getByRole('button', { name: /errors/i })

    expect(doneButton).not.toBeNull()
    expect(doneButton!.compareDocumentPosition(errorsButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelector('[data-orientation="horizontal"]')).not.toBeNull()
  })
})
