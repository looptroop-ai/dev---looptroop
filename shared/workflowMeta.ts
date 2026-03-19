export type KanbanPhase = 'todo' | 'in_progress' | 'needs_input' | 'done'
export type WorkflowGroupId = 'todo' | 'interview' | 'prd' | 'beads' | 'execution' | 'done'
export type WorkflowUIView = 'draft' | 'council' | 'interview_qa' | 'approval' | 'coding' | 'error' | 'done' | 'canceled'
export type EditableArtifactType = 'interview' | 'prd' | 'beads'
export type WorkflowContextKey =
  | 'ticket_details'
  | 'relevant_files'
  | 'drafts'
  | 'interview'
  | 'user_answers'
  | 'votes'
  | 'prd'
  | 'beads'
  | 'beads_draft'
  | 'tests'
  | 'bead_data'
  | 'bead_notes'
  | 'error_context'

export interface WorkflowPhaseMeta {
  id: string
  label: string
  description: string
  kanbanPhase: KanbanPhase
  groupId: WorkflowGroupId
  uiView: WorkflowUIView
  editable: boolean
  multiModelLogs: boolean
  reviewArtifactType?: EditableArtifactType
  progressKind?: 'questions' | 'beads'
  contextSummary: WorkflowContextKey[]
}

export interface WorkflowGroupMeta {
  id: WorkflowGroupId
  label: string
}

export const WORKFLOW_GROUPS: WorkflowGroupMeta[] = [
  { id: 'todo', label: 'To Do' },
  { id: 'interview', label: 'Interview' },
  { id: 'prd', label: 'Specs (PRD)' },
  { id: 'beads', label: 'Blueprint (Beads)' },
  { id: 'execution', label: 'Execution' },
  { id: 'done', label: 'Done' },
]

