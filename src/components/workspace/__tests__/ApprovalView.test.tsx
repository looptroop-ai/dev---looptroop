import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ticket } from '@/hooks/useTickets'
import type { InterviewDocument } from '@shared/interviewArtifact'

const mockUseInterviewQuestions = vi.fn()
const mockUseTicketUIState = vi.fn()
const mockSaveUiState = vi.fn()
const mockClearTicketArtifactsCache = vi.fn()

vi.mock('@/hooks/useTickets', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useTickets')>('@/hooks/useTickets')
  return {
    ...actual,
    useInterviewQuestions: (...args: unknown[]) => mockUseInterviewQuestions(...args),
    useTicketUIState: (...args: unknown[]) => mockUseTicketUIState(...args),
    useSaveTicketUIState: () => ({ mutate: mockSaveUiState }),
  }
})

vi.mock('@/hooks/useTicketArtifacts', () => ({
  clearTicketArtifactsCache: (...args: unknown[]) => mockClearTicketArtifactsCache(...args),
}))

vi.mock('../PhaseArtifactsPanel', () => ({
  PhaseArtifactsPanel: ({ prefixElement }: { prefixElement?: React.ReactNode }) => (
    <div data-testid="phase-artifacts-panel">{prefixElement}</div>
  ),
  PrdDraftView: ({ content }: { content: string }) => <div data-testid="prd-draft-view">{content}</div>,
}))

vi.mock('../PhaseLogPanel', () => ({
  PhaseLogPanel: () => <div data-testid="phase-log-panel" />,
}))

