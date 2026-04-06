import type { TicketContext, TicketEvent } from '../../machines/types'
import { getTicketPaths, insertPhaseArtifact } from '../../storage/tickets'
import { isMockOpenCodeMode } from '../../opencode/factory'
import { prepareSquashCandidate } from '../../phases/integration/squash'
import { emitPhaseLog } from './helpers'
import { handleMockExecutionUnsupported } from './executionPhase'
import { withCommandLoggingAsync } from '../../log/commandLogger'

export async function handleIntegration(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
) {
  if (isMockOpenCodeMode()) {
    await handleMockExecutionUnsupported(ticketId, context, 'INTEGRATING_CHANGES', sendEvent)
    return
  }

  return withCommandLoggingAsync(
    ticketId, context.externalId, 'INTEGRATING_CHANGES',
    async () => {
  const paths = getTicketPaths(ticketId)
  if (!paths) {
    throw new Error(`Ticket workspace not initialized: missing ticket paths for ${context.externalId}`)
  }

  const squash = prepareSquashCandidate(
    paths.worktreePath,
    paths.baseBranch,
    context.title,
    context.externalId,
  )

  const report = {
    status: squash.success ? 'passed' : 'failed',
    completedAt: new Date().toISOString(),
    baseBranch: paths.baseBranch,
    preSquashHead: squash.preSquashHead ?? null,
    candidateCommitSha: squash.commitHash ?? null,
    mergeBase: squash.mergeBase ?? null,
    commitCount: squash.commitCount ?? null,
    message: squash.success
      ? 'Integration phase completed. Manual verification is required before cleanup.'
      : squash.message,
  }
  insertPhaseArtifact(ticketId, {
    phase: 'INTEGRATING_CHANGES',
    artifactType: 'integration_report',
    content: JSON.stringify(report),
  })

  if (!squash.success) {
    emitPhaseLog(ticketId, context.externalId, 'INTEGRATING_CHANGES', 'error', `Integration failed: ${squash.message}`)
    throw new Error(squash.message)
  }

  emitPhaseLog(
    ticketId,
    context.externalId,
    'INTEGRATING_CHANGES',
    'info',
    `Integration phase completed. Candidate commit ${report.candidateCommitSha} is ready on ${context.externalId}.`,
  )
  sendEvent({ type: 'INTEGRATION_DONE' })
    },
    (phase, type, content) => emitPhaseLog(ticketId, context.externalId, phase, type, content),
  )
}
