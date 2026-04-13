import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { initializeDatabase } from '../../db/init'
import { sqlite } from '../../db/index'
import { clearProjectDatabaseCache } from '../../db/project'
import { attachProject } from '../../storage/projects'
import {
  createTicket,
  getLatestPhaseArtifact,
  insertPhaseArtifact,
  patchTicket,
} from '../../storage/tickets'
import { createFixtureRepoManager } from '../../test/fixtureRepo'
import { initializeTicket } from '../../ticket/initialize'
import { ticketRouter } from '../tickets'

const {
  readPullRequestReportMock,
  refreshPullRequestReportMock,
  refreshPullRequestStateMock,
  completeMergedPullRequestMock,
  completeCloseUnmergedMock,
} = vi.hoisted(() => ({
  readPullRequestReportMock: vi.fn(),
  refreshPullRequestReportMock: vi.fn(),
  refreshPullRequestStateMock: vi.fn(),
  completeMergedPullRequestMock: vi.fn(),
  completeCloseUnmergedMock: vi.fn(),
}))

vi.mock('../../workflow/phases/pullRequestPhase', () => ({
  readPullRequestReport: readPullRequestReportMock,
  refreshPullRequestReport: refreshPullRequestReportMock,
  refreshPullRequestState: refreshPullRequestStateMock,
  completeMergedPullRequest: completeMergedPullRequestMock,
  completeCloseUnmerged: completeCloseUnmergedMock,
}))

vi.mock('../../machines/persistence', async () => {
  const storage = await import('../../storage/tickets')

  return {
    createTicketActor: vi.fn(),
    ensureActorForTicket: vi.fn(() => ({ id: 'mock-actor' })),
    sendTicketEvent: vi.fn((ticketRef: string | number, event: { type: string; message?: string | null }) => {
      const resolvedTicketRef = String(ticketRef)
      if (event.type === 'MERGE_COMPLETE' || event.type === 'CLOSE_UNMERGED_COMPLETE') {
        storage.patchTicket(resolvedTicketRef, { status: 'CLEANING_ENV' })
      }
      if (event.type === 'ERROR') {
        storage.patchTicket(resolvedTicketRef, {
          status: 'BLOCKED_ERROR',
          errorMessage: event.message ?? null,
        })
      }
      return { value: event.type }
    }),
    getTicketState: vi.fn((ticketRef: string | number) => {
      const ticket = storage.getTicketByRef(String(ticketRef))
      if (!ticket) return null
      return {
        state: ticket.status,
        context: {},
        status: 'active',
      }
    }),
    stopActor: vi.fn(() => true),
  }
})

const repoManager = createFixtureRepoManager({
  templatePrefix: 'looptroop-ticket-route-pr-review-',
  files: {
    'README.md': 'base\n',
  },
})

function createWaitingPrReviewTicket() {
  const repoDir = repoManager.createRepo()
  const project = attachProject({
    folderPath: repoDir,
    name: 'LoopTroop',
    shortname: 'LOOP',
  })
  const ticket = createTicket({
    projectId: project.id,
    title: 'PR review',
    description: 'Verify the PR review routes.',
  })

  const init = initializeTicket({
    projectFolder: repoDir,
    externalId: ticket.externalId,
  })

  patchTicket(ticket.id, {
    status: 'WAITING_PR_REVIEW',
    branchName: init.branchName,
  })

  insertPhaseArtifact(ticket.id, {
    phase: 'INTEGRATING_CHANGES',
    artifactType: 'integration_report',
    content: JSON.stringify({
      status: 'passed',
      baseBranch: init.baseBranch,
      candidateCommitSha: 'abc123def456',
      preSquashHead: 'old789hash',
      mergeBase: 'mergebase123',
    }),
  })

  return { repoDir, ticket, init }
}

