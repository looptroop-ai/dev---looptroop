import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTicket, TEST } from '@/test/factories'
import { renderWithProviders } from '@/test/renderHelpers'
import { ExecutionSetupPlanApprovalPane } from '../ExecutionSetupPlanApprovalPane'

const mockSaveUiState = vi.fn()
const mockUseTicketUIState = vi.fn()
const mockClearTicketArtifactsCache = vi.fn()
const mockUseTicketArtifacts = vi.fn()

function buildPlan(summary = 'Prepare the workspace runtime.') {
  return {
    schemaVersion: 1,
    ticketId: TEST.externalId,
    artifact: 'execution_setup_plan' as const,
    status: 'draft' as const,
    summary,
    readiness: {
      status: 'partial' as const,
      actionsRequired: true,
      evidence: ['Manifest and lockfile were detected.'],
      gaps: ['Workspace setup outputs still need to be prepared.'],
    },
    tempRoots: ['.ticket/runtime/execution-setup', '.cache/project-tooling'],
    steps: [
      {
        id: 'bootstrap-workspace',
        title: 'Bootstrap workspace',
        purpose: 'Prepare the runtime for later coding.',
        commands: ['project bootstrap'],
        required: true,
        rationale: 'Repository-native setup must run before execution can continue.',
        cautions: ['Can take a while on cold cache.'],
      },
    ],
    projectCommands: {
      prepare: ['project bootstrap'],
      testFull: ['project test'],
      lintFull: ['project lint'],
      typecheckFull: ['project typecheck'],
    },
    qualityGatePolicy: {
      tests: 'bead-test-commands-first',
      lint: 'impacted-or-package',
      typecheck: 'impacted-or-package',
      fullProjectFallback: 'never-block-on-unrelated-baseline',
    },
    cautions: ['Repository-native bootstrap may create local dependency caches.'],
  }
}

function buildRawPlan(summary = 'Prepare the workspace runtime.') {
  return JSON.stringify({
    schema_version: 1,
    ticket_id: TEST.externalId,
    artifact: 'execution_setup_plan',
    status: 'draft',
    summary,
    readiness: {
      status: 'partial',
      actions_required: true,
      evidence: ['Manifest and lockfile were detected.'],
      gaps: ['Workspace setup outputs still need to be prepared.'],
    },
    temp_roots: ['.ticket/runtime/execution-setup', '.cache/project-tooling'],
    steps: [
      {
        id: 'bootstrap-workspace',
        title: 'Bootstrap workspace',
        purpose: 'Prepare the runtime for later coding.',
        commands: ['project bootstrap'],
        required: true,
        rationale: 'Repository-native setup must run before execution can continue.',
        cautions: ['Can take a while on cold cache.'],
      },
    ],
    project_commands: {
      prepare: ['project bootstrap'],
      test_full: ['project test'],
      lint_full: ['project lint'],
      typecheck_full: ['project typecheck'],
    },
    quality_gate_policy: {
      tests: 'bead-test-commands-first',
      lint: 'impacted-or-package',
      typecheck: 'impacted-or-package',
      full_project_fallback: 'never-block-on-unrelated-baseline',
    },
    cautions: ['Repository-native bootstrap may create local dependency caches.'],
  }, null, 2)
}

function buildReportContent() {
  return JSON.stringify({
    status: 'draft',
    ready: true,
    generatedAt: '2026-03-25T10:15:00.000Z',
    generatedBy: 'openai/gpt-5',
    summary: 'Prepare the workspace runtime.',
    modelOutput: '<EXECUTION_SETUP_PLAN>\nsummary: generated\n</EXECUTION_SETUP_PLAN>',
    errors: [],
    notes: ['Prefer the project-native bootstrap command.'],
    source: 'auto',
  })
}

vi.mock('@/hooks/useTickets', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useTickets')>('@/hooks/useTickets')
  return {
    ...actual,
    useTicketUIState: (...args: unknown[]) => mockUseTicketUIState(...args),
    useSaveTicketUIState: () => ({ mutate: mockSaveUiState }),
  }
})

vi.mock('@/hooks/useTicketArtifacts', () => ({
  clearTicketArtifactsCache: (...args: unknown[]) => mockClearTicketArtifactsCache(...args),
  useTicketArtifacts: (...args: unknown[]) => mockUseTicketArtifacts(...args),
}))

vi.mock('../PhaseArtifactsPanel', () => ({
  PhaseArtifactsPanel: () => <div data-testid="phase-artifacts-panel" />,
}))

vi.mock('../CollapsiblePhaseLogSection', () => ({
  CollapsiblePhaseLogSection: () => <div data-testid="phase-log-section" />,
}))

