import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPrdDocumentYaml, type PrdApprovalDraft } from '@/lib/prdDocument'
import { makeTicket, makePrdDocument, TEST } from '@/test/factories'
import { renderWithProviders } from '@/test/renderHelpers'
import { PrdApprovalPane } from '../PrdApprovalPane'

const mockSaveUiState = vi.fn()
const mockClearTicketArtifactsCache = vi.fn()
const mockUseTicketArtifacts = vi.fn()

vi.mock('@/hooks/useTickets', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useTickets')>('@/hooks/useTickets')
  return {
    ...actual,
    useTicketUIState: () => ({
      data: { scope: 'approval_prd', exists: false, data: null, updatedAt: null },
    }),
    useSaveTicketUIState: () => ({ mutate: mockSaveUiState }),
  }
})

vi.mock('@/hooks/useTicketArtifacts', () => ({
  clearTicketArtifactsCache: (...args: unknown[]) => mockClearTicketArtifactsCache(...args),
  useTicketArtifacts: (...args: unknown[]) => mockUseTicketArtifacts(...args),
}))

vi.mock('../PrdApprovalEditor', () => ({
  PrdApprovalEditor: ({
    draft,
    disabled,
    onChange,
  }: {
    draft: PrdApprovalDraft
    disabled?: boolean
    onChange: (draft: PrdApprovalDraft) => void
  }) => (
    <textarea
      aria-label="structured-prd-editor"
      disabled={disabled}
      value={draft.product.problem_statement}
      onChange={(event) => onChange({
        ...draft,
        product: {
          ...draft.product,
          problem_statement: event.target.value,
        },
      })}
    />
  ),
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

vi.mock('../CollapsiblePhaseLogSection', () => ({
  CollapsiblePhaseLogSection: () => <div data-testid="phase-log-section" />,
}))


describe('PrdApprovalPane', () => {
  let currentContent = buildPrdDocumentYaml(makePrdDocument())

  beforeEach(() => {
    currentContent = buildPrdDocumentYaml(makePrdDocument())
    mockSaveUiState.mockReset()
    mockClearTicketArtifactsCache.mockReset()
    mockUseTicketArtifacts.mockReset()
    mockUseTicketArtifacts.mockReturnValue({ artifacts: [], isLoading: false })

    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input)

      if (url === `/api/files/${TEST.ticketId}/prd` && (!init || init.method === 'GET')) {
        return Promise.resolve(
          new Response(JSON.stringify({ content: currentContent }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      if (url === `/api/files/${TEST.ticketId}/prd` && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { content?: string; document?: ReturnType<typeof makePrdDocument> }
        currentContent = body.document ? buildPrdDocumentYaml(body.document) : body.content ?? currentContent
        return Promise.resolve(
          new Response(JSON.stringify({ content: currentContent }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      if (url === `/api/tickets/${TEST.ticketId}/approve-prd` && init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      throw new Error(`Unhandled fetch: ${url}`)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the dedicated PRD approval view and focuses PRD anchors on demand', async () => {
    renderWithProviders(<PrdApprovalPane ticket={makeTicket({ status: 'WAITING_PRD_APPROVAL' })} />)

    await waitFor(() => {
      expect(document.getElementById('prd-product')).not.toBeNull()
    })

    expect(screen.queryByRole('button', { name: /Interview Summary/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Foundation Answers/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Structure Answers/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Full Answers/i })).not.toBeInTheDocument()
  })

  it('shows the winning model full answers artifact as a compact read-only chip', async () => {
    mockUseTicketArtifacts.mockReturnValue({
      artifacts: [
        {
          id: 910,
          ticketId: TEST.ticketId,
          phase: 'DRAFTING_PRD',
          phaseAttempt: 1,
          artifactType: 'prd_full_answers',
          filePath: null,
          createdAt: '2026-04-03T14:21:00.000Z',
          updatedAt: '2026-04-03T14:21:00.000Z',
          content: JSON.stringify({
            drafts: [
              {
                memberId: 'openai/gpt-5.2',
                outcome: 'completed',
                content: [
                  'schema_version: 1',
                  `ticket_id: "${TEST.externalId}"`,
                  'artifact: "interview"',
                  'status: "draft"',
                  'generated_by:',
                  '  winner_model: "openai/gpt-5.2"',
                  '  generated_at: "2026-04-03T14:20:00.000Z"',
                  'questions:',
                  '  - id: "Q01"',
                  '    phase: "Foundation"',
                  '    prompt: "Which user-owned constraint matters?"',
                  '    source: "compiled"',
                  '    follow_up_round: null',
                  '    answer_type: "free_text"',
                  '    options: []',
                  '    answer:',
                  '      skipped: false',
                  '      selected_option_ids: []',
                  '      free_text: "User selected strict validation."',
                  '      answered_by: "user"',
                  '      answered_at: "2026-04-03T14:19:00.000Z"',
                  '  - id: "Q02"',
                  '    phase: "Foundation"',
                  '    prompt: "Which fallback path should the PRD assume?"',
                  '    source: "compiled"',
                  '    follow_up_round: null',
                  '    answer_type: "free_text"',
                  '    options: []',
                  '    answer:',
                  '      skipped: false',
                  '      selected_option_ids: []',
                  '      free_text: "Use the archive fallback path."',
                  '      answered_by: "ai_skip"',
                  '      answered_at: "2026-04-03T14:20:00.000Z"',
                  'follow_up_rounds: []',
                  'summary:',
                  '  goals: []',
                  '  constraints: []',
                  '  non_goals: []',
                  '  final_free_form_answer: ""',
                  'approval:',
                  '  approved_by: ""',
                  '  approved_at: ""',
                ].join('\n'),
                questionCount: 2,
              },
            ],
            memberOutcomes: {
              'openai/gpt-5.2': 'completed',
            },
          }),
        },
        {
          id: 911,
          ticketId: TEST.ticketId,
          phase: 'REFINING_PRD',
          phaseAttempt: 1,
          artifactType: 'prd_winner',
          filePath: null,
          createdAt: '2026-04-03T14:22:00.000Z',
          updatedAt: '2026-04-03T14:22:00.000Z',
          content: JSON.stringify({ winnerId: 'openai/gpt-5.2' }),
        },
      ],
      isLoading: false,
    })

    renderWithProviders(<PrdApprovalPane ticket={makeTicket({ status: 'WAITING_PRD_APPROVAL' })} />)

    await waitFor(() => {
      expect(screen.getByText('Test problem statement.')).toBeInTheDocument()
    })

    const chip = screen.getByRole('button', { name: /Full Answers/i })
    expect(chip).toHaveTextContent('2')

    fireEvent.click(chip)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Produced by')).toBeInTheDocument()
    expect(screen.getByText('openai/gpt-5.2')).toBeInTheDocument()
    expect(screen.getByText('Which user-owned constraint matters?')).toBeInTheDocument()
    expect(screen.getByText('User selected strict validation.')).toBeInTheDocument()
    expect(screen.getByText('Which fallback path should the PRD assume?')).toBeInTheDocument()
    expect(screen.getByText('Use the archive fallback path.')).toBeInTheDocument()
    expect(screen.getByText(/Answered automatically by AI in Drafting specs status/i)).toBeInTheDocument()
  })

  it('lets approval summary sections collapse and re-open', async () => {
    renderWithProviders(<PrdApprovalPane ticket={makeTicket({ status: 'WAITING_PRD_APPROVAL' })} />)

    await waitFor(() => {
      expect(screen.getByText('Test problem statement.')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Product/i }))
    expect(screen.queryByText('Test problem statement.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Product/i }))
    expect(screen.getByText('Test problem statement.')).toBeInTheDocument()
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })

  it('defaults to structured editing, saves through the PRD route, and approves through approve-prd', async () => {
    renderWithProviders(<PrdApprovalPane ticket={makeTicket({ status: 'WAITING_PRD_APPROVAL' })} />)

    await waitFor(() => {
      expect(screen.getByText('Test problem statement.')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    await waitFor(() => {
      expect(screen.getByLabelText('structured-prd-editor')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('structured-prd-editor'), {
      target: { value: 'Updated problem statement.' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `/api/files/${TEST.ticketId}/prd`,
        expect.objectContaining({ method: 'PUT' }),
      )
    })

    await waitFor(() => {
      expect(screen.getByText('Updated problem statement.')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `/api/tickets/${TEST.ticketId}/approve-prd`,
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  it('shows a cascade warning before editing when beads work has already started', async () => {
    renderWithProviders(<PrdApprovalPane ticket={makeTicket({ status: 'DRAFTING_BEADS' })} />)

    await waitFor(() => {
      expect(screen.getByText('Test problem statement.')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(screen.getByText('Cascading Edit Warning')).toBeInTheDocument()
    expect(screen.getByText('Saving this PRD edit will restart Beads/blueprint planning from the edited PRD. Previous Beads versions will be archived and remain available read-only.')).toBeInTheDocument()
    expect(screen.queryByLabelText('structured-prd-editor')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Proceed with Edit' }))

    await waitFor(() => {
      expect(screen.getByLabelText('structured-prd-editor')).toBeInTheDocument()
    })
  })

  it('confirms before discarding dirty structured edits when switching to YAML', async () => {
    renderWithProviders(<PrdApprovalPane ticket={makeTicket({ status: 'WAITING_PRD_APPROVAL' })} />)

    await waitFor(() => {
      expect(screen.getByText('Test problem statement.')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    await screen.findByLabelText('structured-prd-editor')

    fireEvent.change(screen.getByLabelText('structured-prd-editor'), {
      target: { value: 'Unsaved PRD draft.' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'YAML' }))

    expect(screen.getByText('Discard unsaved PRD edits?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }))

    const yamlEditor = await screen.findByLabelText('YAML editor')
    expect(yamlEditor).toHaveValue(buildPrdDocumentYaml(makePrdDocument()))
    expect(screen.queryByDisplayValue('Unsaved PRD draft.')).not.toBeInTheDocument()
  })

  it('shows unresolved PRD coverage gaps as a collapsible warning during approval', async () => {
    mockUseTicketArtifacts.mockReturnValue({
      artifacts: [
        {
          id: 901,
          ticketId: TEST.ticketId,
          phase: 'WAITING_PRD_APPROVAL',
          artifactType: 'prd_coverage',
          filePath: null,
          createdAt: '2026-04-03T14:22:00.000Z',
          content: JSON.stringify({
            status: 'gaps',
            summary: 'Coverage gaps remain after the final PRD audit.',
            finalCandidateVersion: 3,
            hasRemainingGaps: true,
            remainingGaps: [
              'Missing explicit approval guidance when coverage reaches the retry cap.',
            ],
            auditNotes: 'status: gaps\ngaps:\n  - Missing explicit approval guidance when coverage reaches the retry cap.',
          }),
        },
      ],
      isLoading: false,
    })

    renderWithProviders(<PrdApprovalPane ticket={makeTicket({ status: 'WAITING_PRD_APPROVAL' })} />)

    await waitFor(() => {
      expect(screen.getByText('Test problem statement.')).toBeInTheDocument()
    })

    const warningToggle = screen.getByRole('button', { name: /Coverage Warning/i })
    expect(warningToggle).toBeInTheDocument()
    expect(warningToggle.closest('.overflow-auto')).not.toBeNull()
    expect(screen.queryByText('Remaining Gaps')).not.toBeInTheDocument()

    fireEvent.click(warningToggle)

    expect(screen.getByText('Coverage gaps remain after the final PRD audit.')).toBeInTheDocument()
    expect(screen.getByText('PRD Candidate v3')).toBeInTheDocument()
    expect(screen.getByText('Missing explicit approval guidance when coverage reaches the retry cap.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).not.toBeDisabled()
  })
})
