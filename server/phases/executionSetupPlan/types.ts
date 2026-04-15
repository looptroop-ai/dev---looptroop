import type {
  ExecutionSetupPlanPayload,
  StructuredOutputMetadata,
} from '../../structuredOutput/types'
import type { Session } from '../../opencode/types'
import type { StructuredRetryDiagnostic } from '@shared/structuredRetryDiagnostics'

export const EXECUTION_SETUP_PLAN_ARTIFACT_TYPE = 'execution_setup_plan'
export const EXECUTION_SETUP_PLAN_REPORT_ARTIFACT_TYPE = 'execution_setup_plan_report'
export const EXECUTION_SETUP_PLAN_NOTES_ARTIFACT_TYPE = 'execution_setup_plan_notes'
export const EXECUTION_SETUP_PLAN_RESULT_MARKER = '<EXECUTION_SETUP_PLAN>'
export const EXECUTION_SETUP_PLAN_RESULT_END = '</EXECUTION_SETUP_PLAN>'

export type ExecutionSetupPlan = ExecutionSetupPlanPayload

export interface ExecutionSetupPlanParseResult {
  markerFound: boolean
  plan: ExecutionSetupPlan | null
  errors: string[]
  repairApplied?: boolean
  repairWarnings?: string[]
  validationError?: string
  retryDiagnostic?: StructuredRetryDiagnostic
}

export interface ExecutionSetupPlanGenerationResult {
  session: Session
  output: string
  plan: ExecutionSetupPlan | null
  parse: ExecutionSetupPlanParseResult
  structuredOutput: StructuredOutputMetadata
}

export interface ExecutionSetupPlanReport {
  status: 'draft' | 'failed'
  ready: boolean
  generatedAt: string
  generatedBy: string
  summary?: string
  plan: ExecutionSetupPlan | null
  modelOutput: string
  errors: string[]
  structuredOutput?: StructuredOutputMetadata
  notes?: string[]
  source: 'auto' | 'regenerate'
}

export function serializeExecutionSetupPlan(plan: ExecutionSetupPlan): string {
  return JSON.stringify({
    schema_version: plan.schemaVersion,
    ticket_id: plan.ticketId,
    artifact: plan.artifact,
    status: plan.status,
    summary: plan.summary,
    temp_roots: plan.tempRoots,
    steps: plan.steps.map((step) => ({
      id: step.id,
      title: step.title,
      purpose: step.purpose,
      commands: step.commands,
      required: step.required,
      rationale: step.rationale,
      cautions: step.cautions,
    })),
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

export function serializeExecutionSetupPlanNotes(notes: string[]): string {
  return JSON.stringify({ notes })
}

export function parseExecutionSetupPlanNotes(content?: string | null): string[] {
  if (!content) return []
  try {
    const parsed = JSON.parse(content) as { notes?: unknown }
    return Array.isArray(parsed.notes)
      ? parsed.notes.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : []
  } catch {
    return []
  }
}

export function flattenExecutionSetupPlanCommands(plan: ExecutionSetupPlan | null | undefined): string[] {
  if (!plan) return []
  return plan.steps.flatMap((step) => step.commands)
}