export const WORKFLOW_PHASES: WorkflowPhaseMeta[] = [
  {
    id: 'DRAFT',
    label: 'Backlog',
    description: 'Ticket created but inactive; backlog item waiting for Start.',
    kanbanPhase: 'todo',
    groupId: 'todo',
    uiView: 'draft',
    editable: true,
    multiModelLogs: false,
    contextSummary: ['ticket_details'],
  },
  {
    id: 'SCANNING_RELEVANT_FILES',
    label: 'Scanning Relevant Files',
    description: 'AI reads and extracts relevant source file contents for context.',
    kanbanPhase: 'in_progress',
    groupId: 'interview',
    uiView: 'council',
    editable: true,
    multiModelLogs: false,
    contextSummary: ['ticket_details'],
  },
  {
    id: 'COUNCIL_DELIBERATING',
    label: 'AI Council Thinking',
    description: 'Models generate initial interview questions and debate approach.',
    kanbanPhase: 'in_progress',
    groupId: 'interview',
    uiView: 'council',
    editable: true,
    multiModelLogs: true,
    contextSummary: ['relevant_files', 'ticket_details'],
  },
  {
    id: 'COUNCIL_VOTING_INTERVIEW',
    label: 'Selecting Best Questions',
    description: 'Models vote on the strongest interview draft.',
    kanbanPhase: 'in_progress',
    groupId: 'interview',
    uiView: 'council',
    editable: true,
    multiModelLogs: true,
    contextSummary: ['relevant_files', 'ticket_details', 'drafts'],
  },
  {
    id: 'COMPILING_INTERVIEW',
    label: 'Preparing Interview',
    description: 'Winning interview draft is consolidated.',
    kanbanPhase: 'in_progress',
    groupId: 'interview',
    uiView: 'council',
    editable: true,
    multiModelLogs: false,
    contextSummary: ['relevant_files', 'ticket_details', 'drafts'],
  },
  {
    id: 'WAITING_INTERVIEW_ANSWERS',
    label: 'Interviewing',
    description: 'Waiting for your interview answers.',
    kanbanPhase: 'needs_input',
    groupId: 'interview',
    uiView: 'interview_qa',
    editable: true,
    multiModelLogs: false,
    progressKind: 'questions',
    contextSummary: ['relevant_files', 'ticket_details', 'interview', 'user_answers'],
  },
  {
    id: 'VERIFYING_INTERVIEW_COVERAGE',
    label: 'Coverage Check (Interview)',
    description: 'Coverage check for interview completeness.',
    kanbanPhase: 'in_progress',
    groupId: 'interview',
    uiView: 'council',
    editable: true,
    multiModelLogs: false,
    contextSummary: ['ticket_details', 'user_answers', 'interview'],
  },
  {
    id: 'WAITING_INTERVIEW_APPROVAL',
    label: 'Approving Interview',
    description: 'Waiting for your approval of interview results.',
    kanbanPhase: 'needs_input',
    groupId: 'interview',
    uiView: 'approval',
    editable: true,
    multiModelLogs: false,
    reviewArtifactType: 'interview',
    contextSummary: ['interview', 'user_answers'],
  },
  {
    id: 'DRAFTING_PRD',
    label: 'Drafting Specs',
    description: 'Models produce competing PRD drafts.',
    kanbanPhase: 'in_progress',
    groupId: 'prd',
    uiView: 'council',
    editable: true,
    multiModelLogs: true,
    contextSummary: ['relevant_files', 'ticket_details', 'interview'],
  },
  {
    id: 'COUNCIL_VOTING_PRD',
    label: 'Voting on Specs',
    description: 'Models vote on the best PRD draft.',
    kanbanPhase: 'in_progress',
    groupId: 'prd',
    uiView: 'council',
    editable: true,
    multiModelLogs: true,
    contextSummary: ['relevant_files', 'ticket_details', 'interview', 'drafts'],
  },
  {
    id: 'REFINING_PRD',
    label: 'Refining Specs',
    description: 'Winner incorporates valuable details from other drafts.',
    kanbanPhase: 'in_progress',
    groupId: 'prd',
    uiView: 'council',
    editable: true,
    multiModelLogs: false,
    contextSummary: ['relevant_files', 'ticket_details', 'interview', 'drafts'],
  },
  {
    id: 'VERIFYING_PRD_COVERAGE',
    label: 'Coverage Check (PRD)',
    description: 'Coverage check for PRD vs interview.',
    kanbanPhase: 'in_progress',
    groupId: 'prd',
    uiView: 'council',
    editable: true,
    multiModelLogs: false,
    contextSummary: ['interview', 'prd'],
  },
  {
    id: 'WAITING_PRD_APPROVAL',
    label: 'Approving Specs',
    description: 'Waiting for your PRD approval.',
    kanbanPhase: 'needs_input',
    groupId: 'prd',
    uiView: 'approval',
    editable: true,
    multiModelLogs: false,
    reviewArtifactType: 'prd',
    contextSummary: ['prd', 'interview'],
  },
  {
    id: 'DRAFTING_BEADS',
    label: 'Architecting Beads',
    description: 'Models split PRD into implementable beads.',
    kanbanPhase: 'in_progress',
    groupId: 'beads',
    uiView: 'council',
    editable: true,
    multiModelLogs: true,
    contextSummary: ['relevant_files', 'ticket_details', 'prd'],
  },
  {
    id: 'COUNCIL_VOTING_BEADS',
    label: 'Voting on Architecture',
    description: 'Models vote on the architecture/beads breakdown.',
    kanbanPhase: 'in_progress',
    groupId: 'beads',
    uiView: 'council',
    editable: true,
    multiModelLogs: true,
    contextSummary: ['relevant_files', 'ticket_details', 'prd', 'drafts'],
  },
  {
    id: 'REFINING_BEADS',
    label: 'Finalizing Plan',
    description: 'Winner refines beads with best details from alternatives.',
    kanbanPhase: 'in_progress',
    groupId: 'beads',
    uiView: 'council',
    editable: true,
    multiModelLogs: false,
    contextSummary: ['relevant_files', 'ticket_details', 'prd', 'drafts'],
  },
  {
    id: 'VERIFYING_BEADS_COVERAGE',
    label: 'Coverage Check (Beads)',
    description: 'Coverage check for beads vs PRD scope.',
    kanbanPhase: 'in_progress',
    groupId: 'beads',
    uiView: 'council',
    editable: true,
    multiModelLogs: false,
    contextSummary: ['prd', 'beads', 'tests'],
  },
  {
    id: 'WAITING_BEADS_APPROVAL',
    label: 'Approving Blueprint',
    description: 'Waiting for your approval of the beads blueprint.',
    kanbanPhase: 'needs_input',
    groupId: 'beads',
    uiView: 'approval',
    editable: true,
    multiModelLogs: false,
    reviewArtifactType: 'beads',
    contextSummary: ['beads', 'prd'],
  },
  {
    id: 'PRE_FLIGHT_CHECK',
    label: 'Initializing Agent',
    description: 'Running checks before coding starts.',
    kanbanPhase: 'in_progress',
    groupId: 'execution',
    uiView: 'coding',
    editable: true,
    multiModelLogs: false,
    contextSummary: ['relevant_files', 'ticket_details'],
  },
  {
    id: 'CODING',
    label: 'Implementing (Bead ?/?)',
    description: 'AI coding agent executes beads with retry loop.',
    kanbanPhase: 'in_progress',
    groupId: 'execution',
    uiView: 'coding',
    editable: false,
    multiModelLogs: false,
    progressKind: 'beads',
    contextSummary: ['bead_data', 'bead_notes'],
  },
  {
    id: 'RUNNING_FINAL_TEST',
    label: 'Self-Testing',
    description: 'Running ticket-level final tests.',
    kanbanPhase: 'in_progress',
    groupId: 'execution',
    uiView: 'coding',
    editable: false,
    multiModelLogs: false,
    contextSummary: ['ticket_details', 'interview', 'prd', 'beads'],
  },
  {
    id: 'INTEGRATING_CHANGES',
    label: 'Finalizing Code',
    description: 'Preparing final candidate branch state.',
    kanbanPhase: 'in_progress',
    groupId: 'execution',
    uiView: 'coding',
    editable: false,
    multiModelLogs: false,
    contextSummary: ['ticket_details', 'prd', 'beads', 'tests'],
  },
  {
    id: 'WAITING_MANUAL_VERIFICATION',
    label: 'Ready for Review',
    description: 'Waiting for your manual verification before completion.',
    kanbanPhase: 'needs_input',
    groupId: 'execution',
    uiView: 'coding',
    editable: false,
    multiModelLogs: false,
    contextSummary: ['ticket_details', 'interview', 'prd', 'beads', 'tests'],
  },
  {
    id: 'CLEANING_ENV',
    label: 'Cleaning Up',
    description: 'Cleaning temporary resources/worktree data.',
    kanbanPhase: 'in_progress',
    groupId: 'execution',
    uiView: 'coding',
    editable: false,
    multiModelLogs: false,
    contextSummary: ['ticket_details', 'beads'],
  },
  {
    id: 'COMPLETED',
    label: 'Done',
    description: 'Ticket closed successfully.',
    kanbanPhase: 'done',
    groupId: 'done',
    uiView: 'done',
    editable: false,
    multiModelLogs: false,
    contextSummary: ['ticket_details', 'interview', 'prd', 'beads', 'tests'],
  },
  {
    id: 'CANCELED',
    label: 'Canceled',
    description: 'Ticket canceled by user action.',
    kanbanPhase: 'done',
    groupId: 'done',
    uiView: 'canceled',
    editable: false,
    multiModelLogs: false,
    contextSummary: ['ticket_details'],
  },
  {
    id: 'BLOCKED_ERROR',
    label: 'Error (reason)',
    description: 'A blocking error requires retry or cancel.',
    kanbanPhase: 'needs_input',
    groupId: 'execution',
    uiView: 'error',
    editable: false,
    multiModelLogs: false,
    contextSummary: ['bead_data', 'error_context'],
  },
]

