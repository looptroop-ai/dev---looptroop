import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorView } from '../ErrorView'

const mutateMock = vi.fn()
const useLogsMock = vi.fn()

vi.mock('@/hooks/useTickets', () => ({
  useTicketAction: () => ({ mutate: mutateMock, isPending: false }),
}))

vi.mock('@/context/LogContext', () => ({
  useLogs: () => useLogsMock(),
}))

vi.mock('@/components/workspace/PhaseLogPanel', () => ({
  PhaseLogPanel: ({ phase, logs }: { phase: string; logs?: Array<{ line: string }> }) => (
    <div data-testid="phase-log-panel" data-phase={phase}>
      {(logs ?? []).map(entry => entry.line).join(' | ')}
    </div>
  ),
}))

function makeTicket(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    externalId: 'LOOP-42',
    projectId: 7,
    title: 'Broken ticket',
    description: null,
    priority: 3,
    status: 'BLOCKED_ERROR',
    xstateSnapshot: JSON.stringify({ context: { previousStatus: 'CODING' } }),
    branchName: null,
    currentBead: null,
    totalBeads: null,
    percentComplete: null,
    errorMessage: 'OpenCode timed out',
    lockedMainImplementer: null,
    lockedCouncilMembers: null,
    startedAt: null,
    plannedDate: null,
    createdAt: '2026-03-06T10:00:00.000Z',
    updatedAt: '2026-03-06T10:05:00.000Z',
    ...overrides,
  }
}

describe('ErrorView', () => {
  beforeEach(() => {
    mutateMock.mockReset()
    useLogsMock.mockReset()
  })

  it('shows the persisted ticket error message', () => {
    useLogsMock.mockReturnValue({
      getLogsForPhase: () => [],
    })

    render(<ErrorView ticket={makeTicket()} />)

    expect(screen.getByText('OpenCode timed out')).toBeInTheDocument()
  })

  it('merges logs from the failed phase with BLOCKED_ERROR logs', () => {
    useLogsMock.mockReturnValue({
      getLogsForPhase: (phase: string) => {
        if (phase === 'CODING') {
          return [{
            line: '[ERROR] OpenCode timed out',
            source: 'error',
            status: 'CODING',
            timestamp: '2026-03-06T10:01:00.000Z',
          }]
        }
        if (phase === 'BLOCKED_ERROR') {
          return [{
            line: '[ERROR] [APP] Blocked in CODING: OpenCode timed out',
            source: 'error',
            status: 'BLOCKED_ERROR',
            timestamp: '2026-03-06T10:01:05.000Z',
          }]
        }
        return []
      },
    })

    render(<ErrorView ticket={makeTicket()} />)

    const panel = screen.getByTestId('phase-log-panel')
    expect(panel).toHaveAttribute('data-phase', 'BLOCKED_ERROR')
    expect(panel.textContent).toContain('[ERROR] OpenCode timed out')
    expect(panel.textContent).toContain('[ERROR] [APP] Blocked in CODING: OpenCode timed out')
  })
})
