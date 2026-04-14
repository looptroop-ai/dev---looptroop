export function getBeadDiffQueryKey(ticketId: string, beadId: string) {
  return ['bead-diff', ticketId, beadId] as const
}
