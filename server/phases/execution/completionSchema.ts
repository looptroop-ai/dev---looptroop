export interface BeadChecks {
  tests: string
  lint: string
  typecheck: string
  qualitative: string
}

export interface BeadCompletionMarker {
  bead_id: string
  status: 'completed' | 'failed'
  checks: BeadChecks
  reason?: string
}

export const BEAD_STATUS_MARKER = '<BEAD_STATUS>'
export const BEAD_STATUS_END = '</BEAD_STATUS>'
export const REQUIRED_GATES: (keyof BeadChecks)[] = ['tests', 'lint', 'typecheck', 'qualitative']

export function buildCompletionInstructions() {
  return [
    'When you finish a bead, end your response with exactly one JSON marker in these tags:',
    `${BEAD_STATUS_MARKER}{"bead_id":"<bead-id>","status":"completed","checks":{"tests":"pass","lint":"pass","typecheck":"pass","qualitative":"pass"}}${BEAD_STATUS_END}`,
    'If you cannot complete the bead, use the same JSON shape with `"status":"failed"` and include a short `"reason"` field.',
    'Do not use plain-text COMPLETE/FAILED markers.',
  ].join('\n')
}
