import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ActiveWorkspace } from '../ActiveWorkspace'
import type { Ticket } from '@/hooks/useTickets'

vi.mock('@/components/workspace/DraftView', () => ({
  DraftView: () => <div>draft view</div>,
}))

vi.mock('@/components/workspace/CouncilView', () => ({
  CouncilView: () => <div>council view</div>,
}))

vi.mock('@/components/workspace/InterviewQAView', () => ({
  InterviewQAView: () => <div>interview view</div>,
}))

vi.mock('@/components/workspace/ApprovalView', () => ({
  ApprovalView: () => <div>approval view</div>,
}))

vi.mock('@/components/workspace/CodingView', () => ({
  CodingView: () => <div>coding view</div>,
}))

vi.mock('@/components/workspace/ErrorView', () => ({
  ErrorView: ({
    occurrence,
    readOnly,
  }: {
    occurrence?: { id: string } | null
    readOnly?: boolean
  }) => (
    <div>error view:{occurrence?.id ?? 'live'}:{readOnly ? 'readonly' : 'live'}</div>
  ),
}))

vi.mock('@/components/workspace/DoneView', () => ({
  DoneView: () => <div>done view</div>,
}))

vi.mock('@/components/workspace/CanceledView', () => ({
  CanceledView: () => <div>canceled view</div>,
}))

vi.mock('@/components/workspace/PhaseReviewView', () => ({
  PhaseReviewView: ({ phase }: { phase: string }) => <div>review:{phase}</div>,
}))

vi.mock('@/hooks/useTicketArtifacts', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useTicketArtifacts')>('@/hooks/useTicketArtifacts')
  return {
    ...actual,
    useTicketArtifacts: () => ({ artifacts: [], isLoading: false }),
  }
})

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  )
}

function makeTicket(status: string): Ticket {
  return {
    id: '1:T-42',
    externalId: 'T-42',
    projectId: 1,
    title: 'Inspect canceled history',
    description: 'Review should stay available after cancel.',
    priority: 3,
    status,
    xstateSnapshot: null,
    branchName: null,
    currentBead: null,
    totalBeads: null,
    percentComplete: null,
    errorMessage: null,
    errorSeenSignature: null,
    errorOccurrences: [],
    activeErrorOccurrenceId: null,
    hasPastErrors: false,
    lockedMainImplementer: null,
    lockedCouncilMembers: ['openai/gpt-5-codex', 'openai/gpt-5-mini'],
    availableActions: [],
    previousStatus: null,
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
    updatedAt: '2026-03-11T10:00:00.000Z',
  }
}

describe('ActiveWorkspace', () => {
  it('opens live error mode when the ticket is currently blocked', () => {
    const ticket = makeTicket('BLOCKED_ERROR')
    ticket.errorOccurrences = [
      {
        id: 'err-live',
        occurrenceNumber: 1,
        blockedFromStatus: 'CODING',
        errorMessage: 'The runner crashed.',
        errorCodes: [],
        occurredAt: '2026-03-11T10:15:00.000Z',
        resolvedAt: null,
        resolutionStatus: null,
        resumedToStatus: null,
      },
    ]
    ticket.activeErrorOccurrenceId = 'err-live'

    renderWithProviders(
      <ActiveWorkspace
        ticket={ticket}
        selectedPhase="BLOCKED_ERROR"
        selectedErrorOccurrenceId="err-live"
        previousStatus="CODING"
        reviewCutoffStatus="CODING"
      />,
    )

    expect(screen.getByText(/error view:err-live(:live|:readonly)?|Blocked — Error/)).toBeInTheDocument()
  })

  it('opens read-only error review mode for a resolved error occurrence', () => {
    const ticket = makeTicket('CANCELED')
    ticket.errorOccurrences = [
      {
        id: 'err-1',
        occurrenceNumber: 1,
        blockedFromStatus: 'CODING',
        errorMessage: 'The runner crashed.',
        errorCodes: [],
        occurredAt: '2026-03-11T10:15:00.000Z',
        resolvedAt: '2026-03-11T10:20:00.000Z',
        resolutionStatus: 'RETRIED',
        resumedToStatus: 'REFINING_PRD',
      },
    ]
    ticket.hasPastErrors = true

    renderWithProviders(
      <ActiveWorkspace
        ticket={ticket}
        selectedPhase="CODING"
        selectedErrorOccurrenceId="err-1"
        previousStatus="BLOCKED_ERROR"
        reviewCutoffStatus="CODING"
      />,
    )

    expect(screen.getByText(/error view:err-1(:live|:readonly)?|Error Review/)).toBeInTheDocument()
  })
})
