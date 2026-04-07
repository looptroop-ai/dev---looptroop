import type { TicketContext, TicketEvent } from '../../machines/types'
import { insertPhaseArtifact } from '../../storage/tickets'
import { isMockOpenCodeMode } from '../../opencode/factory'
import { cleanupTicketResources } from '../../phases/cleanup/cleaner'
import { emitPhaseLog } from './helpers'
import { handleMockExecutionUnsupported } from './executionPhase'

export async function handleCleanup(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
) {
  if (isMockOpenCodeMode()) {
    await handleMockExecutionUnsupported(ticketId, context, 'CLEANING_ENV', sendEvent)
    return
  }

  const report = cleanupTicketResources(ticketId)
  insertPhaseArtifact(ticketId, {
    phase: 'CLEANING_ENV',
    artifactType: 'cleanup_report',
    content: JSON.stringify(report),
  })

  // Emit detailed cleanup report to SYS
  for (const dir of report.removedDirs) {
    emitPhaseLog(ticketId, context.externalId, 'CLEANING_ENV', 'info', `Removed: ${dir}`)
  }
  for (const file of report.removedFiles) {
    emitPhaseLog(ticketId, context.externalId, 'CLEANING_ENV', 'info', `Removed file: ${file}`)
  }
  for (const preserved of report.preservedPaths) {
    emitPhaseLog(ticketId, context.externalId, 'CLEANING_ENV', 'info', `Preserved: ${preserved}`)
  }
  for (const err of report.errors) {
    emitPhaseLog(ticketId, context.externalId, 'CLEANING_ENV', 'error', `Cleanup error: ${err}`)
  }

  emitPhaseLog(ticketId, context.externalId, 'CLEANING_ENV', 'info', 'Cleanup phase completed.')
  sendEvent({ type: 'CLEANUP_DONE' })
}
