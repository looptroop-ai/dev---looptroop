import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { initializeDatabase } from '../../db/init'
import { sqlite } from '../../db/index'
import { clearProjectDatabaseCache } from '../../db/project'
import { attachProject } from '../../storage/projects'
import {
  createTicket,
  getLatestPhaseArtifact,
  patchTicket,
  upsertLatestPhaseArtifact,
} from '../../storage/tickets'
import { createFixtureRepoManager } from '../../test/fixtureRepo'
import { initializeTicket } from '../../ticket/initialize'
import { ticketRouter } from '../tickets'

function buildPlan(ticketId: string, summary = 'Prepare the workspace runtime.'): Record<string, unknown> {
  return {
    schema_version: 1,
    ticket_id: ticketId,
    artifact: 'execution_setup_plan',
    status: 'draft',
    summary,
    readiness: {
      status: 'partial',
      actions_required: true,
      evidence: ['Repository manifest files are present.'],
      gaps: ['Reusable workspace setup outputs have not been prepared yet.'],
    },
    temp_roots: ['.ticket/runtime/execution-setup', '.cache/project-tooling'],
    steps: [
      {
        id: 'bootstrap-workspace',
        title: 'Bootstrap workspace',
        purpose: 'Prepare the runtime for later beads.',
        commands: ['project bootstrap'],
        required: true,
        rationale: 'Repository-native setup is required before later execution can reuse the workspace.',
        cautions: ['May take a while on the first run.'],
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
  }
}

vi.mock('../../workflow/phases/executionSetupPlanPhase', async () => {
  const storage = await import('../../storage/tickets')
  return {
    regenerateExecutionSetupPlanDraft: vi.fn(async ({ ticketId, commentary }: { ticketId: string; commentary: string }) => {
      const ticket = storage.getTicketByRef(ticketId)
      const nextPlan = buildPlan(ticket?.externalId ?? 'T-1', `Regenerated: ${commentary}`)
      storage.upsertLatestPhaseArtifact(
        ticketId,
        'execution_setup_plan',
        'WAITING_EXECUTION_SETUP_APPROVAL',
        JSON.stringify(nextPlan, null, 2),
      )
      storage.upsertLatestPhaseArtifact(
        ticketId,
        'execution_setup_plan_report',
        'WAITING_EXECUTION_SETUP_APPROVAL',
        JSON.stringify({
          status: 'draft',
          ready: true,
          generatedAt: new Date().toISOString(),
          generatedBy: 'mock-model',
          summary: nextPlan.summary,
          plan: nextPlan,
          modelOutput: JSON.stringify(nextPlan),
          errors: [],
          source: 'regenerate',
        }),
      )
      return {
        status: 'draft',
        ready: true,
        generatedAt: new Date().toISOString(),
        generatedBy: 'mock-model',
        summary: nextPlan.summary,
        plan: {
          schemaVersion: 1,
          ticketId: ticket?.externalId ?? 'T-1',
          artifact: 'execution_setup_plan',
          status: 'draft',
          summary: nextPlan.summary as string,
          readiness: {
            status: 'partial',
            actionsRequired: true,
            evidence: ['Repository manifest files are present.'],
            gaps: ['Reusable workspace setup outputs have not been prepared yet.'],
          },
          tempRoots: ['.ticket/runtime/execution-setup', '.cache/project-tooling'],
          steps: [
            {
              id: 'bootstrap-workspace',
              title: 'Bootstrap workspace',
              purpose: 'Prepare the runtime for later beads.',
              commands: ['project bootstrap'],
              required: true,
              rationale: 'Repository-native setup is required before later execution can reuse the workspace.',
              cautions: ['May take a while on the first run.'],
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
        },
        modelOutput: JSON.stringify(nextPlan),
        errors: [],
        notes: [commentary],
        source: 'regenerate',
      }
    }),
  }
})

vi.mock('../../machines/persistence', async () => {
  const storage = await import('../../storage/tickets')
  return {
    createTicketActor: vi.fn(),
    ensureActorForTicket: vi.fn(() => ({ id: 'mock-actor' })),
    sendTicketEvent: vi.fn((ticketRef: string | number, event: { type: string }) => {
      if (event.type === 'APPROVE_EXECUTION_SETUP_PLAN') {
        storage.patchTicket(String(ticketRef), { status: 'PREPARING_EXECUTION_ENV' })
      }
      return { value: event.type }
    }),
    getTicketState: vi.fn((ticketRef: string | number) => {
      const ticket = storage.getTicketByRef(String(ticketRef))
      if (!ticket) return null
      return {
        state: ticket.status,
        status: 'active',
        context: {
          ticketId: String(ticketRef),
          projectId: ticket.projectId,
          externalId: ticket.externalId,
          title: ticket.title,
          status: ticket.status,
          lockedMainImplementer: 'mock-model',
          lockedMainImplementerVariant: null,
          lockedCouncilMembers: [],
          lockedCouncilMemberVariants: null,
          lockedInterviewQuestions: null,
          lockedCoverageFollowUpBudgetPercent: null,
          lockedMaxCoveragePasses: null,
          previousStatus: null,
          error: null,
          errorCodes: [],
          beadProgress: { total: 0, completed: 0, current: null },
          iterationCount: 0,
          maxIterations: 3,
          councilResults: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }
    }),
    stopActor: vi.fn(() => true),
    revertTicketToApprovalStatus: vi.fn(),
  }
})

const repoManager = createFixtureRepoManager({
  templatePrefix: 'looptroop-ticket-route-execution-setup-plan-',
  files: {
    'README.md': '# LoopTroop Execution Setup Plan Test\n',
  },
})

function setupExecutionSetupPlanTicket() {
  const repoDir = repoManager.createRepo()
  const project = attachProject({
    folderPath: repoDir,
    name: 'LoopTroop',
    shortname: 'LOOP',
  })
  const ticket = createTicket({
    projectId: project.id,
    title: 'Execution setup plan approval',
    description: 'Verify the execution setup plan approval routes.',
  })

  const init = initializeTicket({
    projectFolder: repoDir,
    externalId: ticket.externalId,
  })

  patchTicket(ticket.id, {
    status: 'WAITING_EXECUTION_SETUP_APPROVAL',
    branchName: init.branchName,
  })

  const app = new Hono()
  app.route('/api', ticketRouter)

  return { app, ticket }
}

describe('ticketRouter execution setup plan approval routes', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    clearProjectDatabaseCache()
    initializeDatabase()
    sqlite.exec('DELETE FROM attached_projects; DELETE FROM profiles;')
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  afterAll(() => {
    clearProjectDatabaseCache()
    repoManager.cleanup()
  })

  it('reads the current execution setup plan draft', async () => {
    const { app, ticket } = setupExecutionSetupPlanTicket()
    upsertLatestPhaseArtifact(
      ticket.id,
      'execution_setup_plan',
      'WAITING_EXECUTION_SETUP_APPROVAL',
      JSON.stringify(buildPlan(ticket.externalId), null, 2),
    )

    const response = await app.request(`/api/tickets/${ticket.id}/execution-setup-plan`)

    expect(response.status).toBe(200)
    const payload = await response.json() as { exists: boolean; plan: { summary: string } }
    expect(payload.exists).toBe(true)
    expect(payload.plan.summary).toBe('Prepare the workspace runtime.')
  })

  it('saves a structured execution setup plan draft', async () => {
    const { app, ticket } = setupExecutionSetupPlanTicket()

    const response = await app.request(`/api/tickets/${ticket.id}/execution-setup-plan`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan: {
          schemaVersion: 1,
          ticketId: ticket.externalId,
          artifact: 'execution_setup_plan',
          status: 'draft',
          summary: 'Structured save',
          readiness: {
            status: 'partial',
            actionsRequired: true,
            evidence: ['Manifest files were found.'],
            gaps: ['Workspace setup outputs still need a bootstrap step.'],
          },
          tempRoots: ['.ticket/runtime/execution-setup', '.cache/project-tooling'],
          steps: [
            {
              id: 'bootstrap-workspace',
              title: 'Bootstrap workspace',
              purpose: 'Prepare the runtime for later beads.',
              commands: ['project bootstrap'],
              required: true,
              rationale: 'Repository-native setup is required.',
              cautions: [],
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
          cautions: [],
        },
      }),
    })

    expect(response.status).toBe(200)
    const payload = await response.json() as { plan: { summary: string } }
    expect(payload.plan.summary).toBe('Structured save')
    const stored = getLatestPhaseArtifact(ticket.id, 'execution_setup_plan', 'WAITING_EXECUTION_SETUP_APPROVAL')
    expect(stored?.content).toContain('Structured save')
  })

  it('saves a no-op execution setup plan when the workspace is already ready', async () => {
    const { app, ticket } = setupExecutionSetupPlanTicket()

    const response = await app.request(`/api/tickets/${ticket.id}/execution-setup-plan`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan: {
          schemaVersion: 1,
          ticketId: ticket.externalId,
          artifact: 'execution_setup_plan',
          status: 'draft',
          summary: 'Workspace already looks ready.',
          readiness: {
            status: 'ready',
            actionsRequired: false,
            evidence: ['Reusable setup profile already exists.'],
            gaps: [],
          },
          tempRoots: ['.ticket/runtime/execution-setup'],
          steps: [],
          projectCommands: {
            prepare: [],
            testFull: [],
            lintFull: [],
            typecheckFull: [],
          },
          qualityGatePolicy: {
            tests: 'bead-test-commands-first',
            lint: 'impacted-or-package',
            typecheck: 'impacted-or-package',
            fullProjectFallback: 'never-block-on-unrelated-baseline',
          },
          cautions: [],
        },
      }),
    })

    expect(response.status).toBe(200)
    const payload = await response.json() as {
      plan: { readiness: { status: string; actionsRequired: boolean }; steps: unknown[] }
    }
    expect(payload.plan.readiness.status).toBe('ready')
    expect(payload.plan.readiness.actionsRequired).toBe(false)
    expect(payload.plan.steps).toHaveLength(0)
  })

  it('rejects inconsistent structured execution setup plans', async () => {
    const { app, ticket } = setupExecutionSetupPlanTicket()

    const response = await app.request(`/api/tickets/${ticket.id}/execution-setup-plan`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan: {
          schemaVersion: 1,
          ticketId: ticket.externalId,
          artifact: 'execution_setup_plan',
          status: 'draft',
          summary: 'Invalid plan',
          readiness: {
            status: 'ready',
            actionsRequired: false,
            evidence: ['Existing runtime artifacts were found.'],
            gaps: [],
          },
          tempRoots: ['.ticket/runtime/execution-setup'],
          steps: [
            {
              id: 'still-has-step',
              title: 'This should not be allowed',
              purpose: 'Contradicts ready status.',
              commands: ['echo invalid'],
              required: false,
              rationale: 'Invalid by design for the test.',
              cautions: [],
            },
          ],
          projectCommands: {
            prepare: [],
            testFull: [],
            lintFull: [],
            typecheckFull: [],
          },
          qualityGatePolicy: {
            tests: 'bead-test-commands-first',
            lint: 'impacted-or-package',
            typecheck: 'impacted-or-package',
            fullProjectFallback: 'never-block-on-unrelated-baseline',
          },
          cautions: [],
        },
      }),
    })

    expect(response.status).toBe(400)
    const payload = await response.json() as { error: string; details: string }
    expect(payload.error).toBe('Failed to save execution setup plan')
    expect(payload.details).toContain('cannot include setup steps when readiness is ready')
  })

  it('regenerates the execution setup plan with commentary', async () => {
    const { app, ticket } = setupExecutionSetupPlanTicket()

    const response = await app.request(`/api/tickets/${ticket.id}/regenerate-execution-setup-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commentary: 'Use the project-native bootstrap command.' }),
    })

    expect(response.status).toBe(200)
    const payload = await response.json() as { plan: { summary: string } }
    expect(payload.plan.summary).toContain('Use the project-native bootstrap command.')
    const stored = getLatestPhaseArtifact(ticket.id, 'execution_setup_plan', 'WAITING_EXECUTION_SETUP_APPROVAL')
    expect(stored?.content).toContain('Use the project-native bootstrap command.')
  })

  it('approves the execution setup plan, stamps approval receipt, and advances the ticket', async () => {
    const { app, ticket } = setupExecutionSetupPlanTicket()
    upsertLatestPhaseArtifact(
      ticket.id,
      'execution_setup_plan',
      'WAITING_EXECUTION_SETUP_APPROVAL',
      JSON.stringify(buildPlan(ticket.externalId), null, 2),
    )

    const response = await app.request(`/api/tickets/${ticket.id}/approve-execution-setup-plan`, {
      method: 'POST',
    })

    expect(response.status).toBe(200)
    const payload = await response.json() as { status?: string; message?: string }
    expect(payload.message).toBe('Execution setup plan approved')
    expect(payload.status).toBe('PREPARING_EXECUTION_ENV')

    const receipt = getLatestPhaseArtifact(ticket.id, 'approval_receipt', 'WAITING_EXECUTION_SETUP_APPROVAL')
    expect(receipt).toBeDefined()
    const receiptData = JSON.parse(receipt!.content)
    expect(receiptData.approved_by).toBe('user')
    expect(receiptData.step_count).toBe(1)
    expect(receiptData.command_count).toBe(1)
  })

  it('dispatches execution setup plan approval through the generic approve route', async () => {
    const { app, ticket } = setupExecutionSetupPlanTicket()
    upsertLatestPhaseArtifact(
      ticket.id,
      'execution_setup_plan',
      'WAITING_EXECUTION_SETUP_APPROVAL',
      JSON.stringify(buildPlan(ticket.externalId), null, 2),
    )

    const response = await app.request(`/api/tickets/${ticket.id}/approve`, {
      method: 'POST',
    })

    expect(response.status).toBe(200)
    const payload = await response.json() as { status?: string; message?: string }
    expect(payload.message).toBe('Execution setup plan approved')
    expect(payload.status).toBe('PREPARING_EXECUTION_ENV')
  })
})
