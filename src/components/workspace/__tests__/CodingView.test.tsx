import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTicket } from '@/test/factories'
import type { LogContextValue, LogEntry } from '@/context/logUtils'
import type { Ticket } from '@/hooks/useTickets'

const { useLogsMock } = vi.hoisted(() => ({
  useLogsMock: vi.fn(),
}))

vi.mock('@/hooks/useTickets', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useTickets')>('@/hooks/useTickets')
  return {
    ...actual,
    useTicketAction: () => ({ mutate: vi.fn(), isPending: false }),
  }
})

vi.mock('@/context/useLogContext', () => ({
  useLogs: useLogsMock,
}))

vi.mock('../PhaseArtifactsPanel', () => ({
  PhaseArtifactsPanel: () => <div data-testid="phase-artifacts-panel" />,
}))

vi.mock('../CollapsiblePhaseLogSection', () => ({
  CollapsiblePhaseLogSection: () => <div data-testid="collapsible-log-section" />,
}))

vi.mock('../BeadDiffViewer', () => ({
  BeadDiffViewer: ({ beadId }: { beadId: string }) => <div data-testid="bead-diff-viewer">{beadId}</div>,
}))

vi.mock('../VerificationSummaryPanel', () => ({
  VerificationSummaryPanel: () => <div data-testid="verification-summary-panel" />,
}))

import { CodingView } from '../CodingView'

type CodingTestOverrides = Omit<Partial<Ticket>, 'runtime'> & {
  runtime?: Partial<Ticket['runtime']>
}

function renderCoding(overrides: CodingTestOverrides = {}) {
  const baseTicket = makeTicket({ status: 'CODING' })
  const ticket = makeTicket({
    ...baseTicket,
    ...overrides,
    runtime: {
      ...baseTicket.runtime,
      ...(overrides.runtime ?? {}),
    },
  })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <CodingView ticket={ticket} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify([]), { status: 200 }),
  )
  useLogsMock.mockReturnValue(null)
})

afterEach(() => {
  cleanup()
  fetchSpy.mockRestore()
})

