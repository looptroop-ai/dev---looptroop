import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ticket } from '@/hooks/useTickets'
import type { InterviewDocument } from '@shared/interviewArtifact'
import { makeTicket, TEST } from '@/test/factories'

const mockUseInterviewQuestions = vi.fn()
const mockUseTicketUIState = vi.fn()
const mockSaveUiState = vi.fn()
const mockClearTicketArtifactsCache = vi.fn()
const mockUseTicketArtifacts = vi.fn()

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
  useTicketArtifacts: (...args: unknown[]) => mockUseTicketArtifacts(...args),
}))

vi.mock('../PhaseArtifactsPanel', () => ({
  PhaseArtifactsPanel: ({ prefixElement }: { prefixElement?: React.ReactNode }) => (
    <div data-testid="phase-artifacts-panel">{prefixElement}</div>
  ),
}))

vi.mock('../PrdApprovalPane', () => ({
  PrdApprovalPane: ({ ticket }: { ticket: Ticket }) => <div data-testid="prd-approval-pane">{ticket.id}</div>,
}))

vi.mock('../PhaseLogPanel', () => ({
  PhaseLogPanel: () => <div data-testid="phase-log-panel" />,
}))

vi.mock('../VerticalResizeHandle', () => ({
  VerticalResizeHandle: () => <div data-testid="resize-handle" />,
}))

