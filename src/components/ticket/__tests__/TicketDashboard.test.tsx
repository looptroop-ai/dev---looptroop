import type { ReactNode, Ref } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '@/lib/queryClient'
import { patchTicketStatusInCache } from '@/hooks/ticketStatusCache'
import type { Ticket } from '@/hooks/useTickets'
import { WORKSPACE_PHASE_NAVIGATE_EVENT } from '@/lib/workspaceNavigation'

const selectedTicketId = '1:T-42'
const dispatchMock = vi.fn()
let latestSSEOptions: {
  ticketId: string | null
  onEvent?: (event: { type: string; data: Record<string, unknown> }) => void
} | null = null

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({
    children,
    viewportRef,
    className,
  }: {
    children: ReactNode
    viewportRef?: Ref<HTMLDivElement>
    className?: string
  }) => (
    <div className={className}>
      <div ref={viewportRef} data-testid="log-viewport">
        {children}
      </div>
    </div>
  ),
}))

vi.mock('@/context/useUI', () => ({
  useUI: () => ({
    state: { selectedTicketId },
    dispatch: dispatchMock,
  }),
}))

vi.mock('@/hooks/useSSE', () => ({
  useSSE: (options: { ticketId: string | null; onEvent?: (event: { type: string; data: Record<string, unknown> }) => void }) => {
    latestSSEOptions = options
    return { lastEventIdRef: { current: '0' } }
  },
}))

vi.mock('@/hooks/useTickets', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useTickets')>('@/hooks/useTickets')
  return {
    ...actual,
    useSaveTicketUIState: () => ({ mutate: vi.fn() }),
  }
})

vi.mock('../DashboardHeader', () => ({
  DashboardHeader: ({ ticket }: { ticket: Ticket }) => <div data-testid="dashboard-header">{ticket.status}</div>,
}))

vi.mock('../ResizeHandle', () => ({
  ResizeHandle: () => <div data-testid="resize-handle" />,
}))

vi.mock('../ActiveWorkspace', () => ({
  ActiveWorkspace: ({ selectedPhase }: { selectedPhase: string }) => <div data-testid="active-workspace">{selectedPhase}</div>,
}))

vi.mock('../NavigatorPanel', () => ({
  NavigatorPanel: ({
    currentStatus,
    selectedPhase,
    selectedErrorOccurrenceId,
    onSelectPhase,
    onSelectErrorOccurrence,
    contextPhase,
  }: {
    currentStatus: string
    selectedPhase: string
    selectedErrorOccurrenceId?: string | null
    onSelectPhase: (phase: string | null) => void
    onSelectErrorOccurrence: (occurrenceId: string | null) => void
    contextPhase: string
  }) => (
    <div>
      <div data-testid="navigator-current">{currentStatus}</div>
      <div data-testid="navigator-selected">{selectedPhase}</div>
      <div data-testid="navigator-error">{selectedErrorOccurrenceId ?? ''}</div>
      <div data-testid="navigator-context">{contextPhase}</div>
      <button onClick={() => onSelectPhase('DRAFTING_PRD')}>Select drafting</button>
      <button onClick={() => onSelectErrorOccurrence('error-1')}>Select error</button>
      {(selectedPhase !== currentStatus || Boolean(selectedErrorOccurrenceId)) && (
        <button onClick={() => onSelectPhase(null)}>Back to live</button>
      )}
    </div>
  ),
}))

import { TicketDashboard } from '../TicketDashboard'

function makeTicket(status: string): Ticket {
  return {
    id: selectedTicketId,
    externalId: 'T-42',
    projectId: 1,
    title: 'Sync live phases',
    description: 'Reproduce status transition lag.',
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

/** Simulate a realistic SSE state_change: patch the cache first (as useSSE does), then fire onEvent. */
function simulateSSE(from: string, to: string) {
  patchTicketStatusInCache(queryClient, selectedTicketId, to)
  latestSSEOptions?.onEvent?.({
    type: 'state_change',
    data: { ticketId: selectedTicketId, from, to },
  })
}

function createJsonResponse(payload: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

function renderDashboard() {
  return render(
    <QueryClientProvider client={queryClient}>
      <TicketDashboard />
    </QueryClientProvider>,
  )
}

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
    unobserve() {}
  }

  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: ResizeObserverMock,
  })

  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  })

  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    writable: true,
    value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0),
  })

  Object.defineProperty(window, 'cancelAnimationFrame', {
    configurable: true,
    writable: true,
    value: (handle: number) => window.clearTimeout(handle),
  })
})

beforeEach(() => {
  queryClient.clear()
  dispatchMock.mockReset()
  latestSSEOptions = null
  vi.restoreAllMocks()
})

afterEach(() => {
  queryClient.clear()
  latestSSEOptions = null
  vi.restoreAllMocks()
})

