import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Ticket } from '@/hooks/useTickets'
import { ApprovalView } from '../ApprovalView'

vi.mock('@/hooks/useTickets', () => ({
  useTicketAction: () => ({ mutate: vi.fn(), isPending: false }),
  useTicketUIState: () => ({ data: { scope: 'approval_interview', exists: false, data: null, updatedAt: null } }),
  useSaveTicketUIState: () => ({ mutate: vi.fn() }),
}))

vi.mock('../PhaseLogPanel', () => ({
  PhaseLogPanel: () => <div data-testid="phase-log-panel" />,
}))

vi.mock('../PhaseArtifactsPanel', () => ({
  PhaseArtifactsPanel: ({ prefixElement }: { prefixElement?: React.ReactNode }) => (
    <div data-testid="phase-artifacts-panel">{prefixElement}</div>
  ),
  InterviewAnswersView: ({ content }: { content: string }) => <div data-testid="interview-answers-view">{content}</div>,
  PrdDraftView: ({ content }: { content: string }) => <div data-testid="prd-draft-view">{content}</div>,
}))

vi.mock('@/components/editor/YamlEditor', () => ({
  YamlEditor: ({
    value,
    onChange,
    className,
  }: {
    value: string
    onChange: (value: string) => void
    className?: string
  }) => (
    <textarea
      aria-label="YAML editor"
      className={className}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}))

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

  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  )
}

function makeTicket(artifactType: 'interview' | 'prd' = 'interview'): Ticket {
  return {
    id: '1:PROJ-42',
    externalId: 'PROJ-42',
    projectId: 1,
    title: 'Retry strategy',
    description: 'Clarify webhook retry behavior.',
    priority: 3,
    status: artifactType === 'interview' ? 'WAITING_INTERVIEW_APPROVAL' : 'WAITING_PRD_APPROVAL',
    xstateSnapshot: null,
    branchName: null,
    currentBead: null,
    totalBeads: null,
    percentComplete: null,
    errorMessage: null,
    errorSeenSignature: null,
    lockedMainImplementer: null,
    lockedCouncilMembers: ['openai/gpt-5'],
    availableActions: [],
    previousStatus: null,
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
    createdAt: '2026-03-17T10:00:00.000Z',
    updatedAt: '2026-03-17T10:00:00.000Z',
  }
}

function buildInterviewYaml(skipped: boolean): string {
  return [
    'schema_version: 1',
    'ticket_id: PROJ-42',
    'artifact: interview',
    'questions:',
    '  - id: Q01',
    '    prompt: Which constraints are fixed?',
    '    answer:',
    `      skipped: ${skipped ? 'true' : 'false'}`,
    skipped ? "      free_text: ''" : '      free_text: Keep imports idempotent.',
  ].join('\n')
}

describe('ApprovalView', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the skipped-questions notice when the loaded interview artifact contains skipped questions', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input)

      if (!init && url === '/api/files/1:PROJ-42/interview') {
        return createJsonResponse({ content: buildInterviewYaml(true), exists: true })
      }

      throw new Error(`Unhandled fetch: ${url}`)
    })

    renderWithProviders(<ApprovalView ticket={makeTicket()} artifactType="interview" />)

    expect(await screen.findByText(/Some interview questions were skipped\./i)).toBeInTheDocument()
    expect(screen.getByText(/Each PRD council model will use the ticket context, codebase analysis, and best practices/i)).toBeInTheDocument()
  })

  it('hides the notice when the loaded interview artifact has no skipped questions', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input)

      if (!init && url === '/api/files/1:PROJ-42/interview') {
        return createJsonResponse({ content: buildInterviewYaml(false), exists: true })
      }

      throw new Error(`Unhandled fetch: ${url}`)
    })

    renderWithProviders(<ApprovalView ticket={makeTicket()} artifactType="interview" />)

    await screen.findByTestId('interview-answers-view')
    expect(screen.queryByText(/Some interview questions were skipped\./i)).not.toBeInTheDocument()
  })

  it('updates the notice after saving interview edits that remove skipped questions', async () => {
    let currentContent = buildInterviewYaml(true)

    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input)

      if (!init && url === '/api/files/1:PROJ-42/interview') {
        return createJsonResponse({ content: currentContent, exists: true })
      }

      if (url === '/api/files/1:PROJ-42/interview' && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { content: string }
        currentContent = body.content
        return createJsonResponse({ success: true })
      }

      throw new Error(`Unhandled fetch: ${url}`)
    })

    renderWithProviders(<ApprovalView ticket={makeTicket()} artifactType="interview" />)

    expect(await screen.findByText(/Some interview questions were skipped\./i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /edit/i }))

    const editor = await screen.findByLabelText('YAML editor')
    fireEvent.change(editor, { target: { value: buildInterviewYaml(false) } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(screen.queryByText(/Some interview questions were skipped\./i)).not.toBeInTheDocument()
    })
  })
})
