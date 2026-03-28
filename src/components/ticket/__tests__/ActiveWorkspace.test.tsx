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
  ErrorView: () => <div>error view</div>,
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
  it('opens review mode for blocked error logs after a canceled-from-error transition', () => {
    const ticket = makeTicket('CANCELED')

    renderWithProviders(
      <ActiveWorkspace
        ticket={ticket}
        selectedPhase="BLOCKED_ERROR"
        previousStatus="BLOCKED_ERROR"
        reviewCutoffStatus="CODING"
      />,
    )

    expect(screen.getByText('review:BLOCKED_ERROR')).toBeInTheDocument()
    expect(screen.queryByText('canceled view')).not.toBeInTheDocument()
    expect(screen.queryByText('error view')).not.toBeInTheDocument()
  })

  it('opens review mode for the pre-error phase after a canceled-from-error transition', () => {
    const ticket = makeTicket('CANCELED')

    renderWithProviders(
      <ActiveWorkspace
        ticket={ticket}
        selectedPhase="CODING"
        previousStatus="BLOCKED_ERROR"
        reviewCutoffStatus="CODING"
      />,
    )

    expect(screen.getByText('review:CODING')).toBeInTheDocument()
  })
})