vi.mock('../CollapsiblePhaseLogSection', () => ({
  CollapsiblePhaseLogSection: () => <div data-testid="collapsible-log-section" />,
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

async function renderApprovalView(ticket: Ticket, artifactType: 'interview' | 'prd' | 'beads' = 'interview') {
  const { ApprovalView } = await import('../ApprovalView')
  return renderWithProviders(<ApprovalView ticket={ticket} artifactType={artifactType} />)
}

function buildInterviewDocument(answer: string): InterviewDocument {
  return {
    schema_version: 1,
    ticket_id: TEST.externalId,
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
    `ticket_id: ${TEST.externalId}`,
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
    const foundationLabels = screen.getAllByText('Foundation')
    fireEvent.click(foundationLabels[foundationLabels.length - 1]!.closest('button')!)
  }

  function clickHeaderEditButton() {
    fireEvent.click(screen.getAllByRole('button', { name: /^Edit$/ })[0]!)
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
    mockUseTicketArtifacts.mockReset()
    mockUseTicketArtifacts.mockReturnValue({ artifacts: [], isLoading: false })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('opens edit mode on the friendly Answers tab and saves answer-only edits', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === `/api/tickets/${TEST.ticketId}/artifacts`) {
        return createJsonResponse([])
      }
      if (url === `/api/tickets/${TEST.ticketId}/interview-answers` && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as {
          questions: Array<{ id: string; answer: { free_text: string } }>
        }
        const nextAnswer = body.questions.find((question) => question.id === 'Q01')?.answer.free_text ?? ''
        interviewPayload = buildInterviewPayload(nextAnswer)
        return createJsonResponse({ success: true, ...interviewPayload })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderApprovalView(makeTicket({ status: 'WAITING_INTERVIEW_APPROVAL' }))

    openFoundationSection()
    expect(screen.getByText('Protect the import pipeline.')).toBeInTheDocument()

    clickHeaderEditButton()

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
        `/api/tickets/${TEST.ticketId}/interview-answers`,
        expect.objectContaining({ method: 'PUT' }),
      )
    })
    expect(mockClearTicketArtifactsCache).toHaveBeenCalledWith(TEST.ticketId)
  }, 30_000)

  it('routes PRD approvals to the dedicated pane', async () => {
    await renderApprovalView(makeTicket({ status: 'WAITING_PRD_APPROVAL' }), 'prd')

    expect(screen.getByTestId('prd-approval-pane')).toBeInTheDocument()
  })

  it('lets the interview summary collapse and reopen in approval view', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === `/api/tickets/${TEST.ticketId}/artifacts`) {
        return createJsonResponse([])
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderApprovalView(makeTicket({ status: 'WAITING_INTERVIEW_APPROVAL' }))

    expect(screen.getByText('Final Free-Form Answer')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Interview Summary/i }))
    expect(screen.queryByText('Final Free-Form Answer')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Interview Summary/i }))
    expect(screen.getByText('Final Free-Form Answer')).toBeInTheDocument()
  })

  it('confirms before switching from dirty answer edits to the YAML tab and resets to the last saved artifact', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === `/api/tickets/${TEST.ticketId}/artifacts`) {
        return createJsonResponse([])
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderApprovalView(makeTicket({ status: 'WAITING_INTERVIEW_APPROVAL' }))

    clickHeaderEditButton()
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
  }, 30_000)

  it('shows local YAML validation feedback and saves valid YAML edits', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === `/api/tickets/${TEST.ticketId}/artifacts`) {
        return createJsonResponse([])
      }
      if (url === `/api/tickets/${TEST.ticketId}/interview` && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { content: string }
        interviewPayload = body.content.includes('Updated from YAML.')
          ? buildInterviewPayload('Updated from YAML.')
          : interviewPayload
        return createJsonResponse({ success: true, ...interviewPayload })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderApprovalView(makeTicket({ status: 'WAITING_INTERVIEW_APPROVAL' }))

    clickHeaderEditButton()
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
  }, 30_000)

  it('shows a loading state instead of briefly rendering raw YAML while interview data is refetching', async () => {
    mockUseInterviewQuestions.mockImplementation(() => ({
      data: {
        winnerId: 'openai/gpt-5',
        raw: 'questions:\n  - id: Q01\n    question: Old compiled question',
        document: null,
        session: null,
        questions: [],
      },
      isLoading: false,
      isFetching: true,
    }))

    await renderApprovalView(makeTicket({ status: 'WAITING_INTERVIEW_APPROVAL' }))

    expect(screen.getByText('Building the structured approval view.')).toBeInTheDocument()
    expect(screen.queryByText(/schema_version: 1/i)).not.toBeInTheDocument()
  }, 30_000)

  it('uses the shared bead renderer with nested metadata in beads approval view', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === `/api/tickets/${TEST.ticketId}/beads`) {
        return createJsonResponse([
          {
            id: 'proj-1-review-approval-metadata',
            title: 'Review approval metadata',
            prdRefs: ['EPIC-1', 'US-1'],
            description: 'Render the final beads approval card with metadata.',
            contextGuidance: {
              patterns: ['Reuse the shared bead renderer in approval mode.'],
              anti_patterns: ['Do not keep a separate approval-only bead layout.'],
            },
            acceptanceCriteria: ['Approval shows full bead structure.'],
            tests: ['Render the bead card in approval mode.'],
            testCommands: ['npm run test -- ApprovalView'],
            priority: 1,
            status: 'pending',
            issueType: 'task',
            externalRef: TEST.externalId,
            labels: ['ticket:PROJ-1', 'story:US-1'],
            dependencies: { blocked_by: [], blocks: [] },
            targetFiles: ['src/components/workspace/ApprovalView.tsx'],
            notes: '',
            iteration: 1,
            createdAt: '2026-03-31T10:00:00.000Z',
            updatedAt: '2026-03-31T10:00:00.000Z',
            completedAt: '',
            startedAt: '',
            beadStartCommit: null,
          },
        ])
      }
      if (url === `/api/tickets/${TEST.ticketId}/artifacts`) {
        return createJsonResponse([])
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderApprovalView(makeTicket({ status: 'WAITING_BEADS_APPROVAL' }), 'beads')

    expect(screen.queryByText(/^pending$/i)).not.toBeInTheDocument()

    fireEvent.click((await screen.findByText('Review approval metadata')).closest('button')!)

    expect(screen.getByText('Target Files')).toBeInTheDocument()
    expect(screen.getByText('src/components/workspace/ApprovalView.tsx')).toBeInTheDocument()
    const metadataButton = screen.getByRole('button', { name: /^Metadata$/i })
    expect(metadataButton).toBeInTheDocument()
    expect(screen.queryByText('Issue Type')).not.toBeInTheDocument()

    fireEvent.click(metadataButton)

    expect(screen.getByText('Issue Type')).toBeInTheDocument()
    expect(screen.getByText('Lifecycle')).toBeInTheDocument()
    expect(screen.getByText(/^pending$/i)).toBeInTheDocument()
  }, 30_000)

  it('shows unresolved beads coverage gaps as a collapsible warning during approval', async () => {
    mockUseTicketArtifacts.mockReturnValue({
      artifacts: [
        {
          id: 902,
          ticketId: TEST.ticketId,
          phase: 'WAITING_BEADS_APPROVAL',
          artifactType: 'beads_coverage',
          filePath: null,
          createdAt: '2026-04-03T14:25:00.000Z',
          content: JSON.stringify({
            status: 'gaps',
            summary: 'Coverage gaps remain after the final implementation-plan audit.',
            finalCandidateVersion: 3,
            hasRemainingGaps: true,
            remainingGaps: [
              'Missing a bead that verifies the approval warning behavior when gaps remain.',
            ],
            auditNotes: 'status: gaps\ngaps:\n  - Missing a bead that verifies the approval warning behavior when gaps remain.',
          }),
        },
      ],
      isLoading: false,
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === `/api/tickets/${TEST.ticketId}/beads`) {
        return createJsonResponse([
          {
            id: 'proj-1-coverage-warning',
            title: 'Render coverage warning state',
            prdRefs: ['EPIC-1'],
            description: 'Show unresolved coverage gaps during beads approval.',
            contextGuidance: {
              patterns: ['Keep the approval warning collapsible.'],
              anti_patterns: ['Do not block manual approval.'],
            },
            acceptanceCriteria: ['Approval shows unresolved coverage warning details.'],
            tests: ['Render the warning with remaining gaps.'],
            testCommands: ['npm test -- ApprovalView'],
            priority: 1,
            status: 'pending',
            issueType: 'task',
            externalRef: TEST.externalId,
            labels: ['ticket:PROJ-1'],
            dependencies: { blocked_by: [], blocks: [] },
            targetFiles: ['src/components/workspace/ApprovalView.tsx'],
            notes: '',
            iteration: 1,
            createdAt: '2026-03-31T10:00:00.000Z',
            updatedAt: '2026-03-31T10:00:00.000Z',
            completedAt: '',
            startedAt: '',
            beadStartCommit: null,
          },
        ])
      }
      if (url === `/api/tickets/${TEST.ticketId}/artifacts`) {
        return createJsonResponse([])
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderApprovalView(makeTicket({ status: 'WAITING_BEADS_APPROVAL' }), 'beads')

    const warningToggle = await screen.findByRole('button', { name: /Coverage Warning/i })
    expect(warningToggle).toBeInTheDocument()
    expect(screen.queryByText('Remaining Gaps')).not.toBeInTheDocument()

    fireEvent.click(warningToggle)

    expect(screen.getByText('Coverage gaps remain after the final implementation-plan audit.')).toBeInTheDocument()
    expect(screen.getByText('Implementation Plan v3')).toBeInTheDocument()
    expect(screen.getByText('Missing a bead that verifies the approval warning behavior when gaps remain.')).toBeInTheDocument()
    expect(screen.getByText(/status: gaps/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Approve/i })).not.toBeDisabled()
  }, 30_000)
})
