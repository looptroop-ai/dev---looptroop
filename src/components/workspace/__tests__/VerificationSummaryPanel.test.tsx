import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTicket } from '@/test/factories'

const useTicketArtifactsMock = vi.fn<
  () => {
    artifacts: Array<{ id: string; phase: string; artifactType: string; content: string }>
    isLoading: boolean
  }
>(() => ({ artifacts: [], isLoading: false }))

vi.mock('@/hooks/useTicketArtifacts', () => ({
  useTicketArtifacts: () => useTicketArtifactsMock(),
}))

import { VerificationSummaryPanel } from '../VerificationSummaryPanel'

function renderPanel(
  overrides: Parameters<typeof makeTicket>[0] = {},
  actions = { onVerify: vi.fn(), onCancel: vi.fn(), isPending: false },
) {
  const ticket = makeTicket({
    status: 'WAITING_MANUAL_VERIFICATION',
    branchName: 'feat/test-branch',
    ...overrides,
    runtime: {
      baseBranch: 'main',
      currentBead: 5,
      completedBeads: 5,
      totalBeads: 5,
      percentComplete: 100,
      iterationCount: 0,
      maxIterations: null,
      maxIterationsPerBead: null,
      activeBeadId: null,
      activeBeadIteration: null,
      lastFailedBeadId: null,
      artifactRoot: '/tmp/test',
      candidateCommitSha: 'abc123def456',
      preSquashHead: 'old789hash',
      finalTestStatus: 'passed',
      beads: [],
      ...(overrides as Record<string, unknown>).runtime as Record<string, unknown> ?? {},
    },
  })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    ...render(
      <QueryClientProvider client={qc}>
        <VerificationSummaryPanel ticket={ticket} {...actions} />
      </QueryClientProvider>,
    ),
    ...actions,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useTicketArtifactsMock.mockReturnValue({ artifacts: [], isLoading: false })
})

afterEach(() => {
  cleanup()
})

describe('VerificationSummaryPanel', () => {
  it('renders the verification header', () => {
    renderPanel()
    expect(screen.getByText('Manual Verification Required')).toBeTruthy()
  })

  it('shows branch name and base branch', () => {
    renderPanel()
    expect(screen.getByText('feat/test-branch')).toBeTruthy()
    expect(screen.getByText('main')).toBeTruthy()
  })

  it('shows candidate commit SHA (truncated)', () => {
    renderPanel()
    expect(screen.getByText('abc123de')).toBeTruthy()
  })

  it('shows tests passed badge when finalTestStatus is passed', () => {
    renderPanel()
    expect(screen.getByText('Passed')).toBeTruthy()
  })

  it('shows tests failed badge when finalTestStatus is failed', () => {
    renderPanel({ runtime: { finalTestStatus: 'failed' } } as Parameters<typeof makeTicket>[0])
    expect(screen.getByText('Failed')).toBeTruthy()
  })

  it('shows beads completion count', () => {
    renderPanel()
    expect(screen.getByText('5')).toBeTruthy()
    expect(screen.getByText('/5')).toBeTruthy()
  })

  it('calls onVerify when Mark Verified is clicked', () => {
    const onVerify = vi.fn()
    renderPanel({}, { onVerify, onCancel: vi.fn(), isPending: false })
    fireEvent.click(screen.getByText('Mark Verified'))
    expect(onVerify).toHaveBeenCalledOnce()
  })

  it('calls onCancel when Cancel is clicked', () => {
    const onCancel = vi.fn()
    renderPanel({}, { onVerify: vi.fn(), onCancel, isPending: false })
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('disables buttons when isPending is true', () => {
    renderPanel({}, { onVerify: vi.fn(), onCancel: vi.fn(), isPending: true })
    const verifyBtn = screen.getByText('Verifying').closest('button')
    const cancelBtn = screen.getByText('Cancel').closest('button')
    expect(verifyBtn?.disabled).toBe(true)
    expect(cancelBtn?.disabled).toBe(true)
  })

  it('falls back to externalId when branchName is null', () => {
    renderPanel({ branchName: null })
    expect(screen.getByText('TEST-1')).toBeTruthy()
  })

  it('shows that the remote branch rewrite is deferred until verification', () => {
    useTicketArtifactsMock.mockReturnValue({
      artifacts: [{
        id: 'integration',
        phase: 'INTEGRATING_CHANGES',
        artifactType: 'integration_report',
        content: JSON.stringify({ pushDeferred: true }),
      }],
      isLoading: false,
    })

    renderPanel()

    expect(screen.getByText(/remote ticket branch stays on the last bead backup/i)).toBeTruthy()
  })
})