vi.mock('../ExecutionSetupPlanEditor', () => ({
  ExecutionSetupPlanEditor: () => <div data-testid="execution-setup-plan-editor" />,
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

vi.mock('../ArtifactContentViewer', () => ({
  ArtifactContent: ({
    artifactId,
    content,
    reportContent,
  }: {
    artifactId?: string
    content: string
    reportContent?: string | null
  }) => (
    <div data-testid="artifact-content">
      {artifactId}:{reportContent ? 'with-report' : 'without-report'}:{content.includes('execution_setup_plan') ? 'plan' : 'other'}
    </div>
  ),
}))

describe('ExecutionSetupPlanApprovalPane', () => {
  beforeEach(() => {
    mockSaveUiState.mockReset()
    mockUseTicketUIState.mockReset()
    mockClearTicketArtifactsCache.mockReset()
    mockUseTicketArtifacts.mockReset()
    mockUseTicketUIState.mockReturnValue({
      data: { scope: 'approval_execution_setup', exists: false, data: null, updatedAt: null },
    })
    mockUseTicketArtifacts.mockReturnValue({
      artifacts: [
        {
          id: 11,
          ticketId: TEST.ticketId,
          phase: 'WAITING_EXECUTION_SETUP_APPROVAL',
          artifactType: 'execution_setup_plan_report',
          filePath: null,
          content: buildReportContent(),
          createdAt: '2026-03-25T10:15:00.000Z',
        },
        {
          id: 12,
          ticketId: TEST.ticketId,
          phase: 'WAITING_EXECUTION_SETUP_APPROVAL',
          artifactType: 'approval_receipt',
          filePath: null,
          content: JSON.stringify({
            approved_by: 'user',
            approved_at: '2026-03-25T10:30:00.000Z',
            step_count: 1,
            command_count: 1,
          }),
          createdAt: '2026-03-25T10:30:00.000Z',
        },
      ],
      isLoading: false,
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input)

      if (url === `/api/tickets/${TEST.ticketId}/execution-setup-plan` && (!init || init.method === 'GET')) {
        return Promise.resolve(
          new Response(JSON.stringify({
            exists: true,
            raw: buildRawPlan(),
            plan: buildPlan(),
            updatedAt: '2026-03-25T10:15:00.000Z',
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      if (url === `/api/tickets/${TEST.ticketId}/regenerate-execution-setup-plan` && init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({
            success: true,
            raw: buildRawPlan('Regenerated plan summary.'),
            plan: buildPlan('Regenerated plan summary.'),
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      if (url === `/api/tickets/${TEST.ticketId}/approve-execution-setup-plan` && init?.method === 'POST') {
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

  it('opens regenerate in a modal from the header and submits commentary through the regenerate route', async () => {
    renderWithProviders(<ExecutionSetupPlanApprovalPane ticket={makeTicket({ status: 'WAITING_EXECUTION_SETUP_APPROVAL' })} />)

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(`/api/tickets/${TEST.ticketId}/execution-setup-plan`)
    })

    await waitFor(() => {
      expect(screen.getByTestId('artifact-content')).toHaveTextContent('execution-setup-plan:with-report:plan')
    })

    const header = screen.getByText('Execution Setup Plan').parentElement
    expect(header).not.toBeNull()

    const headerButtons = within(header!).getAllByRole('button')
    const regenerateIndex = headerButtons.findIndex((button) => button.textContent?.includes('Regenerate ...'))
    const editIndex = headerButtons.findIndex((button) => button.textContent === 'Edit')
    expect(regenerateIndex).toBeGreaterThanOrEqual(0)
    expect(editIndex).toBeGreaterThanOrEqual(0)
    expect(regenerateIndex).toBeLessThan(editIndex)

    fireEvent.click(within(header!).getByRole('button', { name: 'Regenerate ...' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Regenerate setup plan')).toBeInTheDocument()
    expect(within(dialog).getByText(/describe what should change in the readiness assessment or workspace-preparation plan/i)).toBeInTheDocument()

    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: 'Please switch to the project-native bootstrap command.' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Regenerate' }))

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `/api/tickets/${TEST.ticketId}/regenerate-execution-setup-plan`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('Please switch to the project-native bootstrap command.'),
        }),
      )
    })

    await waitFor(() => {
      expect(screen.queryByText('Regenerate setup plan')).not.toBeInTheDocument()
    })
  })

  it('renders saved setup plan content without mutation controls in read-only mode', async () => {
    renderWithProviders(<ExecutionSetupPlanApprovalPane ticket={makeTicket({ status: 'PREPARING_EXECUTION_ENV' })} readOnly />)

    await waitFor(() => {
      expect(screen.getByTestId('artifact-content')).toHaveTextContent('execution-setup-plan:with-report:plan')
    })

    expect(screen.getByText('Approved Execution Setup Plan')).toBeInTheDocument()
    expect(screen.getByText('Approved setup contract')).toBeInTheDocument()
    expect(screen.getByText('Approved by user')).toBeInTheDocument()
    expect(screen.getByText('1 step')).toBeInTheDocument()
    expect(screen.getByText('1 command')).toBeInTheDocument()
    expect(screen.getByText('Initial generated draft')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Regenerate ...' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('execution-setup-plan-editor')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('YAML editor')).not.toBeInTheDocument()
  })

  it('ignores persisted edit mode while rendering read-only setup plan review', async () => {
    mockUseTicketUIState.mockReturnValue({
      data: {
        scope: 'approval_execution_setup',
        exists: true,
        updatedAt: '2026-03-25T10:15:00.000Z',
        data: {
          editMode: true,
          editTab: 'raw',
          rawDraft: buildRawPlan('Unsaved persisted draft.'),
          structuredDraft: buildPlan('Unsaved persisted draft.'),
          commentary: 'Regenerate this later.',
        },
      },
    })

    renderWithProviders(<ExecutionSetupPlanApprovalPane ticket={makeTicket({ status: 'PREPARING_EXECUTION_ENV' })} readOnly />)

    await waitFor(() => {
      expect(screen.getByTestId('artifact-content')).toHaveTextContent('execution-setup-plan:with-report:plan')
    })

    expect(screen.queryByTestId('execution-setup-plan-editor')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('YAML editor')).not.toBeInTheDocument()
    expect(screen.queryByText('Unsaved persisted draft.')).not.toBeInTheDocument()
  })
})
