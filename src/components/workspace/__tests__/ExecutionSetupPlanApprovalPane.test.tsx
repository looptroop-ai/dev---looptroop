import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTicket, TEST } from '@/test/factories'
import { renderWithProviders } from '@/test/renderHelpers'
import { ExecutionSetupPlanApprovalPane } from '../ExecutionSetupPlanApprovalPane'

const mockSaveUiState = vi.fn()
const mockClearTicketArtifactsCache = vi.fn()
const mockUseTicketArtifacts = vi.fn()

function buildPlan(summary = 'Prepare the temporary runtime.') {
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
      gaps: ['Temporary workspace dependencies still need to be prepared.'],
    },
    tempRoots: ['.ticket/runtime/execution-setup'],
    steps: [
      {
        id: 'install-deps',
        title: 'Install dependencies',
        purpose: 'Prepare the runtime for later coding.',
        commands: ['pnpm install --frozen-lockfile'],
        required: true,
        rationale: 'Dependencies need to be present before execution can continue.',
        cautions: ['Can take a while on cold cache.'],
      },
    ],
    projectCommands: {
      prepare: ['pnpm install --frozen-lockfile'],
      testFull: ['pnpm test'],
      lintFull: ['pnpm lint'],
      typecheckFull: ['pnpm typecheck'],
    },
    qualityGatePolicy: {
      tests: 'bead-test-commands-first',
      lint: 'impacted-or-package',
      typecheck: 'impacted-or-package',
      fullProjectFallback: 'never-block-on-unrelated-baseline',
    },
    cautions: ['Stay inside LoopTroop runtime paths only.'],
  }
}

function buildRawPlan(summary = 'Prepare the temporary runtime.') {
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
      gaps: ['Temporary workspace dependencies still need to be prepared.'],
    },
    temp_roots: ['.ticket/runtime/execution-setup'],
    steps: [
      {
        id: 'install-deps',
        title: 'Install dependencies',
        purpose: 'Prepare the runtime for later coding.',
        commands: ['pnpm install --frozen-lockfile'],
        required: true,
        rationale: 'Dependencies need to be present before execution can continue.',
        cautions: ['Can take a while on cold cache.'],
      },
    ],
    project_commands: {
      prepare: ['pnpm install --frozen-lockfile'],
      test_full: ['pnpm test'],
      lint_full: ['pnpm lint'],
      typecheck_full: ['pnpm typecheck'],
    },
    quality_gate_policy: {
      tests: 'bead-test-commands-first',
      lint: 'impacted-or-package',
      typecheck: 'impacted-or-package',
      full_project_fallback: 'never-block-on-unrelated-baseline',
    },
    cautions: ['Stay inside LoopTroop runtime paths only.'],
  }, null, 2)
}

function buildReportContent() {
  return JSON.stringify({
    status: 'draft',
    ready: true,
    generatedAt: '2026-03-25T10:15:00.000Z',
    generatedBy: 'openai/gpt-5',
    summary: 'Prepare the temporary runtime.',
    modelOutput: '<EXECUTION_SETUP_PLAN>\nsummary: generated\n</EXECUTION_SETUP_PLAN>',
    errors: [],
    notes: ['Prefer pnpm over npm.'],
    source: 'auto',
  })
}

vi.mock('@/hooks/useTickets', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useTickets')>('@/hooks/useTickets')
  return {
    ...actual,
    useTicketUIState: () => ({
      data: { scope: 'approval_execution_setup', exists: false, data: null, updatedAt: null },
    }),
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
    mockClearTicketArtifactsCache.mockReset()
    mockUseTicketArtifacts.mockReset()
    mockUseTicketArtifacts.mockReturnValue({
      artifacts: [{
        id: 11,
        ticketId: TEST.ticketId,
        phase: 'WAITING_EXECUTION_SETUP_APPROVAL',
        artifactType: 'execution_setup_plan_report',
        filePath: null,
        content: buildReportContent(),
        createdAt: '2026-03-25T10:15:00.000Z',
      }],
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
    expect(within(dialog).getByText(/describe what should change in the readiness assessment or temporary workspace-preparation plan/i)).toBeInTheDocument()

    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: 'Please switch the bootstrap commands from npm to pnpm.' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Regenerate' }))

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `/api/tickets/${TEST.ticketId}/regenerate-execution-setup-plan`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('Please switch the bootstrap commands from npm to pnpm.'),
        }),
      )
    })

    await waitFor(() => {
      expect(screen.queryByText('Regenerate setup plan')).not.toBeInTheDocument()
    })
  })
})
