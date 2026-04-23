import { getOpenCodeAdapter } from '../../opencode/factory'
import type { PhaseIntermediateData } from './types'

export const runningPhases = new Set<string>()
export const adapter = getOpenCodeAdapter()
export const ticketAbortControllers = new Map<string, AbortController>()
export const interviewQASessions = new Map<string, { sessionId: string; winnerId: string }>()
export const SKIP_ALL_INTERVIEW_COVERAGE_RESPONSE = 'Coverage skipped by user shortcut after marking remaining questions skipped.'
export const phaseIntermediate = new Map<string, PhaseIntermediateData>()

/**
 * Cancel all running phases for a ticket by aborting its AbortController.
 * Cleans up in-memory phase state for the ticket.
 */
export function cancelTicket(ticketId: string) {
  const controller = ticketAbortControllers.get(ticketId)
  if (controller) {
    controller.abort()
    ticketAbortControllers.delete(ticketId)
  }

  // Clean up runningPhases entries for this ticket
  for (const key of runningPhases) {
    if (key.startsWith(`${ticketId}:`)) {
      runningPhases.delete(key)
    }
  }

  // Clean up phaseIntermediate entries for this ticket
  for (const key of phaseIntermediate.keys()) {
    if (key.startsWith(`${ticketId}:`)) {
      phaseIntermediate.delete(key)
    }
  }

  // Clean up interview QA session
  interviewQASessions.delete(ticketId)
}

export function getOrCreateAbortSignal(ticketId: string): AbortSignal {
  let controller = ticketAbortControllers.get(ticketId)
  if (!controller) {
    controller = new AbortController()
    ticketAbortControllers.set(ticketId, controller)
  }
  return controller.signal
}
