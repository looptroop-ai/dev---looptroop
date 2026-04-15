import type {
  ExecutionSetupProfilePayload,
  ExecutionSetupResultPayload,
  StructuredOutputMetadata,
} from '../../structuredOutput/types'
import type { Session } from '../../opencode/types'
import type { StructuredRetryDiagnostic } from '@shared/structuredRetryDiagnostics'

export const EXECUTION_SETUP_PROFILE_ARTIFACT_TYPE = 'execution_setup_profile'
export const EXECUTION_SETUP_REPORT_ARTIFACT_TYPE = 'execution_setup_report'
export const EXECUTION_SETUP_RETRY_NOTES_ARTIFACT_TYPE = 'execution_setup_retry_notes'
export const EXECUTION_SETUP_RESULT_MARKER = '<EXECUTION_SETUP_RESULT>'
export const EXECUTION_SETUP_RESULT_END = '</EXECUTION_SETUP_RESULT>'

export const EXECUTION_SETUP_RUNTIME_DIR = '.ticket/runtime/execution-setup'
export const EXECUTION_SETUP_PROFILE_MIRROR = '.ticket/runtime/execution-setup-profile.json'
export const EXECUTION_LOG_RUNTIME_PATH = '.ticket/runtime/execution-log.jsonl'

export type ExecutionSetupProfile = ExecutionSetupProfilePayload
export type ExecutionSetupResult = ExecutionSetupResultPayload

export interface ExecutionSetupParseResult {
  markerFound: boolean
  result: ExecutionSetupResult | null
  errors: string[]
  repairApplied?: boolean
  repairWarnings?: string[]
  validationError?: string
  retryDiagnostic?: StructuredRetryDiagnostic
}

export interface ExecutionSetupGenerationResult {
  session: Session
  output: string
  result: ExecutionSetupResult | null
  parse: ExecutionSetupParseResult
  structuredOutput: StructuredOutputMetadata
}

export interface ExecutionSetupAttemptHistoryEntry {
  attempt: number
  status: 'ready' | 'failed'
  checkedAt: string
  summary?: string
  tempRoots: string[]
  bootstrapCommands: string[]
  errors: string[]
  failureReason?: string
  noteAppended?: string
}

export interface ExecutionSetupReport {
  status: 'ready' | 'failed'
  ready: boolean
  checkedAt: string
  preparedBy: string
  summary?: string
  profile: ExecutionSetupProfile | null
  checks: ExecutionSetupResult['checks'] | null
  modelOutput: string
  errors: string[]
  structuredOutput?: StructuredOutputMetadata
  attempt?: number
  maxIterations?: number | null
  attemptHistory?: ExecutionSetupAttemptHistoryEntry[]
  retryNotes?: string[]
  approvedPlanCommands?: string[]
  executionAddedCommands?: string[]
}

export function serializeExecutionSetupRetryNotes(notes: string[]): string {
  return JSON.stringify({ notes })
}

export function toExecutionSetupProfileArtifact(profile: ExecutionSetupProfile): Record<string, unknown> {
  return {
    schema_version: profile.schemaVersion,
    ticket_id: profile.ticketId,
    artifact: profile.artifact,
    status: profile.status,
    summary: profile.summary,
    temp_roots: profile.tempRoots,
    bootstrap_commands: profile.bootstrapCommands,
    reusable_artifacts: profile.reusableArtifacts.map((artifact) => ({
      path: artifact.path,
      kind: artifact.kind,
      purpose: artifact.purpose,
    })),
    project_commands: {
      prepare: profile.projectCommands.prepare,
      test_full: profile.projectCommands.testFull,
      lint_full: profile.projectCommands.lintFull,
      typecheck_full: profile.projectCommands.typecheckFull,
    },
    quality_gate_policy: {
      tests: profile.qualityGatePolicy.tests,
      lint: profile.qualityGatePolicy.lint,
      typecheck: profile.qualityGatePolicy.typecheck,
      full_project_fallback: profile.qualityGatePolicy.fullProjectFallback,
    },
    cautions: profile.cautions,
  }
}

export function serializeExecutionSetupProfile(profile: ExecutionSetupProfile): string {
  return JSON.stringify(toExecutionSetupProfileArtifact(profile), null, 2)
}

export function parseExecutionSetupRetryNotes(content?: string | null): string[] {
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
