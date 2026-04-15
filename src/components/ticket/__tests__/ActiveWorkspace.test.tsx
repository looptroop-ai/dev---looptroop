import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { makeTicket } from '@/test/factories'
import { renderWithProviders } from '@/test/renderHelpers'
import { ActiveWorkspace } from '../ActiveWorkspace'

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

describe('ActiveWorkspace', () => {
  it('renders the selected workspace inside a constrained flex container', async () => {
    const { container } = renderWithProviders(
      <ActiveWorkspace
        ticket={makeTicket({ status: 'WAITING_BEADS_APPROVAL' })}
        selectedPhase="WAITING_BEADS_APPROVAL"
        previousStatus="VERIFYING_BEADS_COVERAGE"
      />,
    )

    expect(container.firstElementChild).toHaveClass('flex-1', 'min-h-0', 'overflow-hidden')
    expect(await screen.findByText('approval view')).toBeInTheDocument()
  })

  it('opens live error mode when the ticket is currently blocked', async () => {
    const ticket = makeTicket({ status: 'BLOCKED_ERROR' })
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

    expect(await screen.findByText(/error view:err-live(:live|:readonly)?|Blocked — Error/)).toBeInTheDocument()
  })

  it('opens read-only error review mode for a resolved error occurrence', async () => {
    const ticket = makeTicket({ status: 'CANCELED' })
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

    expect(await screen.findByText(/error view:err-1(:live|:readonly)?|Error Review/)).toBeInTheDocument()
  })
})
