import type { ReactElement } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LogContext } from '@/context/logContextDef'
import type { LogContextValue, LogEntry } from '@/context/logUtils'
import { TEST, makeTicket } from '@/test/factories'
import { renderWithProviders, createTestQueryClient } from '@/test/renderHelpers'
import { WorkspacePhaseSummary } from '../WorkspacePhaseSummary'

function createJsonResponse(payload: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

function createLogEntry(line: string, timestamp: string): LogEntry {
  return {
    id: `${timestamp}:${line}`,
    entryId: `${timestamp}:${line}`,
    line,
    source: 'system',
    status: 'VERIFYING_PRD_COVERAGE',
    timestamp,
    audience: 'all',
    kind: 'milestone',
    streaming: false,
    op: 'append',
  }
}

function renderWithLogContext(ui: ReactElement, logsByPhase: Record<string, LogEntry[]>) {
  const value: LogContextValue = {
    logsByPhase,
    activePhase: null,
    isLoadingLogs: false,
    addLog: vi.fn(),
    addLogRecord: vi.fn(),
    getLogsForPhase: (phase: string) => logsByPhase[phase] ?? [],
    getAllLogs: () => Object.values(logsByPhase).flat(),
    setActivePhase: vi.fn(),
    clearLogs: vi.fn(),
  }

  return renderWithProviders(
    <LogContext.Provider value={value}>{ui}</LogContext.Provider>,
    { queryClient: createTestQueryClient() },
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('WorkspacePhaseSummary', () => {
  it('renders the phase description and opens detailed status copy', () => {
    const ticket = makeTicket({ status: 'DRAFTING_PRD' })

    renderWithProviders(
      <WorkspacePhaseSummary phase="DRAFTING_PRD" ticket={ticket} />,
    )

    expect(screen.getByText('Models produce competing PRD drafts.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /show detailed explanation for drafting specs/i }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/Part 1 — Answering Skipped Questions/)).toBeInTheDocument()
    expect(screen.getByText(/Competing PRD drafts — one from each council member/)).toBeInTheDocument()
    expect(screen.getByText(/When enough valid PRD drafts are ready \(meeting the configured quorum threshold\), the workflow advances to the PRD voting phase\./)).toBeInTheDocument()
  })

  it('collapses and re-expands the description when clicking the phase name', () => {
    const ticket = makeTicket({ status: 'DRAFTING_PRD' })

    renderWithProviders(
      <WorkspacePhaseSummary phase="DRAFTING_PRD" ticket={ticket} />,
    )

    const toggle = screen.getByRole('button', { name: 'Drafting Specs' })
    expect(screen.getByText('Models produce competing PRD drafts.')).toBeInTheDocument()

    fireEvent.click(toggle)
    expect(screen.queryByText('Models produce competing PRD drafts.')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(screen.getByText('Models produce competing PRD drafts.')).toBeInTheDocument()
  })

  it('uses the error reason when rendering the blocked-error label', () => {
    const ticket = makeTicket({ status: 'BLOCKED_ERROR' })

    renderWithProviders(
      <WorkspacePhaseSummary
        phase="BLOCKED_ERROR"
        ticket={ticket}
        errorMessage="The runner crashed while executing bead B-12."
      />,
    )

    expect(screen.getByText(/Error \(The runner crashed while executing bead B-12\.\)/)).toBeInTheDocument()
    expect(screen.getByText('A blocking error requires retry or cancel.')).toBeInTheDocument()
  })

  it('shows the next live PRD coverage version in the main title when revision work starts', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.endsWith(`/api/tickets/${TEST.ticketId}/artifacts`)) {
        return createJsonResponse([])
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })

    const ticket = makeTicket({ id: TEST.ticketId, status: 'VERIFYING_PRD_COVERAGE' })
    const logsByPhase = {
      VERIFYING_PRD_COVERAGE: [
        createLogEntry('[SYS] Transition: REFINING_PRD -> VERIFYING_PRD_COVERAGE', '2026-01-01T00:00:00.000Z'),
        createLogEntry('[SYS] Coverage found 2 gap(s) in PRD Candidate v1. Revising candidate before the next audit pass.', '2026-01-01T00:00:02.000Z'),
      ],
    }

    renderWithLogContext(
      <WorkspacePhaseSummary phase="VERIFYING_PRD_COVERAGE" ticket={ticket} />,
      logsByPhase,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Coverage Check (PRD) · Live v2' })).toBeInTheDocument()
    })
  })

  it('shows the latest live beads coverage version in the main title from coverage artifacts', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.endsWith(`/api/tickets/${TEST.ticketId}/artifacts`)) {
        return createJsonResponse([
          {
            id: 1,
            ticketId: TEST.ticketId,
            phase: 'VERIFYING_BEADS_COVERAGE',
            artifactType: 'beads_coverage_revision',
            filePath: null,
            content: JSON.stringify({
              winnerId: TEST.councilMembers[0],
              refinedContent: 'beads: []',
              candidateVersion: 3,
            }),
            createdAt: '2026-01-01T00:00:03.000Z',
          },
        ])
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })

    const ticket = makeTicket({ id: TEST.ticketId, status: 'VERIFYING_BEADS_COVERAGE' })

    renderWithProviders(
      <WorkspacePhaseSummary phase="VERIFYING_BEADS_COVERAGE" ticket={ticket} />,
      { queryClient: createTestQueryClient() },
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Coverage Check (Beads) · Live v3' })).toBeInTheDocument()
    })
  })
})
