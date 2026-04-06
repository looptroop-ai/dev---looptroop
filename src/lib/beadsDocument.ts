export const BEADS_APPROVAL_FOCUS_EVENT = 'beads-approval-focus'

export function dispatchBeadsApprovalFocus(ticketId: string, anchorId: string): void {
  window.dispatchEvent(new CustomEvent(BEADS_APPROVAL_FOCUS_EVENT, {
    detail: { ticketId, anchorId },
  }))
}
