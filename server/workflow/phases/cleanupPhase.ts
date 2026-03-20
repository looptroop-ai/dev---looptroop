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
  emitPhaseLog(ticketId, context.externalId, 'CLEANING_ENV', 'info', 'Cleanup phase completed.')
  sendEvent({ type: 'CLEANUP_DONE' })
}
