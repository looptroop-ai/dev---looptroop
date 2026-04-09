import type { TicketContext, TicketEvent } from '../../machines/types'
import { getTicketPaths, insertPhaseArtifact } from '../../storage/tickets'
import { isMockOpenCodeMode } from '../../opencode/factory'
import { prepareSquashCandidate, pushSquashedCandidate } from '../../phases/integration/squash'
import { emitPhaseLog } from './helpers'
import { handleMockExecutionUnsupported } from './executionPhase'
import { withCommandLoggingAsync } from '../../log/commandLogger'
import { CancelledError } from '../../council/types'

export async function handleIntegration(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  signal?: AbortSignal,
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

  if (signal?.aborted) throw new CancelledError(ticketId)

  emitPhaseLog(ticketId, context.externalId, 'INTEGRATING_CHANGES', 'info',
    'Analyzing ticket branch for squash...', { source: 'system', audience: 'all' })

  const squash = prepareSquashCandidate(
    paths.worktreePath,
    paths.baseBranch,
    context.title,
    context.externalId,
  )

  let pushResult: { pushed: boolean; error?: string } = { pushed: false }

  if (squash.success) {
    emitPhaseLog(ticketId, context.externalId, 'INTEGRATING_CHANGES', 'info',
      `Squashed ${squash.commitCount ?? '?'} commit(s) into candidate ${squash.commitHash}`,
      { source: 'system', audience: 'all' })

    if (signal?.aborted) throw new CancelledError(ticketId)

    emitPhaseLog(ticketId, context.externalId, 'INTEGRATING_CHANGES', 'info',
      'Pushing candidate to remote...', { source: 'system', audience: 'all' })

    pushResult = pushSquashedCandidate(paths.worktreePath)

    if (pushResult.pushed) {
      emitPhaseLog(ticketId, context.externalId, 'INTEGRATING_CHANGES', 'info',
        'Candidate pushed to remote successfully', { source: 'system', audience: 'all' })
    } else {
      emitPhaseLog(ticketId, context.externalId, 'INTEGRATING_CHANGES', 'error',
        `Push failed (non-blocking): ${pushResult.error}`, { source: 'system', audience: 'all' })
    }
  }

  const report = {
    status: squash.success ? 'passed' : 'failed',
    completedAt: new Date().toISOString(),
    baseBranch: paths.baseBranch,
    preSquashHead: squash.preSquashHead ?? null,
    candidateCommitSha: squash.commitHash ?? null,
    mergeBase: squash.mergeBase ?? null,
    commitCount: squash.commitCount ?? null,
    pushed: pushResult.pushed,
    pushError: pushResult.error ?? null,
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
    emitPhaseLog(ticketId, context.externalId, 'INTEGRATING_CHANGES', 'error',
      `Integration failed: ${squash.message}`, { source: 'system', audience: 'all' })
    throw new Error(squash.message)
  }

  emitPhaseLog(ticketId, context.externalId, 'INTEGRATING_CHANGES', 'info',
    `Integration complete — candidate ${report.candidateCommitSha} ready for manual verification`,
    { source: 'system', audience: 'all' })
  sendEvent({ type: 'INTEGRATION_DONE' })
    },
    (phase, type, content) => emitPhaseLog(ticketId, context.externalId, phase, type, content, { source: 'system', audience: 'all' }),
  )
}
