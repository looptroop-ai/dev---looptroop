export interface BeadChecks {
  tests: string
  lint: string
  typecheck: string
  qualitative: string
}

export interface CompletionResult {
  complete: boolean
  markerFound: boolean
  gatesValid: boolean
  beadId?: string
  checks?: BeadChecks
  errors: string[]
}

const BEAD_STATUS_MARKER = '<BEAD_STATUS>'
const BEAD_STATUS_END = '</BEAD_STATUS>'
const REQUIRED_GATES: (keyof BeadChecks)[] = ['tests', 'lint', 'typecheck', 'qualitative']

export function parseCompletionMarker(output: string): CompletionResult {
  const errors: string[] = []

  // Check for completion marker
  const markerStart = output.lastIndexOf(BEAD_STATUS_MARKER)
  const markerEnd = output.lastIndexOf(BEAD_STATUS_END)

  if (markerStart === -1 || markerEnd === -1 || markerEnd < markerStart) {
    return {
      complete: false,
      markerFound: false,
      gatesValid: false,
      errors: ['No completion marker found'],
    }
  }

  const markerContent = output.slice(markerStart + BEAD_STATUS_MARKER.length, markerEnd).trim()

  // Parse JSON marker per spec:
  // {"bead_id":"...","status":"completed","checks":{"tests":"pass","lint":"pass","typecheck":"pass","qualitative":"pass"}}
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(markerContent)
  } catch {
    errors.push(`Invalid JSON in completion marker: ${markerContent}`)
    return { complete: false, markerFound: true, gatesValid: false, errors }
  }

  // Validate required fields
  if (typeof parsed.bead_id !== 'string' || !parsed.bead_id) {
    errors.push('Completion marker missing bead_id field')
  }

  if (typeof parsed.status !== 'string') {
    errors.push('Completion marker missing status field')
  }

  const isComplete = parsed.status === 'completed'
  const isFailed = parsed.status === 'failed'

  // Validate quality gates
  const checks = parsed.checks as Record<string, string> | undefined
  let gatesValid = true

  if (!checks || typeof checks !== 'object') {
    errors.push('Completion marker missing checks object')
    gatesValid = false
  } else {
    for (const gate of REQUIRED_GATES) {
      if (typeof checks[gate] !== 'string') {
        errors.push(`Missing quality gate: ${gate}`)
        gatesValid = false
      } else if (checks[gate] !== 'pass') {
        errors.push(`Quality gate failed: ${gate} = ${checks[gate]}`)
        gatesValid = false
      }
    }
  }

  if (isFailed) {
    errors.push(`Bead reported status: ${parsed.status}`)
  }

  // Marker says complete but gates fail → treat as incomplete per spec
  if (isComplete && !gatesValid) {
    errors.push('Marker says completed but quality gates failed — treating as incomplete')
  }

  return {
    complete: isComplete && gatesValid,
    markerFound: true,
    gatesValid,
    beadId: typeof parsed.bead_id === 'string' ? parsed.bead_id : undefined,
    checks: checks ? {
      tests: checks.tests ?? '',
      lint: checks.lint ?? '',
      typecheck: checks.typecheck ?? '',
      qualitative: checks.qualitative ?? '',
    } : undefined,
    errors,
  }
}