describe('TicketDashboard', () => {
  it('follows the next live status immediately on SSE transitions even if ticket refetch is still stale', async () => {
    const initialTicket = makeTicket('DRAFTING_PRD')

    queryClient.setQueryData(['ticket', selectedTicketId], initialTicket)

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.endsWith(`/api/files/${selectedTicketId}/logs`)) {
        return createJsonResponse([])
      }
      if (url.endsWith(`/api/tickets/${selectedTicketId}/artifacts`)) {
        return createJsonResponse([])
      }
      if (url.endsWith(`/api/tickets/${selectedTicketId}`)) {
        return createJsonResponse(initialTicket)
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })

    renderDashboard()

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-header')).toHaveTextContent('DRAFTING_PRD')
    })

    await waitFor(() => {
      expect(latestSSEOptions?.ticketId).toBe(selectedTicketId)
    })

    await act(async () => {
      latestSSEOptions?.onEvent?.({
        type: 'state_change',
        data: {
          ticketId: selectedTicketId,
          from: 'DRAFTING_PRD',
          to: 'REFINING_PRD',
        },
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-header')).toHaveTextContent('REFINING_PRD')
      expect(screen.getByTestId('navigator-current')).toHaveTextContent('REFINING_PRD')
      expect(screen.getByTestId('navigator-selected')).toHaveTextContent('REFINING_PRD')
    })
  })

  it('follows the interview draft transition immediately on SSE transitions', async () => {
    const initialTicket = makeTicket('COUNCIL_DELIBERATING')

    queryClient.setQueryData(['ticket', selectedTicketId], initialTicket)

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.endsWith(`/api/files/${selectedTicketId}/logs`)) {
        return createJsonResponse([])
      }
      if (url.endsWith(`/api/tickets/${selectedTicketId}/artifacts`)) {
        return createJsonResponse([])
      }
      if (url.endsWith(`/api/tickets/${selectedTicketId}`)) {
        return createJsonResponse(initialTicket)
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })

    renderDashboard()

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-header')).toHaveTextContent('COUNCIL_DELIBERATING')
    })

    await waitFor(() => {
      expect(latestSSEOptions?.ticketId).toBe(selectedTicketId)
    })

    await act(async () => {
      latestSSEOptions?.onEvent?.({
        type: 'state_change',
        data: {
          ticketId: selectedTicketId,
          from: 'COUNCIL_DELIBERATING',
          to: 'COUNCIL_VOTING_INTERVIEW',
        },
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-header')).toHaveTextContent('COUNCIL_VOTING_INTERVIEW')
      expect(screen.getByTestId('navigator-current')).toHaveTextContent('COUNCIL_VOTING_INTERVIEW')
      expect(screen.getByTestId('navigator-selected')).toHaveTextContent('COUNCIL_VOTING_INTERVIEW')
    })
  })

  it('keeps a manually selected past phase pinned across live transitions', async () => {
    const initialTicket = makeTicket('COUNCIL_VOTING_PRD')

    queryClient.setQueryData(['ticket', selectedTicketId], initialTicket)

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.endsWith(`/api/files/${selectedTicketId}/logs`)) {
        return createJsonResponse([])
      }
      if (url.endsWith(`/api/tickets/${selectedTicketId}/artifacts`)) {
        return createJsonResponse([])
      }
      if (url.endsWith(`/api/tickets/${selectedTicketId}`)) {
        return createJsonResponse(initialTicket)
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })

    renderDashboard()

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-header')).toHaveTextContent('COUNCIL_VOTING_PRD')
    })

    await waitFor(() => {
      expect(latestSSEOptions?.ticketId).toBe(selectedTicketId)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Select drafting' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Back to live' })).toBeInTheDocument()
      expect(screen.getByTestId('navigator-selected')).toHaveTextContent('DRAFTING_PRD')
    })

    await act(async () => {
      latestSSEOptions?.onEvent?.({
        type: 'state_change',
        data: {
          ticketId: selectedTicketId,
          from: 'COUNCIL_VOTING_PRD',
          to: 'REFINING_PRD',
        },
      })
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Back to live' })).toBeInTheDocument()
      expect(screen.getByTestId('navigator-current')).toHaveTextContent('REFINING_PRD')
      expect(screen.getByTestId('navigator-selected')).toHaveTextContent('DRAFTING_PRD')
      expect(screen.getByTestId('dashboard-header')).toHaveTextContent('REFINING_PRD')
    })
  })

  it('releases a stale pin once the selected phase becomes live and follows the next transition', async () => {
    const initialTicket = makeTicket('COUNCIL_VOTING_PRD')

    queryClient.setQueryData(['ticket', selectedTicketId], initialTicket)

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.endsWith(`/api/files/${selectedTicketId}/logs`)) {
        return createJsonResponse([])
      }
      if (url.endsWith(`/api/tickets/${selectedTicketId}/artifacts`)) {
        return createJsonResponse([])
      }
      if (url.endsWith(`/api/tickets/${selectedTicketId}`)) {
        return createJsonResponse(initialTicket)
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })

    renderDashboard()

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-header')).toHaveTextContent('COUNCIL_VOTING_PRD')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Select drafting' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Back to live' })).toBeInTheDocument()
      expect(screen.getByTestId('navigator-selected')).toHaveTextContent('DRAFTING_PRD')
    })

    await act(async () => {
      simulateSSE('COUNCIL_VOTING_PRD', 'DRAFTING_PRD')
    })

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-header')).toHaveTextContent('DRAFTING_PRD')
      expect(screen.queryByRole('button', { name: 'Back to live' })).not.toBeInTheDocument()
      expect(screen.getByTestId('navigator-current')).toHaveTextContent('DRAFTING_PRD')
      expect(screen.getByTestId('navigator-selected')).toHaveTextContent('DRAFTING_PRD')
    })

    await act(async () => {
      simulateSSE('DRAFTING_PRD', 'REFINING_PRD')
    })

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-header')).toHaveTextContent('REFINING_PRD')
      expect(screen.queryByRole('button', { name: 'Back to live' })).not.toBeInTheDocument()
      expect(screen.getByTestId('navigator-current')).toHaveTextContent('REFINING_PRD')
      expect(screen.getByTestId('navigator-selected')).toHaveTextContent('REFINING_PRD')
    })
  })

  it('advances past stale livePhase when refetch returns a newer status (fast transition race)', async () => {
    const initialTicket = makeTicket('SCANNING_RELEVANT_FILES')

    queryClient.setQueryData(['ticket', selectedTicketId], initialTicket)

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.endsWith(`/api/files/${selectedTicketId}/logs`)) {
        return createJsonResponse([])
      }
      if (url.endsWith(`/api/tickets/${selectedTicketId}/artifacts`)) {
        return createJsonResponse([])
      }
      if (url.endsWith(`/api/tickets/${selectedTicketId}`)) {
        // Simulate the refetch returning a NEWER status than the SSE event
        // (the server already transitioned past SCANNING_RELEVANT_FILES).
        return createJsonResponse(makeTicket('COUNCIL_DELIBERATING'))
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })

    renderDashboard()

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-header')).toHaveTextContent('SCANNING_RELEVANT_FILES')
    })

    await waitFor(() => {
      expect(latestSSEOptions?.ticketId).toBe(selectedTicketId)
    })

    // SSE delivers DRAFT → SCANNING_RELEVANT_FILES (livePhase set).
    await act(async () => {
      latestSSEOptions?.onEvent?.({
        type: 'state_change',
        data: {
          ticketId: selectedTicketId,
          from: 'DRAFT',
          to: 'SCANNING_RELEVANT_FILES',
        },
      })
    })

    // Now simulate the race: a React Query refetch resolves with a NEWER
    // status (COUNCIL_DELIBERATING), leapfrogging the stale livePhase.
    await act(async () => {
      queryClient.setQueryData(['ticket', selectedTicketId], makeTicket('COUNCIL_DELIBERATING'))
    })

    // The useEffect should advance livePhase to match the DB status.
    await waitFor(() => {
      expect(screen.getByTestId('navigator-current')).toHaveTextContent('COUNCIL_DELIBERATING')
      expect(screen.getByTestId('dashboard-header')).toHaveTextContent('COUNCIL_DELIBERATING')
    })
  })

  it('switches to interview approval and forwards workspace navigation focus', async () => {
    const initialTicket = makeTicket('WAITING_PRD_APPROVAL')

    queryClient.setQueryData(['ticket', selectedTicketId], initialTicket)

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.endsWith(`/api/files/${selectedTicketId}/logs`)) {
        return createJsonResponse([])
      }
      if (url.endsWith(`/api/tickets/${selectedTicketId}/artifacts`)) {
        return createJsonResponse([])
      }
      if (url.endsWith(`/api/tickets/${selectedTicketId}`)) {
        return createJsonResponse(initialTicket)
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })

    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    renderDashboard()

    await waitFor(() => {
      expect(screen.getByTestId('navigator-current')).toHaveTextContent('WAITING_PRD_APPROVAL')
    })

    await act(async () => {
      window.dispatchEvent(new CustomEvent(WORKSPACE_PHASE_NAVIGATE_EVENT, {
        detail: {
          ticketId: selectedTicketId,
          phase: 'WAITING_INTERVIEW_APPROVAL',
          anchorId: 'interview-group-phase-foundation',
        },
      }))
    })

    await waitFor(() => {
      expect(screen.getByTestId('navigator-selected')).toHaveTextContent('WAITING_INTERVIEW_APPROVAL')
      expect(screen.getByTestId('active-workspace')).toHaveTextContent('WAITING_INTERVIEW_APPROVAL')
    })

    const focusEvent = dispatchSpy.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === 'looptroop:interview-approval-focus') as CustomEvent<{ ticketId: string; anchorId: string }> | undefined

    expect(focusEvent?.detail).toEqual({
      ticketId: selectedTicketId,
      anchorId: 'interview-group-phase-foundation',
    })
  })
})