describe('CodingView', () => {
  it('fetches full bead data even when runtime bead placeholders already exist', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([
        {
          id: 'bead-1',
          title: 'First',
          status: 'done',
          iteration: 1,
          description: 'Full bead details',
          acceptanceCriteria: ['Keeps bead data current'],
          tests: ['renders fresh details'],
          testCommands: ['npm test'],
          contextGuidance: { patterns: ['refresh bead state'], anti_patterns: [] },
          notes: ['updated'],
        },
      ]), { status: 200 }),
    )

    renderCoding({
      runtime: {
        baseBranch: 'main',
        currentBead: 1,
        completedBeads: 0,
        totalBeads: 1,
        percentComplete: 0,
        iterationCount: 0,
        maxIterations: null,
        artifactRoot: '/tmp/test',
        candidateCommitSha: null,
        preSquashHead: null,
        finalTestStatus: 'pending',
        beads: [
          { id: 'bead-1', title: 'First', status: 'pending', iteration: 0 },
        ],
      },
    })

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/tickets/1:TEST-1/beads')
    })
  })

  describe('status normalization', () => {
    it('maps server "done" status to completed (green icon)', () => {
      renderCoding({
        runtime: {
          baseBranch: 'main',
          currentBead: 1,
          completedBeads: 1,
          totalBeads: 2,
          percentComplete: 50,
          iterationCount: 0,
          maxIterations: null,
          artifactRoot: '/tmp/test',
          candidateCommitSha: null,
          preSquashHead: null,
          finalTestStatus: 'pending',
          beads: [
            { id: 'bead-1', title: 'First', status: 'done', iteration: 1 },
            { id: 'bead-2', title: 'Second', status: 'pending', iteration: 0 },
          ],
        },
      })

      const buttons = screen.getAllByRole('button')
      const beadBtn = buttons.find((b) => b.textContent?.includes('First'))
      expect(beadBtn).toBeDefined()
      // A "done" bead should render with green (completed) styling, not pending opacity
      expect(beadBtn!.className).toContain('green')
      expect(beadBtn!.className).not.toContain('opacity-70')
    })

    it('maps server "error" status to failed (red icon)', () => {
      renderCoding({
        runtime: {
          baseBranch: 'main',
          currentBead: 0,
          completedBeads: 0,
          totalBeads: 1,
          percentComplete: 0,
          iterationCount: 0,
          maxIterations: null,
          artifactRoot: '/tmp/test',
          candidateCommitSha: null,
          preSquashHead: null,
          finalTestStatus: 'pending',
          beads: [
            { id: 'bead-1', title: 'Broken', status: 'error', iteration: 2 },
          ],
        },
      })

      const buttons = screen.getAllByRole('button')
      const beadBtn = buttons.find((b) => b.textContent?.includes('Broken'))
      expect(beadBtn).toBeDefined()
      expect(beadBtn!.className).toContain('red')
    })
  })

  describe('adaptive grid layout', () => {
    it('renders chips with titles for small bead count (≤15)', () => {
      renderCoding({
        runtime: {
          baseBranch: 'main',
          currentBead: 1,
          completedBeads: 0,
          totalBeads: 3,
          percentComplete: 0,
          iterationCount: 0,
          maxIterations: null,
          artifactRoot: '/tmp/test',
          candidateCommitSha: null,
          preSquashHead: null,
          finalTestStatus: 'pending',
          beads: [
            { id: 'b-1', title: 'Alpha', status: 'done', iteration: 0 },
            { id: 'b-2', title: 'Beta', status: 'in_progress', iteration: 0 },
            { id: 'b-3', title: 'Gamma', status: 'pending', iteration: 0 },
          ],
        },
      })

      // Titles should be visible in chip mode
      expect(screen.getAllByText('Alpha').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('Beta').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('Gamma').length).toBeGreaterThanOrEqual(1)
    })

    it('renders compact numbered grid for large bead count (>15)', () => {
      const beads = Array.from({ length: 20 }, (_, i) => ({
        id: `bead-${i + 1}`,
        title: `Bead number ${i + 1}`,
        status: i < 5 ? 'done' : 'pending',
        iteration: 0,
      }))

      renderCoding({
        runtime: {
          baseBranch: 'main',
          currentBead: 5,
          completedBeads: 5,
          totalBeads: 20,
          percentComplete: 25,
          iterationCount: 0,
          maxIterations: null,
          artifactRoot: '/tmp/test',
          candidateCommitSha: null,
          preSquashHead: null,
          finalTestStatus: 'pending',
          beads,
        },
      })

      // In compact mode, numbered squares are shown instead of titles
      expect(screen.getByText('1')).toBeTruthy()
      expect(screen.getByText('20')).toBeTruthy()
      // Full titles should NOT be directly visible as text content (only as tooltip)
      expect(screen.queryByText('Bead number 1')).toBeNull()
    })

    it('shows progress summary with done count', () => {
      renderCoding({
        runtime: {
          baseBranch: 'main',
          currentBead: 2,
          completedBeads: 2,
          totalBeads: 5,
          percentComplete: 40,
          iterationCount: 0,
          maxIterations: null,
          artifactRoot: '/tmp/test',
          candidateCommitSha: null,
          preSquashHead: null,
          finalTestStatus: 'pending',
          beads: [
            { id: 'b-1', title: 'A', status: 'done', iteration: 0 },
            { id: 'b-2', title: 'B', status: 'done', iteration: 0 },
            { id: 'b-3', title: 'C', status: 'in_progress', iteration: 0 },
            { id: 'b-4', title: 'D', status: 'pending', iteration: 0 },
            { id: 'b-5', title: 'E', status: 'pending', iteration: 0 },
          ],
        },
      })

      // The progress summary shows "X/Y done"
      expect(screen.getAllByText('done').length).toBeGreaterThanOrEqual(1)
      // Check summary line shows done count
      const summaryElements = screen.getAllByText('2/5')
      expect(summaryElements.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('renders persisted bead notes from string storage and shows the active iteration label', () => {
    renderCoding({
      runtime: {
        activeBeadId: 'bead-1',
        activeBeadIteration: 2,
        maxIterationsPerBead: 5,
        beads: [
          { id: 'bead-1', title: 'Retry bead', status: 'error', iteration: 2, notes: 'first note\n\n---\n\nsecond note' },
        ],
      },
    })

    expect(screen.getByText(/Retry bead · Iteration 2\/5/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Retry bead/ }))

    expect(screen.getByText(/first note/)).toBeTruthy()
    expect(screen.getByText(/second note/)).toBeTruthy()
  })

  it('overlays live runtime retry metadata onto stale fetched bead details', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([
        {
          id: 'bead-1',
          title: 'Retry bead',
          status: 'in_progress',
          iteration: 1,
          description: 'Full bead details',
          notes: '',
        },
      ]), { status: 200 }),
    )

    const baseTicket = makeTicket({
      status: 'CODING',
      runtime: {
        ...makeTicket().runtime,
        totalBeads: 1,
        currentBead: 1,
        activeBeadId: 'bead-1',
        activeBeadIteration: 1,
        beads: [
          { id: 'bead-1', title: 'Retry bead', status: 'in_progress', iteration: 1, notes: '' },
        ],
      },
    })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <TooltipProvider>
          <CodingView ticket={baseTicket} />
        </TooltipProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/tickets/1:TEST-1/beads')
    })

    fireEvent.click(screen.getByRole('button', { name: /Retry bead/ }))

    const updatedTicket = makeTicket({
      ...baseTicket,
      runtime: {
        ...baseTicket.runtime,
        activeBeadIteration: 2,
        beads: [
          {
            id: 'bead-1',
            title: 'Retry bead',
            status: 'error',
            iteration: 2,
            notes: 'retry note after timeout',
          },
        ],
      },
    })

    rerender(
      <QueryClientProvider client={qc}>
        <TooltipProvider>
          <CodingView ticket={updatedTicket} />
        </TooltipProvider>
      </QueryClientProvider>,
    )

    expect(screen.getByText(/Retry bead · Iteration 2/)).toBeTruthy()
    expect(screen.getAllByText('2x').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/iteration 2/i).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/retry note after timeout/i)).toBeTruthy()
    expect(
      fetchSpy.mock.calls.filter(([url]: any) => url === '/api/tickets/1:TEST-1/beads'),
    ).toHaveLength(1)
  })

  it('shows the full non-debug bead transcript in the Log tab', () => {
    const beadLogs: LogEntry[] = [
      {
        id: '1',
        entryId: 'cmd-1',
        line: '[CMD] $ git status  →  ok',
        source: 'system',
        status: 'CODING',
        audience: 'all',
        kind: 'milestone',
        beadId: 'bead-1',
        streaming: false,
        op: 'append',
      },
      {
        id: '2',
        entryId: 'prompt-1',
        line: '[PROMPT] openai/gpt-5.4 prompt #1',
        source: 'model:openai/gpt-5.4',
        status: 'CODING',
        audience: 'ai',
        kind: 'prompt',
        modelId: 'openai/gpt-5.4',
        sessionId: 'session-1',
        beadId: 'bead-1',
        streaming: false,
        op: 'append',
      },
      {
        id: '3',
        entryId: 'think-1',
        line: 'Checking the failing test output.',
        source: 'model:openai/gpt-5.4',
        status: 'CODING',
        audience: 'ai',
        kind: 'reasoning',
        modelId: 'openai/gpt-5.4',
        sessionId: 'session-1',
        beadId: 'bead-1',
        streaming: false,
        op: 'finalize',
      },
      {
        id: '4',
        entryId: 'debug-1',
        line: '[DEBUG] hidden debug row',
        source: 'debug',
        status: 'CODING',
        audience: 'debug',
        kind: 'milestone',
        beadId: 'bead-1',
        streaming: false,
        op: 'append',
      },
    ]

    const logContext: LogContextValue = {
      logsByPhase: { CODING: beadLogs },
      activePhase: 'CODING',
      isLoadingLogs: false,
      addLog: vi.fn(),
      addLogRecord: vi.fn(),
      getLogsForPhase: vi.fn(() => beadLogs),
      getAllLogs: vi.fn(() => beadLogs),
      setActivePhase: vi.fn(),
      clearLogs: vi.fn(),
    }
    useLogsMock.mockReturnValue(logContext)

    renderCoding({
      runtime: {
        beads: [
          { id: 'bead-1', title: 'Logged bead', status: 'done', iteration: 1 },
        ],
      },
    })

    fireEvent.click(screen.getByRole('button', { name: /Logged bead/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Log' }))

    expect(screen.getByText((content) => content.includes('git status') && content.includes('ok'))).toBeTruthy()
    expect(screen.getByText((content) => content.includes('prompt #1'))).toBeTruthy()
    expect(screen.getByText(/Checking the failing test output/)).toBeTruthy()
    expect(screen.queryByText(/hidden debug row/)).toBeNull()
  })

  it('keeps blocked coding reviews on the interrupted bead progress instead of forcing completion', () => {
    const blockedTicket = makeTicket({
      status: 'BLOCKED_ERROR',
      previousStatus: 'CODING',
      reviewCutoffStatus: 'CODING',
      errorMessage: 'Bead failed after max retries.',
      runtime: {
        ...makeTicket().runtime,
        currentBead: 2,
        totalBeads: 18,
        percentComplete: 11,
        activeBeadId: 'bead-2',
        activeBeadIteration: 5,
        maxIterationsPerBead: 5,
        beads: [
          {
            id: 'bead-2',
            title: 'Add show_matched_attributes to GET query struct',
            status: 'error',
            iteration: 5,
            notes: 'retry note',
          },
        ],
      },
    })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <TooltipProvider>
          <CodingView ticket={blockedTicket} readOnly />
        </TooltipProvider>
      </QueryClientProvider>,
    )

    expect(screen.queryByText('Completed Successfully')).toBeNull()
    expect(screen.getByText('Implementing (Bead 2/18)')).toBeTruthy()
    expect(screen.getByText('2/18')).toBeTruthy()
    expect(screen.queryByText('18/18')).toBeNull()
    expect(screen.getByText(/Add show_matched_attributes to GET query struct · Iteration 5\/5/)).toBeTruthy()
  })

  it('keeps completed coding reviews marked complete after coding already advanced past execution', () => {
    const completedCodingTicket = makeTicket({
      status: 'WAITING_PR_REVIEW',
      runtime: {
        ...makeTicket().runtime,
        currentBead: 3,
        totalBeads: 3,
        percentComplete: 100,
      },
    })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <TooltipProvider>
          <CodingView ticket={completedCodingTicket} readOnly />
        </TooltipProvider>
      </QueryClientProvider>,
    )

    expect(screen.getByText('Completed Successfully')).toBeTruthy()
    expect(screen.getAllByText('3/3').length).toBeGreaterThanOrEqual(1)
  })

  describe('WAITING_PR_REVIEW', () => {
    it('renders VerificationSummaryPanel when status is WAITING_PR_REVIEW', () => {
      renderCoding({
        status: 'WAITING_PR_REVIEW',
        runtime: {
          baseBranch: 'main',
          currentBead: 3,
          completedBeads: 3,
          totalBeads: 3,
          percentComplete: 100,
          iterationCount: 0,
          maxIterations: null,
          artifactRoot: '/tmp/test',
          candidateCommitSha: 'abc123',
          preSquashHead: 'old789',
          finalTestStatus: 'passed',
          prNumber: 42,
          prUrl: 'https://github.com/test/repo/pull/42',
          prState: 'draft',
          prHeadSha: 'abc123',
          beads: [],
        },
      })

      expect(screen.getByTestId('verification-summary-panel')).toBeTruthy()
    })

    it('does not render VerificationSummaryPanel for CODING status', () => {
      renderCoding({
        status: 'CODING',
        runtime: {
          baseBranch: 'main',
          currentBead: 1,
          completedBeads: 0,
          totalBeads: 3,
          percentComplete: 0,
          iterationCount: 0,
          maxIterations: null,
          artifactRoot: '/tmp/test',
          candidateCommitSha: null,
          preSquashHead: null,
          finalTestStatus: 'pending',
          beads: [],
        },
      })

      expect(screen.queryByTestId('verification-summary-panel')).toBeNull()
    })

    it('does not render VerificationSummaryPanel in readOnly mode', () => {
      const baseTicket = makeTicket({
        status: 'WAITING_PR_REVIEW',
        runtime: {
          baseBranch: 'main',
          currentBead: 3,
          completedBeads: 3,
          totalBeads: 3,
          percentComplete: 100,
          iterationCount: 0,
          maxIterations: null,
          maxIterationsPerBead: null,
          activeBeadId: null,
          activeBeadIteration: null,
          lastFailedBeadId: null,
          artifactRoot: '/tmp/test',
          candidateCommitSha: 'abc123',
          preSquashHead: 'old789',
          finalTestStatus: 'passed',
          prNumber: 42,
          prUrl: 'https://github.com/test/repo/pull/42',
          prState: 'draft',
          prHeadSha: 'abc123',
          beads: [],
        },
      })
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      render(
        <QueryClientProvider client={qc}>
          <TooltipProvider>
            <CodingView ticket={baseTicket} readOnly />
          </TooltipProvider>
        </QueryClientProvider>,
      )

      expect(screen.queryByTestId('verification-summary-panel')).toBeNull()
    })
  })
})
