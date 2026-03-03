export type KanbanPhase = 'todo' | 'in_progress' | 'needs_input' | 'done'

export interface StatusLabelOptions {
  currentBead?: number | null
  totalBeads?: number | null
  questionIndex?: number | null
  questionTotal?: number | null
  errorMessage?: string | null
}

const BASE_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  COUNCIL_DELIBERATING: 'AI Council Thinking',
  COUNCIL_VOTING_INTERVIEW: 'Selecting Best Questions',
  COMPILING_INTERVIEW: 'Preparing Interview',
  WAITING_INTERVIEW_ANSWERS: 'Interviewing (Q ?/?)',
  VERIFYING_INTERVIEW_COVERAGE: 'Coverage Check (Interview)',
  WAITING_INTERVIEW_APPROVAL: 'Approving Interview',
  DRAFTING_PRD: 'Drafting Specs',
  COUNCIL_VOTING_PRD: 'Voting on Specs',
  REFINING_PRD: 'Refining Specs',
  VERIFYING_PRD_COVERAGE: 'Coverage Check (PRD)',
  WAITING_PRD_APPROVAL: 'Approving Specs',
  DRAFTING_BEADS: 'Architecting Beads',
  COUNCIL_VOTING_BEADS: 'Voting on Architecture',
  REFINING_BEADS: 'Finalizing Plan',
  VERIFYING_BEADS_COVERAGE: 'Coverage Check (Beads)',
  WAITING_BEADS_APPROVAL: 'Approving Blueprint',
  PRE_FLIGHT_CHECK: 'Initializing Agent',
  CODING: 'Implementing (Bead ?/?)',
  RUNNING_FINAL_TEST: 'Self-Testing',
  INTEGRATING_CHANGES: 'Finalizing Code',
  WAITING_MANUAL_VERIFICATION: 'Ready for Review',
  CLEANING_ENV: 'Cleaning Up',
  COMPLETED: 'Done',
  CANCELED: 'Canceled',
  BLOCKED_ERROR: 'Error (reason)',
}

export const STATUS_TO_PHASE: Record<string, KanbanPhase> = {
  DRAFT: 'todo',
  COUNCIL_DELIBERATING: 'in_progress',
  COUNCIL_VOTING_INTERVIEW: 'in_progress',
  COMPILING_INTERVIEW: 'in_progress',
  WAITING_INTERVIEW_ANSWERS: 'needs_input',
  VERIFYING_INTERVIEW_COVERAGE: 'in_progress',
  WAITING_INTERVIEW_APPROVAL: 'needs_input',
  DRAFTING_PRD: 'in_progress',
  COUNCIL_VOTING_PRD: 'in_progress',
  REFINING_PRD: 'in_progress',
  VERIFYING_PRD_COVERAGE: 'in_progress',
  WAITING_PRD_APPROVAL: 'needs_input',
  DRAFTING_BEADS: 'in_progress',
  COUNCIL_VOTING_BEADS: 'in_progress',
  REFINING_BEADS: 'in_progress',
  VERIFYING_BEADS_COVERAGE: 'in_progress',
  WAITING_BEADS_APPROVAL: 'needs_input',
  PRE_FLIGHT_CHECK: 'in_progress',
  CODING: 'in_progress',
  RUNNING_FINAL_TEST: 'in_progress',
  INTEGRATING_CHANGES: 'in_progress',
  WAITING_MANUAL_VERIFICATION: 'needs_input',
  CLEANING_ENV: 'in_progress',
  COMPLETED: 'done',
  CANCELED: 'done',
  BLOCKED_ERROR: 'needs_input',
}

