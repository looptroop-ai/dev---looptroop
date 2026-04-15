import { getLatestPhaseArtifact, upsertLatestPhaseArtifact } from '../../storage/tickets'
import { nowIso } from '../../lib/dateUtils'
import { normalizeExecutionSetupPlanOutput } from '../../structuredOutput'
import type { ExecutionSetupPlan } from './types'
import {
  EXECUTION_SETUP_PLAN_ARTIFACT_TYPE,
  EXECUTION_SETUP_PLAN_RESULT_END,
  EXECUTION_SETUP_PLAN_RESULT_MARKER,
  EXECUTION_SETUP_PLAN_NOTES_ARTIFACT_TYPE,
  EXECUTION_SETUP_PLAN_REPORT_ARTIFACT_TYPE,
  parseExecutionSetupPlanNotes,
  serializeExecutionSetupPlan,
  serializeExecutionSetupPlanNotes,
} from './types'

const EXECUTION_SETUP_PLAN_PHASE = 'WAITING_EXECUTION_SETUP_APPROVAL'

function normalizeStoredExecutionSetupPlanContent(rawContent: string) {
  const content = rawContent.includes(EXECUTION_SETUP_PLAN_RESULT_MARKER)
    ? rawContent
    : `${EXECUTION_SETUP_PLAN_RESULT_MARKER}\n${rawContent}\n${EXECUTION_SETUP_PLAN_RESULT_END}`
  return normalizeExecutionSetupPlanOutput(content)
}

export function readExecutionSetupPlan(ticketId: string): {
  artifactId: number | null
  raw: string | null
  plan: ExecutionSetupPlan | null
  updatedAt: string | null
} {
  const artifact = getLatestPhaseArtifact(ticketId, EXECUTION_SETUP_PLAN_ARTIFACT_TYPE, EXECUTION_SETUP_PLAN_PHASE)
  if (!artifact?.content) {
    return {
      artifactId: null,
      raw: null,
      plan: null,
      updatedAt: null,
    }
  }

  const normalized = normalizeStoredExecutionSetupPlanContent(artifact.content)
  if (!normalized.ok) {
    throw new Error(normalized.error)
  }

  return {
    artifactId: artifact.id,
    raw: artifact.content,
    plan: normalized.value,
    updatedAt: artifact.createdAt,
  }
}

export function saveExecutionSetupPlan(ticketId: string, plan: ExecutionSetupPlan): {
  raw: string
  plan: ExecutionSetupPlan
} {
  const raw = serializeExecutionSetupPlan(plan)
  upsertLatestPhaseArtifact(ticketId, EXECUTION_SETUP_PLAN_ARTIFACT_TYPE, EXECUTION_SETUP_PLAN_PHASE, raw)
  return { raw, plan }
}

export function saveExecutionSetupPlanRawContent(ticketId: string, rawContent: string): {
  raw: string
  plan: ExecutionSetupPlan
} {
  const normalized = normalizeStoredExecutionSetupPlanContent(rawContent)
  if (!normalized.ok) {
    throw new Error(normalized.error)
  }

  return saveExecutionSetupPlan(ticketId, normalized.value)
}

export function appendExecutionSetupPlanNotes(ticketId: string, notes: string[]): string[] {
  const existing = getLatestPhaseArtifact(ticketId, EXECUTION_SETUP_PLAN_NOTES_ARTIFACT_TYPE, EXECUTION_SETUP_PLAN_PHASE)
  const merged = [
    ...parseExecutionSetupPlanNotes(existing?.content),
    ...notes.filter((note) => note.trim().length > 0),
  ]
  upsertLatestPhaseArtifact(
    ticketId,
    EXECUTION_SETUP_PLAN_NOTES_ARTIFACT_TYPE,
    EXECUTION_SETUP_PLAN_PHASE,
    serializeExecutionSetupPlanNotes(merged),
  )
  return merged
}

export function readExecutionSetupPlanNotes(ticketId: string): string[] {
  const artifact = getLatestPhaseArtifact(ticketId, EXECUTION_SETUP_PLAN_NOTES_ARTIFACT_TYPE, EXECUTION_SETUP_PLAN_PHASE)
  return parseExecutionSetupPlanNotes(artifact?.content)
}

export function writeExecutionSetupPlanReport(ticketId: string, content: string) {
  upsertLatestPhaseArtifact(ticketId, EXECUTION_SETUP_PLAN_REPORT_ARTIFACT_TYPE, EXECUTION_SETUP_PLAN_PHASE, content)
}

export function approveExecutionSetupPlan(ticketId: string, plan: ExecutionSetupPlan): {
  approvedAt: string
  stepCount: number
  commandCount: number
} {
  const approvedAt = nowIso()
  const commandCount = plan.steps.reduce((sum, step) => sum + step.commands.length, 0)
  upsertLatestPhaseArtifact(ticketId, 'approval_receipt', EXECUTION_SETUP_PLAN_PHASE, JSON.stringify({
    approved_by: 'user',
    approved_at: approvedAt,
    step_count: plan.steps.length,
    command_count: commandCount,
  }))
  return {
    approvedAt,
    stepCount: plan.steps.length,
    commandCount,
  }
}