export const WORKFLOW_PHASE_IDS = WORKFLOW_PHASES.map((phase) => phase.id)

export const WORKFLOW_PHASE_MAP = Object.fromEntries(
  WORKFLOW_PHASES.map((phase) => [phase.id, phase]),
) as Record<string, WorkflowPhaseMeta>

export function getWorkflowPhaseMeta(status: string): WorkflowPhaseMeta | undefined {
  return WORKFLOW_PHASE_MAP[status]
}

export function getWorkflowGroup(groupId: WorkflowGroupId): WorkflowGroupMeta | undefined {
  return WORKFLOW_GROUPS.find((group) => group.id === groupId)
}

export type WorkflowAction = 'start' | 'approve' | 'cancel' | 'retry' | 'verify'

export function getAvailableWorkflowActions(status: string): WorkflowAction[] {
  switch (status) {
    case 'DRAFT':
      return ['start', 'cancel']
    case 'WAITING_INTERVIEW_APPROVAL':
    case 'WAITING_PRD_APPROVAL':
    case 'WAITING_BEADS_APPROVAL':
      return ['approve', 'cancel']
    case 'WAITING_MANUAL_VERIFICATION':
      return ['verify', 'cancel']
    case 'BLOCKED_ERROR':
      return ['retry', 'cancel']
    case 'COMPLETED':
    case 'CANCELED':
      return []
    default:
      return ['cancel']
  }
}