export const STATUS_DESCRIPTIONS: Record<string, string> = {
  DRAFT: 'Ticket created but inactive; waiting for Start.',
  COUNCIL_DELIBERATING: 'Models generate initial interview questions and debate approach.',
  COUNCIL_VOTING_INTERVIEW: 'Models vote on the strongest interview draft.',
  COMPILING_INTERVIEW: 'Winning interview draft is consolidated.',
  WAITING_INTERVIEW_ANSWERS: 'Waiting for your interview answers.',
  VERIFYING_INTERVIEW_COVERAGE: 'Coverage check for interview completeness.',
  WAITING_INTERVIEW_APPROVAL: 'Waiting for your approval of interview results.',
  DRAFTING_PRD: 'Models produce competing PRD drafts.',
  COUNCIL_VOTING_PRD: 'Models vote on the best PRD draft.',
  REFINING_PRD: 'Winner incorporates valuable details from other drafts.',
  VERIFYING_PRD_COVERAGE: 'Coverage check for PRD vs interview.',
  WAITING_PRD_APPROVAL: 'Waiting for your PRD approval.',
  DRAFTING_BEADS: 'Models split PRD into implementable beads.',
  COUNCIL_VOTING_BEADS: 'Models vote on the architecture/beads breakdown.',
  REFINING_BEADS: 'Winner refines beads with best details from alternatives.',
  VERIFYING_BEADS_COVERAGE: 'Coverage check for beads vs PRD scope.',
  WAITING_BEADS_APPROVAL: 'Waiting for your approval of the beads blueprint.',
  PRE_FLIGHT_CHECK: 'Running checks before coding starts.',
  CODING: 'AI coding agent executes beads with retry loop.',
  RUNNING_FINAL_TEST: 'Running ticket-level final tests.',
  INTEGRATING_CHANGES: 'Preparing final candidate branch state.',
  WAITING_MANUAL_VERIFICATION: 'Waiting for your manual verification before completion.',
  CLEANING_ENV: 'Cleaning temporary resources/worktree data.',
  COMPLETED: 'Ticket closed successfully.',
  CANCELED: 'Ticket canceled by user action.',
  BLOCKED_ERROR: 'A blocking error requires retry or cancel.',
}

export const STATUS_ORDER: string[] = [
  'DRAFT',
  'COUNCIL_DELIBERATING',
  'COUNCIL_VOTING_INTERVIEW',
  'COMPILING_INTERVIEW',
  'WAITING_INTERVIEW_ANSWERS',
  'VERIFYING_INTERVIEW_COVERAGE',
  'WAITING_INTERVIEW_APPROVAL',
  'DRAFTING_PRD',
  'COUNCIL_VOTING_PRD',
  'REFINING_PRD',
  'VERIFYING_PRD_COVERAGE',
  'WAITING_PRD_APPROVAL',
  'DRAFTING_BEADS',
  'COUNCIL_VOTING_BEADS',
  'REFINING_BEADS',
  'VERIFYING_BEADS_COVERAGE',
  'WAITING_BEADS_APPROVAL',
  'PRE_FLIGHT_CHECK',
  'CODING',
  'RUNNING_FINAL_TEST',
  'INTEGRATING_CHANGES',
  'WAITING_MANUAL_VERIFICATION',
  'CLEANING_ENV',
  'COMPLETED',
  'CANCELED',
  'BLOCKED_ERROR',
]

const FALLBACK_LABELS = {
  blockedError: 'Error (reason)',
  coding: 'Implementing (Bead ?/?)',
  waitingInterviewAnswers: 'Interviewing (Q ?/?)',
} as const

function formatBlockedErrorLabel(errorMessage?: string | null): string {
  const blockedErrorLabel = BASE_STATUS_LABELS.BLOCKED_ERROR ?? FALLBACK_LABELS.blockedError
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
    return BASE_STATUS_LABELS.CODING ?? FALLBACK_LABELS.coding
  }

  if (status === 'WAITING_INTERVIEW_ANSWERS') {
    const index = options.questionIndex ?? null
    const total = options.questionTotal ?? null
    if (index && total) return `Interviewing (Q ${index}/${total})`
    return BASE_STATUS_LABELS.WAITING_INTERVIEW_ANSWERS ?? FALLBACK_LABELS.waitingInterviewAnswers
  }

  if (status === 'BLOCKED_ERROR') {
    return formatBlockedErrorLabel(options.errorMessage)
  }

  return BASE_STATUS_LABELS[status] ?? status.replace(/_/g, ' ')
}
