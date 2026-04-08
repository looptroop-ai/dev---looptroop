import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTicket } from '@/test/factories'
import type { Ticket } from '@/hooks/useTickets'

vi.mock('@/hooks/useTickets', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useTickets')>('@/hooks/useTickets')
  return {
    ...actual,
    useTicketAction: () => ({ mutate: vi.fn(), isPending: false }),
  }
})

vi.mock('../PhaseArtifactsPanel', () => ({
  PhaseArtifactsPanel: () => <div data-testid="phase-artifacts-panel" />,
}))

vi.mock('../CollapsiblePhaseLogSection', () => ({
  CollapsiblePhaseLogSection: () => <div data-testid="collapsible-log-section" />,
}))

vi.mock('../BeadDiffViewer', () => ({
  BeadDiffViewer: ({ beadId }: { beadId: string }) => <div data-testid="bead-diff-viewer">{beadId}</div>,
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
      <CodingView ticket={ticket} />
    </QueryClientProvider>,
  )
}

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify([]), { status: 200 }),
  )
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
})
