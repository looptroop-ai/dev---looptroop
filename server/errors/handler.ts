import type { LoopTroopError } from './types'
import { ERROR_CODES } from './types'
import { broadcaster } from '../sse/broadcaster'

export function createError(
  code: string,
  phase: string,
  message: string,
  details?: Record<string, unknown>,
): LoopTroopError {
  const errorDef = ERROR_CODES[code]
  return {
    code,
    severity: errorDef?.severity ?? 'recoverable',
    message,
    phase,
    details,
    remediation: errorDef?.remediation ?? 'Unknown error. Please check logs.',
  }
}

export function handleError(ticketId: string, error: LoopTroopError) {
  console.error(`[error] ${error.code} in ${error.phase}: ${error.message}`)

  // Broadcast error to connected clients
  broadcaster.broadcast(ticketId, 'error', {
    code: error.code,
    severity: error.severity,
    message: error.message,
    phase: error.phase,
    remediation: error.remediation,
    details: error.details,
  })
}
