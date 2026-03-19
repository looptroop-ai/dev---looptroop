import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Ticket } from '@/hooks/useTickets'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DraftView } from '../DraftView'

const queryClients: QueryClient[] = []

function createJsonResponse(payload: unknown, status: number = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  })
  queryClients.push(queryClient)

  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {ui}
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

function makeTicket(): Ticket {
  return {
    id: '6:LOOP-1',
    externalId: 'LOOP-1',
    projectId: 6,
    title: 'pre-plan',
    description: 'Add a planning gate before interview.',
    priority: 3,
    status: 'DRAFT',
    xstateSnapshot: null,
    branchName: null,
    currentBead: null,
    totalBeads: null,
    percentComplete: null,
    errorMessage: null,
    errorSeenSignature: null,
    lockedMainImplementer: null,
    lockedCouncilMembers: [],
    availableActions: ['start', 'cancel'],
    previousStatus: null,
    runtime: {
      baseBranch: 'main',
      currentBead: 0,
      completedBeads: 0,
      totalBeads: 0,
      percentComplete: 0,
      iterationCount: 0,
      maxIterations: 5,
      artifactRoot: '/tmp/ticket',
      beads: [],
      candidateCommitSha: null,
      preSquashHead: null,
      finalTestStatus: 'pending',
    },
    startedAt: null,
    plannedDate: null,
    createdAt: '2026-03-13T15:48:17.998Z',
    updatedAt: '2026-03-13T15:48:17.998Z',
  }
}

describe('DraftView', () => {
  afterEach(() => {
    cleanup()
    for (const queryClient of queryClients.splice(0)) {
      queryClient.clear()
    }
    vi.restoreAllMocks()
  })

  it('shows the start error when the ticket cannot start', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/projects') {
        return createJsonResponse([
          {
            id: 6,
            name: 'looptroop',
            shortname: 'LOOP',
            icon: '🍂',
            color: '#a855f7',
            folderPath: '/mnt/d/TestLoopTroop',
            profileId: null,
            councilMembers: null,
            maxIterations: null,
            perIterationTimeout: null,
            councilResponseTimeout: null,
            minCouncilQuorum: null,
            interviewQuestions: null,
            ticketCounter: 1,
            createdAt: '2026-03-13T15:47:26.973Z',
            updatedAt: '2026-03-13T15:47:26.973Z',
          },
        ])
      }

      if (url === '/api/profile') {
        return createJsonResponse({
          id: 1,
          username: 'Liviu',
          icon: '🧑‍💻',
          background: null,
          mainImplementer: 'openai/codex-mini-latest',
          councilMembers: JSON.stringify([
            'openai/codex-mini-latest',
            'openai/gpt-5.3-codex',
            'anthropic/claude-sonnet-4',
          ]),
          minCouncilQuorum: 2,
          perIterationTimeout: 300000,
          councilResponseTimeout: 300000,
          interviewQuestions: 50,
          maxIterations: 5,
          disableAnalogies: 0,
          createdAt: '2026-03-13T15:47:26.973Z',
          updatedAt: '2026-03-13T15:47:26.973Z',
        })
      }

      if (url === '/api/tickets/6:LOOP-1/start') {
        return createJsonResponse({
          error: 'Council member models are not configured in OpenCode: anthropic/claude-sonnet-4, google/gemini-2.5-pro',
        }, 400)
      }

      throw new Error(`Unhandled fetch: ${url}`)
    })

    renderWithProviders(<DraftView ticket={makeTicket()} />)

    expect(await screen.findByText('Current Council Members')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Council member info' })).toBeInTheDocument()
    expect(screen.getByText('Main Implementer')).toBeInTheDocument()
    expect(screen.getByText('openai/codex-mini-latest')).toBeInTheDocument()
    expect(screen.getByText('openai/gpt-5.3-codex')).toBeInTheDocument()
    expect(screen.getByText('anthropic/claude-sonnet-4')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /start ticket/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Council member models are not configured in OpenCode')
    expect(alert).toHaveTextContent('Update Configuration to choose currently available models, then try again.')
  })

  it('lets users edit the description while the ticket is in backlog', async () => {
    const updatedDescription = 'Add a planning gate before interview and let users adjust the description before start.'
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/projects') {
        return createJsonResponse([
          {
            id: 6,
            name: 'looptroop',
            shortname: 'LOOP',
            icon: '🍂',
            color: '#a855f7',
            folderPath: '/mnt/d/TestLoopTroop',
            profileId: null,
            councilMembers: null,
            maxIterations: null,
            perIterationTimeout: null,
            councilResponseTimeout: null,
            minCouncilQuorum: null,
            interviewQuestions: null,
            ticketCounter: 1,
            createdAt: '2026-03-13T15:47:26.973Z',
            updatedAt: '2026-03-13T15:47:26.973Z',
          },
        ])
      }

      if (url === '/api/profile') {
        return createJsonResponse({
          id: 1,
          username: 'Liviu',
          icon: '🧑‍💻',
          background: null,
          mainImplementer: 'openai/codex-mini-latest',
          councilMembers: JSON.stringify([
            'openai/codex-mini-latest',
            'openai/gpt-5.3-codex',
            'anthropic/claude-sonnet-4',
          ]),
          minCouncilQuorum: 2,
          perIterationTimeout: 300000,
          councilResponseTimeout: 300000,
          interviewQuestions: 50,
          maxIterations: 5,
          disableAnalogies: 0,
          createdAt: '2026-03-13T15:47:26.973Z',
          updatedAt: '2026-03-13T15:47:26.973Z',
        })
      }

      if (url === '/api/tickets/6:LOOP-1' && init?.method === 'PATCH') {
        expect(init.body).toBe(JSON.stringify({ description: updatedDescription }))
        return createJsonResponse({
          ...makeTicket(),
          description: updatedDescription,
          updatedAt: '2026-03-13T16:00:00.000Z',
        })
      }

      // Handle query invalidation refetches after PATCH
      if (url.startsWith('/api/tickets')) {
        return createJsonResponse([{ ...makeTicket(), description: updatedDescription }])
      }

      throw new Error(`Unhandled fetch: ${url}`)
    })

    renderWithProviders(<DraftView ticket={makeTicket()} />)

    fireEvent.click(screen.getByRole('button', { name: /edit description/i }))

    const textarea = screen.getByRole('textbox', { name: 'Ticket description' })
    expect(textarea).toHaveValue('Add a planning gate before interview.')

    fireEvent.change(textarea, { target: { value: updatedDescription } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText(updatedDescription)).toBeInTheDocument()
      expect(screen.queryByRole('textbox', { name: 'Ticket description' })).not.toBeInTheDocument()
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/tickets/6:LOOP-1', expect.objectContaining({
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: updatedDescription }),
    }))
  })
})
