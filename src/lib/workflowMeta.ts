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

export function getCascadeEditWarningMessage(
  currentStatus: string,
  artifactType: EditableArtifactType,
): string | null {
  if (artifactType === 'beads') return null

  const affectedPhases: string[] = []

  if (artifactType === 'interview' && hasReachedStatus(currentStatus, 'DRAFTING_BEADS')) {
    affectedPhases.push('PRD')
  }

  if (hasReachedStatus(currentStatus, 'PRE_FLIGHT_CHECK')) {
    affectedPhases.push('Beads')
  }

  if (affectedPhases.length === 0) return null

  const phaseLabel = affectedPhases.length === 1
    ? `${affectedPhases[0]} phase`
    : `${affectedPhases.join(' and ')} phases`
  const dataLabel = affectedPhases.length === 1
    ? `${affectedPhases[0]} data`
    : `${affectedPhases.join(' and ')} data`
  const artifactLabel = artifactType === 'interview' ? 'Interview Results' : 'the PRD'

  return `Editing ${artifactLabel} will restart the ${phaseLabel}. All previous ${dataLabel} will be lost.`
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
