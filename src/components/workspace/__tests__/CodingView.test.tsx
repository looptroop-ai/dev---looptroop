import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CodingView } from '../CodingView'

const mutateMock = vi.fn()

vi.mock('@/hooks/useTickets', () => ({
  useTicketAction: () => ({ mutate: mutateMock, isPending: false }),
}))

vi.mock('../PhaseArtifactsPanel', () => ({
  PhaseArtifactsPanel: () => <div>Artifacts</div>,
}))

vi.mock('../PhaseLogPanel', () => ({
  PhaseLogPanel: () => <div>Logs</div>,
}))

describe('CodingView', () => {
  beforeEach(() => {
    mutateMock.mockReset()
  })

  it('shows a manual verification action and dispatches verify', () => {
    render(
      <CodingView
        ticket={{
          id: '1:BVR-1',
          externalId: 'BVR-1',
          projectId: 1,
          title: 'Verify project-local storage end to end',
          description: null,
          priority: 3,
          status: 'WAITING_MANUAL_VERIFICATION',
          xstateSnapshot: null,
          branchName: 'BVR-1',
          currentBead: 3,
          totalBeads: 3,
          percentComplete: 100,
          errorMessage: null,
          lockedMainImplementer: null,
          lockedCouncilMembers: null,
          startedAt: null,
          plannedDate: null,
          createdAt: '2026-03-08T09:19:47.110Z',
          updatedAt: '2026-03-08T09:23:56.000Z',
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '✅ Mark Verified' }))

    expect(
      screen.getByText('Review the generated changes and mark the ticket verified to finish cleanup.'),
    ).toBeInTheDocument()
    expect(mutateMock).toHaveBeenCalledWith({ id: '1:BVR-1', action: 'verify' })
  })
})
