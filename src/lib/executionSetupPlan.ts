import jsYaml from 'js-yaml'

export const EXECUTION_SETUP_PLAN_APPROVAL_FOCUS_EVENT = 'looptroop:execution-setup-plan-focus'

export interface ExecutionSetupPlanStep {
  id: string
  title: string
  purpose: string
  commands: string[]
  required: boolean
  rationale: string
  cautions: string[]
}

export interface ExecutionSetupPlanReadiness {
  status: 'ready' | 'partial' | 'missing'
  actionsRequired: boolean
  evidence: string[]
  gaps: string[]
}

export interface ExecutionSetupPlan {
  schemaVersion: number
  ticketId: string
  artifact: 'execution_setup_plan'
  status: 'draft'
  summary: string
  readiness: ExecutionSetupPlanReadiness
  tempRoots: string[]
  steps: ExecutionSetupPlanStep[]
  projectCommands: {
    prepare: string[]
    testFull: string[]
    lintFull: string[]
    typecheckFull: string[]
  }
  qualityGatePolicy: {
    tests: string
    lint: string
    typecheck: string
    fullProjectFallback: string
  }
  cautions: string[]
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeReadinessStatus(value: unknown): ExecutionSetupPlanReadiness['status'] {
  if (typeof value !== 'string') return 'ready'
  const normalized = value.trim().toLowerCase()
  if (normalized === 'ready') return 'ready'
  if (normalized === 'missing') return 'missing'
  if (['partial', 'needs_setup', 'needs-setup', 'incomplete'].includes(normalized)) return 'partial'
  return 'ready'
}

function toExecutionSetupPlan(value: unknown): ExecutionSetupPlan | null {
  if (!isRecord(value)) return null

  const projectCommands = isRecord(value.projectCommands)
    ? value.projectCommands
    : isRecord(value.project_commands)
      ? value.project_commands
      : {}

  const qualityGatePolicy = isRecord(value.qualityGatePolicy)
    ? value.qualityGatePolicy
    : isRecord(value.quality_gate_policy)
      ? value.quality_gate_policy
      : {}

  const steps = Array.isArray(value.steps)
    ? value.steps.flatMap((step) => {
        if (!isRecord(step)) return []
        return [{
          id: typeof step.id === 'string' ? step.id : '',
          title: typeof step.title === 'string' ? step.title : '',
          purpose: typeof step.purpose === 'string' ? step.purpose : '',
          commands: toStringArray(step.commands),
          required: Boolean(step.required),
          rationale: typeof step.rationale === 'string' ? step.rationale : '',
          cautions: toStringArray(step.cautions),
        } satisfies ExecutionSetupPlanStep]
      })
    : []

  const readinessRecord = isRecord(value.readiness)
    ? value.readiness
    : isRecord(value.environment_readiness)
      ? value.environment_readiness
      : null

  const derivedReadinessStatus: ExecutionSetupPlanReadiness['status'] = steps.length > 0 ? 'partial' : 'ready'
  const readinessStatus = readinessRecord
    ? normalizeReadinessStatus(readinessRecord.status)
    : derivedReadinessStatus
  const actionsRequired = readinessRecord && typeof readinessRecord.actionsRequired === 'boolean'
    ? readinessRecord.actionsRequired
    : readinessRecord && typeof readinessRecord.actions_required === 'boolean'
      ? readinessRecord.actions_required
      : readinessStatus !== 'ready'

  return {
    schemaVersion: typeof value.schemaVersion === 'number'
      ? value.schemaVersion
      : typeof value.schema_version === 'number'
        ? value.schema_version
        : 1,
    ticketId: typeof value.ticketId === 'string'
      ? value.ticketId
      : typeof value.ticket_id === 'string'
        ? value.ticket_id
        : '',
    artifact: 'execution_setup_plan',
    status: 'draft',
    summary: typeof value.summary === 'string' ? value.summary : '',
    readiness: {
      status: readinessStatus,
      actionsRequired,
      evidence: toStringArray(readinessRecord?.evidence),
      gaps: toStringArray(readinessRecord?.gaps),
    },
    tempRoots: toStringArray(value.tempRoots ?? value.temp_roots),
    steps,
    projectCommands: {
      prepare: toStringArray(projectCommands.prepare),
      testFull: toStringArray(projectCommands.testFull ?? projectCommands.test_full),
      lintFull: toStringArray(projectCommands.lintFull ?? projectCommands.lint_full),
      typecheckFull: toStringArray(projectCommands.typecheckFull ?? projectCommands.typecheck_full),
    },
    qualityGatePolicy: {
      tests: typeof qualityGatePolicy.tests === 'string' ? qualityGatePolicy.tests : '',
      lint: typeof qualityGatePolicy.lint === 'string' ? qualityGatePolicy.lint : '',
      typecheck: typeof qualityGatePolicy.typecheck === 'string' ? qualityGatePolicy.typecheck : '',
      fullProjectFallback: typeof qualityGatePolicy.fullProjectFallback === 'string'
        ? qualityGatePolicy.fullProjectFallback
        : typeof qualityGatePolicy.full_project_fallback === 'string'
          ? qualityGatePolicy.full_project_fallback
          : '',
    },
    cautions: toStringArray(value.cautions),
  }
}

export function parseExecutionSetupPlanContent(content: string): { plan: ExecutionSetupPlan | null; error: string | null } {
  const trimmed = content.trim()
  if (!trimmed) {
    return { plan: null, error: 'Execution setup plan content is empty.' }
  }

  try {
    const parsed = trimmed.startsWith('{') || trimmed.startsWith('[')
      ? JSON.parse(trimmed)
      : jsYaml.load(trimmed)
    const plan = toExecutionSetupPlan(parsed)
    if (!plan || !plan.summary) {
      return { plan: null, error: 'Execution setup plan content is missing required fields.' }
    }
    if (plan.readiness.status === 'ready') {
      if (plan.readiness.actionsRequired) {
        return { plan: null, error: 'Ready execution setup plans cannot require actions.' }
      }
      if (plan.readiness.gaps.length > 0) {
        return { plan: null, error: 'Ready execution setup plans cannot list unresolved gaps.' }
      }
      if (plan.steps.length > 0) {
        return { plan: null, error: 'Ready execution setup plans must not include setup steps.' }
      }
    } else if (plan.steps.length === 0) {
      return { plan: null, error: 'Execution setup plans with missing work must include at least one setup step.' }
    }
    return { plan, error: null }
  } catch (error) {
    return {
      plan: null,
      error: error instanceof Error ? error.message : 'Failed to parse execution setup plan content.',
    }
  }
}

export function serializeExecutionSetupPlan(plan: ExecutionSetupPlan): string {
  return JSON.stringify({
    schema_version: plan.schemaVersion,
    ticket_id: plan.ticketId,
    artifact: plan.artifact,
    status: plan.status,
    summary: plan.summary,
    readiness: {
      status: plan.readiness.status,
      actions_required: plan.readiness.actionsRequired,
      evidence: plan.readiness.evidence,
      gaps: plan.readiness.gaps,
    },
    temp_roots: plan.tempRoots,
    steps: plan.steps,
    project_commands: {
      prepare: plan.projectCommands.prepare,
      test_full: plan.projectCommands.testFull,
      lint_full: plan.projectCommands.lintFull,
      typecheck_full: plan.projectCommands.typecheckFull,
    },
    quality_gate_policy: {
      tests: plan.qualityGatePolicy.tests,
      lint: plan.qualityGatePolicy.lint,
      typecheck: plan.qualityGatePolicy.typecheck,
      full_project_fallback: plan.qualityGatePolicy.fullProjectFallback,
    },
    cautions: plan.cautions,
  }, null, 2)
}