describe('ticketRouter PR review routes', () => {
  beforeEach(() => {
    clearProjectDatabaseCache()
    initializeDatabase()
    sqlite.exec('DELETE FROM attached_projects; DELETE FROM profiles;')
    vi.clearAllMocks()
    refreshPullRequestStateMock.mockReturnValue(null)
    readPullRequestReportMock.mockReturnValue({
      status: 'passed',
      completedAt: '2026-01-01T00:00:00.000Z',
      baseBranch: 'main',
      headBranch: 'TEST-1',
      candidateCommitSha: 'abc123def456',
      prNumber: 42,
      prUrl: 'https://github.com/test/repo/pull/42',
      prState: 'draft',
      prHeadSha: 'abc123def456',
      title: 'TEST-1: PR review',
      body: '## Summary\n- test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      mergedAt: null,
      closedAt: null,
      message: 'Draft PR ready.',
    })
    completeMergedPullRequestMock.mockImplementation((input: { ticketId: string }) => {
      insertPhaseArtifact(input.ticketId, {
        phase: 'WAITING_PR_REVIEW',
        artifactType: 'merge_report',
        content: JSON.stringify({ disposition: 'merged' }),
      })
      return {
        status: 'passed',
        completedAt: '2026-01-01T00:00:00.000Z',
        disposition: 'merged',
        baseBranch: 'main',
        headBranch: 'TEST-1',
        candidateCommitSha: 'abc123def456',
        prNumber: 42,
        prUrl: 'https://github.com/test/repo/pull/42',
        prState: 'merged',
        prHeadSha: 'abc123def456',
        localBaseHead: 'base123',
        remoteBaseHead: 'base123',
        remoteBranchDeleteWarning: null,
        message: 'Pull request merged and local main synced to origin/main.',
      }
    })
    completeCloseUnmergedMock.mockImplementation((input: { ticketId: string }) => {
      insertPhaseArtifact(input.ticketId, {
        phase: 'WAITING_PR_REVIEW',
        artifactType: 'merge_report',
        content: JSON.stringify({ disposition: 'closed_unmerged' }),
      })
      return {
        status: 'passed',
        completedAt: '2026-01-01T00:00:00.000Z',
        disposition: 'closed_unmerged',
        baseBranch: 'main',
        headBranch: 'TEST-1',
        candidateCommitSha: 'abc123def456',
        prNumber: 42,
        prUrl: 'https://github.com/test/repo/pull/42',
        prState: 'draft',
        prHeadSha: 'abc123def456',
        localBaseHead: null,
        remoteBaseHead: null,
        remoteBranchDeleteWarning: null,
        message: 'Ticket finished without merging the pull request. The pull request and remote branch were left untouched.',
      }
    })
  })

  it('merges the pull request and advances to cleanup', async () => {
    const { ticket } = createWaitingPrReviewTicket()
    const app = new Hono()
    app.route('/api', ticketRouter)

    const response = await app.request(`/api/tickets/${ticket.id}/merge`, { method: 'POST' })

    expect(response.status).toBe(200)
    const payload = await response.json() as { status?: string; message?: string }
    expect(payload).toMatchObject({
      status: 'CLEANING_ENV',
      message: 'Merge complete',
    })
    expect(completeMergedPullRequestMock).toHaveBeenCalledOnce()
  })

  it('finishes without merge and advances to cleanup', async () => {
    const { ticket } = createWaitingPrReviewTicket()
    const app = new Hono()
    app.route('/api', ticketRouter)

    const response = await app.request(`/api/tickets/${ticket.id}/close-unmerged`, { method: 'POST' })

    expect(response.status).toBe(200)
    const payload = await response.json() as { status?: string; message?: string }
    expect(payload).toMatchObject({
      status: 'CLEANING_ENV',
      message: 'Finished without merge',
    })
    expect(completeCloseUnmergedMock).toHaveBeenCalledOnce()
  })

  it('keeps /verify as an alias for merge during the transition', async () => {
    const { ticket } = createWaitingPrReviewTicket()
    const app = new Hono()
    app.route('/api', ticketRouter)

    const response = await app.request(`/api/tickets/${ticket.id}/verify`, { method: 'POST' })

    expect(response.status).toBe(200)
    const payload = await response.json() as { status?: string; message?: string }
    expect(payload).toMatchObject({
      status: 'CLEANING_ENV',
      message: 'Merge complete',
    })
    expect(completeMergedPullRequestMock).toHaveBeenCalledOnce()
  })

  it('persists a close-unmerged merge report artifact', async () => {
    const { ticket } = createWaitingPrReviewTicket()
    const app = new Hono()
    app.route('/api', ticketRouter)

    const response = await app.request(`/api/tickets/${ticket.id}/close-unmerged`, { method: 'POST' })

    expect(response.status).toBe(200)
    const artifact = getLatestPhaseArtifact(ticket.id, 'merge_report', 'WAITING_PR_REVIEW')
    expect(artifact).toBeDefined()
    const report = JSON.parse(artifact!.content) as { disposition?: string }
    expect(report.disposition).toBe('closed_unmerged')
  })
})
