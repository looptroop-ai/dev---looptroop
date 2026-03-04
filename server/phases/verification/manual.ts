export interface VerificationSummary {
  ticketId: string
  totalBeads: number
  completedBeads: number
  testsPassed: boolean
  squashReady: boolean
  commitHash: string | null
}

export function buildVerificationSummary(
  ticketId: string,
  totalBeads: number,
  completedBeads: number,
  testsPassed: boolean,
  commitHash: string | null,
): VerificationSummary {
  return {
    ticketId,
    totalBeads,
    completedBeads,
    testsPassed,
    squashReady: testsPassed && completedBeads >= totalBeads,
    commitHash,
  }
}