vi.mock('../VerticalResizeHandle', () => ({
  VerticalResizeHandle: () => <div data-testid="resize-handle" />,
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

async function renderApprovalView(ticket: Ticket) {
  const { ApprovalView } = await import('../ApprovalView')
  return renderWithProviders(<ApprovalView ticket={ticket} artifactType="interview" />)
}

function makeTicket(): Ticket {
  return {
    id: '1:PROJ-42',
    externalId: 'PROJ-42',
    projectId: 1,
    title: 'Retry strategy',
    description: 'Clarify webhook retry behavior.',
    priority: 3,
    status: 'WAITING_INTERVIEW_APPROVAL',
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

function buildInterviewDocument(answer: string): InterviewDocument {
  return {
    schema_version: 1,
    ticket_id: 'PROJ-42',
    artifact: 'interview',
    status: 'draft',
    generated_by: {
      winner_model: 'openai/gpt-5',
      generated_at: '2026-03-17T10:00:00.000Z',
      canonicalization: 'server_normalized',
    },
    questions: [
      {
        id: 'Q01',
        phase: 'Foundation',
        prompt: 'What outcome matters most?',
        source: 'compiled',
        follow_up_round: null,
        answer_type: 'free_text',
        options: [],
        answer: {
          skipped: false,
          selected_option_ids: [],
          free_text: answer,
          answered_by: 'user',
          answered_at: '2026-03-17T10:05:00.000Z',
        },
      },
    ],
    follow_up_rounds: [],
    summary: {
      goals: ['Protect imports'],
      constraints: ['No duplicate records'],
      non_goals: ['Bulk reprocessing'],
      final_free_form_answer: '',
    },
    approval: {
      approved_by: '',
      approved_at: '',
    },
  }
}

function buildInterviewYaml(answer: string): string {
  return [
    'schema_version: 1',
    'ticket_id: PROJ-42',
    'artifact: interview',
    'status: draft',
    'generated_by:',
    '  winner_model: openai/gpt-5',
    '  generated_at: 2026-03-17T10:00:00.000Z',
    'questions:',
    '  - id: Q01',
    '    phase: Foundation',
    '    prompt: What outcome matters most?',
    '    source: compiled',
    '    follow_up_round: null',
    '    answer_type: free_text',
    '    options: []',
    '    answer:',
    '      skipped: false',
    '      selected_option_ids: []',
    `      free_text: ${JSON.stringify(answer)}`,
    '      answered_by: user',
    '      answered_at: 2026-03-17T10:05:00.000Z',
    'follow_up_rounds: []',
    'summary:',
    '  goals: [Protect imports]',
    '  constraints: [No duplicate records]',
    '  non_goals: [Bulk reprocessing]',
    '  final_free_form_answer: ""',
    'approval:',
    '  approved_by: ""',
    '  approved_at: ""',
  ].join('\n')
}

function buildInterviewPayload(answer: string) {
  return {
    winnerId: 'openai/gpt-5',
    raw: buildInterviewYaml(answer),
    document: buildInterviewDocument(answer),
    session: null,
    questions: [],
  }
}

describe('Interview approval UI', () => {
  let interviewPayload = buildInterviewPayload('Protect the import pipeline.')

  function openFoundationSection() {
    fireEvent.click(screen.getByText('Foundation').closest('button')!)
  }

  beforeEach(() => {
    vi.resetModules()
    interviewPayload = buildInterviewPayload('Protect the import pipeline.')
    mockUseInterviewQuestions.mockImplementation(() => ({
      data: interviewPayload,
      isLoading: false,
    }))
    mockUseTicketUIState.mockReturnValue({
      data: { scope: 'approval_interview', exists: false, data: null, updatedAt: null },
    })
    mockSaveUiState.mockReset()
    mockClearTicketArtifactsCache.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('opens edit mode on the friendly Answers tab and saves answer-only edits', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/tickets/1:PROJ-42/artifacts') {
        return createJsonResponse([])
      }
      if (url === '/api/tickets/1:PROJ-42/interview-answers' && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as {
          questions: Array<{ id: string; answer: { free_text: string } }>
        }
        const nextAnswer = body.questions.find((question) => question.id === 'Q01')?.answer.free_text ?? ''
        interviewPayload = buildInterviewPayload(nextAnswer)
        return createJsonResponse({ success: true, ...interviewPayload })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderApprovalView(makeTicket())

    openFoundationSection()
    expect(screen.getByText('Protect the import pipeline.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(screen.getByText('Answer-only editor')).toBeInTheDocument()
    expect(screen.queryByLabelText('YAML editor')).not.toBeInTheDocument()
    openFoundationSection()
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Update the recorded answer.')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('Update the recorded answer.'), {
      target: { value: 'Protect the import pipeline and keep logs reversible.' },
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/tickets/1:PROJ-42/interview-answers',
        expect.objectContaining({ method: 'PUT' }),
      )
    })
    expect(mockClearTicketArtifactsCache).toHaveBeenCalledWith('1:PROJ-42')
  }, 10_000)

  it('confirms before switching from dirty answer edits to the YAML tab and resets to the last saved artifact', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/tickets/1:PROJ-42/artifacts') {
        return createJsonResponse([])
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderApprovalView(makeTicket())

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    openFoundationSection()
    fireEvent.change(screen.getByPlaceholderText('Update the recorded answer.'), {
      target: { value: 'Unsaved answer draft.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'YAML' }))

    expect(screen.getByText('Discard unsaved interview edits?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }))

    const editor = await screen.findByLabelText('YAML editor')
    expect(editor).toHaveValue(buildInterviewYaml('Protect the import pipeline.'))
    expect(screen.queryByDisplayValue('Unsaved answer draft.')).not.toBeInTheDocument()
  })

  it('shows local YAML validation feedback and saves valid YAML edits', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/tickets/1:PROJ-42/artifacts') {
        return createJsonResponse([])
      }
      if (url === '/api/tickets/1:PROJ-42/interview' && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { content: string }
        interviewPayload = body.content.includes('Updated from YAML.')
          ? buildInterviewPayload('Updated from YAML.')
          : interviewPayload
        return createJsonResponse({ success: true, ...interviewPayload })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderApprovalView(makeTicket())

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'YAML' }))

    const editor = await screen.findByLabelText('YAML editor')
    fireEvent.change(editor, { target: { value: 'artifact: interview\nquestions: [' } })

    expect(screen.getByText(/unexpected end of the stream|could not be parsed/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(fetchSpy).not.toHaveBeenCalled()

    fireEvent.change(editor, { target: { value: buildInterviewYaml('Updated from YAML.') } })
    expect(screen.getByText(/YAML looks structurally valid/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    })
    openFoundationSection()
    await waitFor(() => {
      expect(screen.getByText('Updated from YAML.')).toBeInTheDocument()
    })
  })
})
