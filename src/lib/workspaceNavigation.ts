export const WORKSPACE_PHASE_NAVIGATE_EVENT = 'looptroop:workspace-phase-navigate'

export interface WorkspacePhaseNavigateDetail {
  ticketId: string
  phase: string
  anchorId?: string
}

export function requestWorkspacePhaseNavigation(detail: WorkspacePhaseNavigateDetail) {
  window.dispatchEvent(new CustomEvent(WORKSPACE_PHASE_NAVIGATE_EVENT, {
    detail,
  }))
}
