import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CodingView } from '../CodingView'
import type { Ticket } from '@/hooks/useTickets'

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

const runtime: Ticket['runtime'] = {
  baseBranch: 'main',
  currentBead: 3,
  completedBeads: 3,
  totalBeads: 3,
  percentComplete: 100,
  iterationCount: 2,
  maxIterations: 5,
  artifactRoot: '/tmp/looptroop',
  beads: [
    { id: 'B-1', title: 'First bead', status: 'completed', iteration: 1 },
    { id: 'B-2', title: 'Second bead', status: 'completed', iteration: 1 },
    { id: 'B-3', title: 'Third bead', status: 'completed', iteration: 2 },
  ],
  candidateCommitSha: null,
  preSquashHead: null,
  finalTestStatus: 'pending',
}

describe('CodingView', () => {
  beforeEach(() => {
    mutateMock.mockReset()
  })

  it('shows a manual verification action and dispatches verify', () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })

    render(
      <QueryClientProvider client={queryClient}>
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
            lockedCouncilMembers: [],
            availableActions: ['verify', 'cancel'],
            previousStatus: 'INTEGRATING_CHANGES',
            runtime,
            startedAt: null,
            plannedDate: null,
            createdAt: '2026-03-08T09:19:47.110Z',
            updatedAt: '2026-03-08T09:23:56.000Z',
          }}
        />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Mark Verified' }))

    expect(
      screen.getByText(/Review the candidate commit on branch/i),
    ).toBeInTheDocument()
    expect(mutateMock).toHaveBeenCalledWith({ id: '1:BVR-1', action: 'verify' })
  })
})
