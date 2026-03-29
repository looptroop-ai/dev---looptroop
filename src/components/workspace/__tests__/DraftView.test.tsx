import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTicket, TEST } from '@/test/factories'
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

const projectData = {
  id: TEST.projectId,
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
}

const profileData = {
  id: 1,
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
  createdAt: '2026-03-13T15:47:26.973Z',
  updatedAt: '2026-03-13T15:47:26.973Z',
}

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = String(input)
    if (url === '/api/projects') return createJsonResponse([projectData])
    if (url === '/api/profile') return createJsonResponse(profileData)
    return handler(url, init as RequestInit | undefined)
  })
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
    mockFetch((url) => {
      if (url === `/api/tickets/${TEST.ticketId}/start`) {
        return createJsonResponse({
          error: 'Council member models are not configured in OpenCode: anthropic/claude-sonnet-4, google/gemini-2.5-pro',
        }, 400)
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })

    renderWithProviders(<DraftView ticket={makeTicket({ description: 'Add a planning gate before interview.', availableActions: ['start', 'cancel'] })} />)

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
    const fetchMock = mockFetch((url, init) => {
      if (url === `/api/tickets/${TEST.ticketId}` && init?.method === 'PATCH') {
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

    renderWithProviders(<DraftView ticket={makeTicket({ description: 'Add a planning gate before interview.', availableActions: ['start', 'cancel'] })} />)

    fireEvent.click(screen.getByRole('button', { name: /edit description/i }))

    const textarea = screen.getByRole('textbox', { name: 'Ticket description' })
    expect(textarea).toHaveValue('Add a planning gate before interview.')

    fireEvent.change(textarea, { target: { value: updatedDescription } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText(updatedDescription)).toBeInTheDocument()
      expect(screen.queryByRole('textbox', { name: 'Ticket description' })).not.toBeInTheDocument()
    })
    expect(fetchMock).toHaveBeenCalledWith(`/api/tickets/${TEST.ticketId}`, expect.objectContaining({
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: updatedDescription }),
    }))
  })
})
