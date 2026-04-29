import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Hono } from 'hono'
import { initializeDatabase } from '../../db/init'
import { sqlite } from '../../db/index'
import { clearProjectDatabaseCache } from '../../db/project'
import { attachProject } from '../../storage/projects'
import { createTicket, getTicketByRef, patchTicket } from '../../storage/tickets'
import { createFixtureRepoManager } from '../../test/fixtureRepo'
import { initializeTicket } from '../../ticket/initialize'
import { getTicketExecutionLogPath } from '../../storage/paths'

vi.mock('../../workflow/runner', () => ({
  cancelTicket: vi.fn(),
  handleInterviewQABatch: vi.fn(),
  processInterviewBatchAsync: vi.fn(async () => undefined),
  skipAllInterviewQuestionsToApproval: vi.fn(),
}))

vi.mock('../../opencode/sessionManager', () => ({
  abortTicketSessions: vi.fn(async () => undefined),
}))

vi.mock('../../opencode/contextBuilder', () => ({
  clearContextCache: vi.fn(),
}))

vi.mock('../../machines/persistence', () => ({
  createTicketActor: vi.fn(),
  ensureActorForTicket: vi.fn(() => ({ id: 'mock-actor' })),
  revertTicketToApprovalStatus: vi.fn(),
  sendTicketEvent: vi.fn(),
  getTicketState: vi.fn(() => null),
  stopActor: vi.fn(() => true),
}))

import { ticketRouter } from '../tickets'

const repoManager = createFixtureRepoManager({
  templatePrefix: 'looptroop-ticket-route-cancel-',
  files: {
    'README.md': '# LoopTroop Ticket Route Cancel Test\n',
  },
})

function createCancelableTicket(repoDir: string) {
  const project = attachProject({
    folderPath: repoDir,
    name: 'CancelTest',
    shortname: 'CNCL',
  })
  const ticket = createTicket({
    projectId: project.id,
    title: 'Cancel route test',
    description: 'Regression coverage for cancel cleanup.',
  })
  const init = initializeTicket({
    projectFolder: repoDir,
    externalId: ticket.externalId,
  })
  patchTicket(ticket.id, {
    status: 'DRAFTING_PRD',
    branchName: init.branchName,
  })
  // Write a real execution log file so we can assert it exists/is removed.
  const logPath = getTicketExecutionLogPath(repoDir, ticket.externalId)
  mkdirSync(dirname(logPath), { recursive: true })
  writeFileSync(logPath, '{"type":"test"}\n')
  return { project, ticket, init }
}

describe('ticketRouter POST /tickets/:id/cancel', () => {
  const app = new Hono()
  app.route('/api', ticketRouter)

  beforeEach(() => {
    clearProjectDatabaseCache()
    initializeDatabase()
    sqlite.exec('DELETE FROM attached_projects; DELETE FROM profiles;')
  })

  afterAll(() => {
    clearProjectDatabaseCache()
    repoManager.cleanup()
  })

  it('cancels a ticket without cleanup when no body is sent', async () => {
    const repoDir = repoManager.createRepo()
    const { ticket, init } = createCancelableTicket(repoDir)
    const worktreePath = init.worktreePath

    const response = await app.request(`/api/tickets/${ticket.id}/cancel`, {
      method: 'POST',
    })

    expect(response.status).toBe(200)
    const payload = await response.json() as Record<string, unknown>
    expect(payload.message).toBe('Cancel action accepted')

    // Ticket still exists in DB.
    expect(getTicketByRef(ticket.id)).toBeDefined()
    // Worktree is preserved.
    expect(existsSync(worktreePath)).toBe(true)
    // Execution log is preserved.
    const logPath = getTicketExecutionLogPath(repoDir, ticket.externalId)
    expect(existsSync(logPath)).toBe(true)
  })

  it('removes only the execution log when deleteLog=true and deleteContent=false', async () => {
    const repoDir = repoManager.createRepo()
    const { ticket, init } = createCancelableTicket(repoDir)
    const logPath = getTicketExecutionLogPath(repoDir, ticket.externalId)

    expect(existsSync(logPath)).toBe(true)

    const response = await app.request(`/api/tickets/${ticket.id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleteContent: false, deleteLog: true }),
    })

    expect(response.status).toBe(200)
    // Ticket still exists.
    expect(getTicketByRef(ticket.id)).toBeDefined()
    // Worktree still exists.
    expect(existsSync(init.worktreePath)).toBe(true)
    // Log is removed.
    expect(existsSync(logPath)).toBe(false)
  })

  it('removes the worktree and branch when deleteContent=true', async () => {
    const repoDir = repoManager.createRepo()
    const { ticket, init } = createCancelableTicket(repoDir)

    const response = await app.request(`/api/tickets/${ticket.id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleteContent: true, deleteLog: false }),
    })

    expect(response.status).toBe(200)
    // Ticket still exists in DB.
    expect(getTicketByRef(ticket.id)).toBeDefined()
    // Worktree is gone.
    expect(existsSync(init.worktreePath)).toBe(false)
    // Branch is removed.
    const branchResult = spawnSync(
      'git',
      ['-C', repoDir, 'show-ref', '--verify', '--quiet', `refs/heads/${ticket.externalId}`],
      { encoding: 'utf8' },
    )
    expect(branchResult.status).not.toBe(0)
  })

  it('removes worktree and log when both deleteContent and deleteLog are true', async () => {
    const repoDir = repoManager.createRepo()
    const { ticket, init } = createCancelableTicket(repoDir)

    const response = await app.request(`/api/tickets/${ticket.id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleteContent: true, deleteLog: true }),
    })

    expect(response.status).toBe(200)
    expect(getTicketByRef(ticket.id)).toBeDefined()
    expect(existsSync(init.worktreePath)).toBe(false)
  })

  it('returns 404 when the ticket does not exist', async () => {
    const response = await app.request('/api/tickets/nonexistent-id/cancel', {
      method: 'POST',
    })
    expect(response.status).toBe(404)
  })

  it('returns 409 when trying to cancel a terminal ticket', async () => {
    const repoDir = repoManager.createRepo()
    const { ticket } = createCancelableTicket(repoDir)
    patchTicket(ticket.id, { status: 'CANCELED' })

    const response = await app.request(`/api/tickets/${ticket.id}/cancel`, {
      method: 'POST',
    })
    expect(response.status).toBe(409)
  })
})
