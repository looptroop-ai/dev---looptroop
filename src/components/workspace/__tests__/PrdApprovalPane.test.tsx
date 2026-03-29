import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ticket } from '@/hooks/useTickets'
import { buildPrdDocumentYaml, type PrdApprovalDraft, type PrdDocument } from '@/lib/prdDocument'
import { PrdApprovalPane } from '../PrdApprovalPane'

const mockSaveUiState = vi.fn()
const mockClearTicketArtifactsCache = vi.fn()

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

function buildPrdDocument(): PrdDocument {
  return {
    schema_version: 1,
    ticket_id: 'PROJ-42',
    artifact: 'prd',
    status: 'draft',
    source_interview: {
      content_sha256: 'abc123',
    },
    product: {
      problem_statement: 'Protect imports from duplicate processing.',
      target_users: ['Operators'],
    },
    scope: {
      in_scope: ['Dedupe webhook retries'],
      out_of_scope: ['Bulk reprocessing'],
    },
    technical_requirements: {
      architecture_constraints: ['Use the existing sync worker.'],
      data_model: [],
      api_contracts: [],
      security_constraints: [],
      performance_constraints: [],
      reliability_constraints: [],
      error_handling_rules: [],
      tooling_assumptions: [],
    },
    epics: [
      {
        id: 'EPIC-1',
        title: 'Retry orchestration',
        objective: 'Coordinate the retry flow.',
        implementation_steps: ['Add retry scheduling'],
        user_stories: [
          {
            id: 'US-1-1',
            title: 'As an operator, I can inspect retry state.',
            acceptance_criteria: ['Retry state is visible.'],
            implementation_steps: ['Render the retry state panel.'],
            verification: { required_commands: ['npm test'] },
          },
        ],
      },
    ],
    risks: ['Retries may amplify traffic.'],
    approval: {
      approved_by: '',
      approved_at: '',
    },
  }
}

function makeTicket(status: string = 'WAITING_PRD_APPROVAL'): Ticket {
  return {
    id: '1:PROJ-42',
    externalId: 'PROJ-42',
    projectId: 1,
    title: 'Retry strategy',
    description: 'Clarify webhook retry behavior.',
    priority: 3,
    status,
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
    createdAt: '2026-03-17T10:00:00.000Z',
    updatedAt: '2026-03-17T10:00:00.000Z',
  }
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

describe('PrdApprovalPane', () => {
  let currentContent = buildPrdDocumentYaml(buildPrdDocument())

  beforeEach(() => {
    currentContent = buildPrdDocumentYaml(buildPrdDocument())
    mockSaveUiState.mockReset()
    mockClearTicketArtifactsCache.mockReset()

    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input)

      if (url === '/api/files/1:PROJ-42/prd' && (!init || init.method === 'GET')) {
        return Promise.resolve(
          new Response(JSON.stringify({ content: currentContent }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      if (url === '/api/files/1:PROJ-42/prd' && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { content?: string; document?: ReturnType<typeof buildPrdDocument> }
        currentContent = body.document ? buildPrdDocumentYaml(body.document) : body.content ?? currentContent
        return Promise.resolve(
          new Response(JSON.stringify({ content: currentContent }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      if (url === '/api/tickets/1:PROJ-42/approve-prd' && init?.method === 'POST') {
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

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    })
  })

  it('renders the dedicated PRD approval view and focuses PRD anchors on demand', async () => {
    renderWithProviders(<PrdApprovalPane ticket={makeTicket()} />)

    await waitFor(() => {
      expect(document.getElementById('prd-product')).not.toBeNull()
    })
  })

  it('lets approval summary sections collapse and re-open', async () => {
    renderWithProviders(<PrdApprovalPane ticket={makeTicket()} />)

    await waitFor(() => {
      expect(screen.getByText('Protect imports from duplicate processing.')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Product/i }))
    expect(screen.queryByText('Protect imports from duplicate processing.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Product/i }))
    expect(screen.getByText('Protect imports from duplicate processing.')).toBeInTheDocument()
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })

  it('defaults to structured editing, saves through the PRD route, and approves through approve-prd', async () => {
    renderWithProviders(<PrdApprovalPane ticket={makeTicket()} />)

    await waitFor(() => {
      expect(screen.getByText('Product Requirements Document')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByText('Cascading Edit Warning')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Proceed with Edit' }))

    expect(await screen.findByLabelText('structured-prd-editor')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('structured-prd-editor'), {
      target: { value: 'Protect imports and keep retries reversible.' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/files/1:PROJ-42/prd',
        expect.objectContaining({ method: 'PUT' }),
      )
    })

    await waitFor(() => {
      expect(screen.getByText('Protect imports and keep retries reversible.')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/tickets/1:PROJ-42/approve-prd',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  it('confirms before discarding dirty structured edits when switching to YAML', async () => {
    renderWithProviders(<PrdApprovalPane ticket={makeTicket()} />)

    await waitFor(() => {
      expect(screen.getByText('Product Requirements Document')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Proceed with Edit' }))

    fireEvent.change(screen.getByLabelText('structured-prd-editor'), {
      target: { value: 'Unsaved PRD draft.' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'YAML' }))

    expect(screen.getByText('Discard unsaved PRD edits?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }))

    const yamlEditor = await screen.findByLabelText('YAML editor')
    expect(yamlEditor).toHaveValue(buildPrdDocumentYaml(buildPrdDocument()))
    expect(screen.queryByDisplayValue('Unsaved PRD draft.')).not.toBeInTheDocument()
  })
})
