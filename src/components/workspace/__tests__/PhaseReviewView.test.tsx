import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode, Ref } from 'react'
import { screen, waitFor } from '@testing-library/react'
import { LogProvider } from '@/context/LogContext'
import { LOG_STORAGE_PREFIX, serverLogCache, type LogEntry } from '@/context/logUtils'
import { makeTicket } from '@/test/factories'
import { renderWithProviders, createJsonResponse } from '@/test/renderHelpers'
import { PhaseReviewView } from '../PhaseReviewView'

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

vi.mock('@/hooks/useTicketArtifacts', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useTicketArtifacts')>('@/hooks/useTicketArtifacts')
  return {
    ...actual,
    useTicketArtifacts: () => ({ artifacts: [], isLoading: false }),
  }
})

function setPersistedDraftLogs(ticketId: string, logs: LogEntry[]) {
  localStorage.setItem(`${LOG_STORAGE_PREFIX}${ticketId}-DRAFT`, JSON.stringify(logs))
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

  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    writable: true,
    value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0),
  })

  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    writable: true,
    value: (handle: number) => window.clearTimeout(handle),
  })

  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  })
})

afterEach(() => {
  localStorage.clear()
  serverLogCache.clear()
  vi.restoreAllMocks()
})

describe('PhaseReviewView', () => {
  it('shows persisted draft logs when revisiting backlog after start', async () => {
    const ticket = makeTicket({
      status: 'SCANNING_RELEVANT_FILES',
      description: 'Add a planning gate before the interview starts.',
    })

    setPersistedDraftLogs(ticket.id, [
      {
        id: 'draft-log-1',
        entryId: 'draft-log-1',
        line: '[SYS] Start requested.',
        source: 'system',
        status: 'DRAFT',
        timestamp: '2026-03-10T10:00:00.000Z',
        audience: 'all',
        kind: 'milestone',
        streaming: false,
        op: 'append',
      },
    ])

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.startsWith(`/api/files/${ticket.id}/logs`)) {
        return createJsonResponse([])
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })

    renderWithProviders(
      <LogProvider ticketId={ticket.id} currentStatus={ticket.status}>
        <PhaseReviewView phase="DRAFT" ticket={ticket} />
      </LogProvider>,
    )

    expect(screen.getByText('Description')).toBeInTheDocument()
    expect(screen.getByText('Add a planning gate before the interview starts.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Log$/i })).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText(/Start requested\./i)).toBeInTheDocument()
    })
  })

  it('keeps the backlog log viewer visible when no draft logs exist yet', async () => {
    const ticket = makeTicket({
      status: 'SCANNING_RELEVANT_FILES',
      description: 'Add a planning gate before the interview starts.',
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.startsWith(`/api/files/${ticket.id}/logs`)) {
        return createJsonResponse([])
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })

    renderWithProviders(
      <LogProvider ticketId={ticket.id} currentStatus={ticket.status}>
        <PhaseReviewView phase="DRAFT" ticket={ticket} />
      </LogProvider>,
    )

    expect(screen.getByRole('button', { name: /^Log$/i })).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText(/No log entries yet\. Logs will stream here during execution\./i)).toBeInTheDocument()
    })
  })
})
