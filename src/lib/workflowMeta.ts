import {
  type EditableArtifactType,
  type KanbanPhase,
  WORKFLOW_GROUPS,
  WORKFLOW_PHASE_MAP,
  WORKFLOW_PHASES,
} from '@shared/workflowMeta'

export { WORKFLOW_GROUPS, WORKFLOW_PHASES, WORKFLOW_PHASE_MAP }
export type { EditableArtifactType, KanbanPhase }

export interface StatusLabelOptions {
  currentBead?: number | null
  totalBeads?: number | null
  questionIndex?: number | null
  questionTotal?: number | null
  errorMessage?: string | null
}

export const STATUS_TO_PHASE: Record<string, KanbanPhase> = Object.fromEntries(
  WORKFLOW_PHASES.map((phase) => [phase.id, phase.kanbanPhase]),
) as Record<string, KanbanPhase>

export const STATUS_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
  WORKFLOW_PHASES.map((phase) => [phase.id, phase.description]),
) as Record<string, string>

export const STATUS_ORDER: string[] = WORKFLOW_PHASES.map((phase) => phase.id)

const BASE_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  WORKFLOW_PHASES.map((phase) => [phase.id, phase.label]),
) as Record<string, string>

function hasReachedStatus(currentStatus: string, targetStatus: string): boolean {
  const currentIndex = STATUS_ORDER.indexOf(currentStatus)
  const targetIndex = STATUS_ORDER.indexOf(targetStatus)
  return currentIndex >= 0 && targetIndex >= 0 && currentIndex >= targetIndex
}

function isStatusInRange(currentStatus: string, startStatus: string, endStatus: string): boolean {
  return hasReachedStatus(currentStatus, startStatus) && !hasReachedStatus(currentStatus, endStatus)
}

export function getCascadeEditWarningMessage(
  currentStatus: string,
  artifactType: EditableArtifactType,
  previousStatus?: string | null,
): string | null {
  const effectiveStatus = currentStatus === 'BLOCKED_ERROR' && previousStatus
    ? previousStatus
    : currentStatus
  if (artifactType === 'beads' || artifactType === 'execution_setup_plan') return null

  const affectedPhases: string[] = []

  if (
    artifactType === 'interview'
    && isStatusInRange(effectiveStatus, 'DRAFTING_PRD', 'PRE_FLIGHT_CHECK')
  ) {
    affectedPhases.push('PRD')
  }

  const shouldWarnAboutBeads = isStatusInRange(
    effectiveStatus,
    'DRAFTING_BEADS',
    'PRE_FLIGHT_CHECK',
  )

  if (shouldWarnAboutBeads) {
    affectedPhases.push('Beads')
  }

  if (affectedPhases.length === 0) return null

  if (artifactType === 'interview') {
    if (affectedPhases.includes('Beads')) {
      return 'Saving this Interview edit will restart PRD/specs planning and Beads planning from the edited Interview. Previous PRD and Beads versions will be archived and remain available read-only.'
    }

    return 'Saving this Interview edit will restart PRD/specs planning from the edited Interview. Previous PRD versions will be archived and remain available read-only.'
  }

  return 'Saving this PRD edit will restart Beads/blueprint planning from the edited PRD. Previous Beads versions will be archived and remain available read-only.'
}

function formatBlockedErrorLabel(errorMessage?: string | null): string {
  const blockedErrorLabel = BASE_STATUS_LABELS.BLOCKED_ERROR ?? 'Error (reason)'
  if (!errorMessage) return blockedErrorLabel
  const trimmed = errorMessage.trim()
  if (!trimmed) return blockedErrorLabel
  const shortReason = trimmed.length > 56 ? `${trimmed.slice(0, 53)}...` : trimmed
  return `Error (${shortReason})`
}

export function getStatusUserLabel(status: string, options: StatusLabelOptions = {}): string {
  if (status === 'CODING') {
    const current = options.currentBead ?? null
    const total = options.totalBeads ?? null
    if (current && total) return `Implementing (Bead ${current}/${total})`
  }

  if (status === 'WAITING_INTERVIEW_ANSWERS') {
    const index = options.questionIndex ?? null
    const total = options.questionTotal ?? null
    if (index && total) return `Interviewing (Q ${index}/${total})`
  }

  if (status === 'BLOCKED_ERROR') {
    return formatBlockedErrorLabel(options.errorMessage)
  }

  return BASE_STATUS_LABELS[status] ?? status.replace(/_/g, ' ')
}
