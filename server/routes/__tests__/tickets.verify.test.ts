import { AsyncLocalStorage } from 'node:async_hooks'
import { execFileSync } from 'node:child_process'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initializeDatabase } from '../../db/init'
import { sqlite } from '../../db/index'
import { clearProjectDatabaseCache } from '../../db/project'
import { broadcaster } from '../../sse/broadcaster'
import { attachProject } from '../../storage/projects'
import {
  createTicket,
  getLatestPhaseArtifact,
  getTicketByRef,
  getTicketPaths,
  insertPhaseArtifact,
  patchTicket,
} from '../../storage/tickets'
import { createFixtureRepoManager } from '../../test/fixtureRepo'
import { initializeTicket } from '../../ticket/initialize'
import { ticketRouter } from '../tickets'

interface CommandLogContext {
  ticketId: string
  externalId: string
  phase: string
  emit: (phase: string, type: 'info' | 'error', content: string) => void
}

const STORE_KEY = Symbol.for('looptroop:commandLogStore')

function getSharedCommandLogStore(): AsyncLocalStorage<CommandLogContext> {
  const globalStore = globalThis as unknown as Record<symbol, AsyncLocalStorage<CommandLogContext> | undefined>
  if (!globalStore[STORE_KEY]) {
    globalStore[STORE_KEY] = new AsyncLocalStorage<CommandLogContext>()
  }
  return globalStore[STORE_KEY]!
}

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')

  return {
    ...actual,
    spawnSync: vi.fn((command: string, args: readonly string[], options?: Parameters<typeof actual.spawnSync>[2]) => {
      const result = actual.spawnSync(command, args, options)
      const ctx = getSharedCommandLogStore().getStore()

      if (ctx && command === 'git') {
        ctx.emit(
          ctx.phase,
          result.status === 0 && !result.error ? 'info' : 'error',
          `[CMD] $ git ${args.join(' ')}`,
        )
      }

      return result
    }),
  }
})

vi.mock('../../machines/persistence', async () => {
  const storage = await import('../../storage/tickets')

  return {
    createTicketActor: vi.fn(),
    ensureActorForTicket: vi.fn(() => ({ id: 'mock-actor' })),
    sendTicketEvent: vi.fn((ticketRef: string | number, event: { type: string; message?: string | null }) => {
      const resolvedTicketRef = String(ticketRef)
      if (event.type === 'VERIFY_COMPLETE') {
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
  templatePrefix: 'looptroop-ticket-route-verify-',
  files: {
    'README.md': 'base\n',
  },
})
const remoteDirs = new Set<string>()
const FILTERED_STATUS_COMMAND = 'status --porcelain --untracked-files=all -- . :(top,exclude).looptroop'

interface PersistedLogEvent {
  phase?: string
  status?: string
  type?: string
  message?: string
  content?: string
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
}

function readPersistedLogEvents(executionLogPath: string): PersistedLogEvent[] {
  if (!existsSync(executionLogPath)) return []

  const raw = readFileSync(executionLogPath, 'utf-8').trim()
  if (!raw) return []

  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as PersistedLogEvent)
}

function setupVerifyTicketApp() {
  const repoDir = repoManager.createRepo()
  const remoteDir = mkdtempSync(resolve(tmpdir(), 'looptroop-ticket-route-verify-remote-'))
  remoteDirs.add(remoteDir)
  execFileSync('git', ['init', '--bare', remoteDir], { stdio: 'pipe' })
  git(repoDir, ['remote', 'add', 'origin', remoteDir])
  git(repoDir, ['push', '-u', 'origin', 'main'])

  const project = attachProject({
    folderPath: repoDir,
    name: 'LoopTroop',
    shortname: 'LOOP',
  })
  writeFileSync(resolve(repoDir, '.looptroop', 'runtime-marker.txt'), 'runtime\n')
  const ticket = createTicket({
    projectId: project.id,
    title: 'Manual verification',
    description: 'Verify manual verification logging.',
  })

  const init = initializeTicket({
    projectFolder: repoDir,
    externalId: ticket.externalId,
  })

  patchTicket(ticket.id, {
    status: 'WAITING_MANUAL_VERIFICATION',
    branchName: init.branchName,
  })

  const readmePath = resolve(init.worktreePath, 'README.md')
  writeFileSync(readmePath, 'ticket change\n')
  git(init.worktreePath, ['add', 'README.md'])
  git(init.worktreePath, ['commit', '-m', 'wip change'])
  const preSquashHead = git(init.worktreePath, ['rev-parse', 'HEAD'])
  git(init.worktreePath, ['push', 'origin', `HEAD:refs/heads/${ticket.externalId}`])

  git(init.worktreePath, ['reset', '--soft', 'HEAD~1'])
  git(init.worktreePath, ['commit', '-m', 'candidate squash'])
  const candidateCommitSha = git(init.worktreePath, ['rev-parse', 'HEAD'])
  insertPhaseArtifact(ticket.id, {
    phase: 'INTEGRATING_CHANGES',
    artifactType: 'integration_report',
    content: JSON.stringify({
      status: 'passed',
      baseBranch: init.baseBranch,
      preSquashHead,
      candidateCommitSha,
      pushed: false,
      pushDeferred: true,
      pushError: null,
    }),
  })

  const paths = getTicketPaths(ticket.id)
  if (!paths) {
    throw new Error('Ticket workspace not initialized')
  }

  const app = new Hono()
  app.route('/api', ticketRouter)

  return { app, repoDir, remoteDir, ticket, executionLogPath: paths.executionLogPath, candidateCommitSha }
}

describe('ticketRouter POST /tickets/:id/verify', () => {
  beforeEach(() => {
    clearProjectDatabaseCache()
    initializeDatabase()
    sqlite.exec('DELETE FROM attached_projects; DELETE FROM profiles;')
    vi.restoreAllMocks()
  })

  afterAll(() => {
    clearProjectDatabaseCache()
    repoManager.cleanup()
    for (const remoteDir of remoteDirs) {
      rmSync(remoteDir, { recursive: true, force: true })
    }
    remoteDirs.clear()
  })

  it('rewrites the remote ticket branch on verify and logs the merge flow', async () => {
    const { app, repoDir, ticket, executionLogPath, candidateCommitSha } = setupVerifyTicketApp()
    const broadcastSpy = vi.spyOn(broadcaster, 'broadcast')

    expect(git(repoDir, ['status', '--porcelain'])).toBe('')

    const response = await app.request(`/api/tickets/${ticket.id}/verify`, {
      method: 'POST',
    })

    expect(response.status).toBe(200)
    const payload = await response.json() as { status?: string; message?: string }
    expect(payload).toMatchObject({
      status: 'CLEANING_ENV',
      message: 'Verification complete',
    })
    expect(getTicketByRef(ticket.id)?.status).toBe('CLEANING_ENV')
    expect(readFileSync(resolve(repoDir, 'README.md'), 'utf-8')).toBe('ticket change\n')
    const remoteTicketSha = git(repoDir, ['ls-remote', '--heads', 'origin', `refs/heads/${ticket.externalId}`]).split(/\s+/)[0]
    expect(remoteTicketSha).toBe(candidateCommitSha)

    const verificationArtifact = getLatestPhaseArtifact(ticket.id, 'verification_merge_report', 'WAITING_MANUAL_VERIFICATION')
    expect(verificationArtifact).toBeDefined()

    const emittedCommandLogs = broadcastSpy.mock.calls
      .filter(([, event, data]) =>
        event === 'log'
        && data.phase === 'WAITING_MANUAL_VERIFICATION'
        && String(data.content ?? '').startsWith('[CMD]'))
      .map(([, , data]) => String(data.content ?? ''))

    expect(emittedCommandLogs.length).toBeGreaterThan(0)
    expect(emittedCommandLogs.some((msg) => msg.includes('push --progress --force-with-lease'))).toBe(true)
    expect(emittedCommandLogs.some((msg) => msg.includes(FILTERED_STATUS_COMMAND))).toBe(true)
    expect(emittedCommandLogs.some((msg) => msg.includes('merge --no-edit'))).toBe(true)

    const persistedCommandLogs = readPersistedLogEvents(executionLogPath)
      .filter((entry) =>
        entry.phase === 'WAITING_MANUAL_VERIFICATION'
        && entry.status === 'WAITING_MANUAL_VERIFICATION')
      .map((entry) => String(entry.message ?? entry.content ?? ''))
      .filter((msg) => msg.startsWith('[CMD]'))

    expect(persistedCommandLogs.length).toBeGreaterThan(0)
    expect(persistedCommandLogs.some((msg) => msg.includes('push --progress --force-with-lease'))).toBe(true)
    expect(persistedCommandLogs.some((msg) => msg.includes(FILTERED_STATUS_COMMAND))).toBe(true)
    expect(persistedCommandLogs.some((msg) => msg.includes('merge --no-edit'))).toBe(true)

    broadcaster.clearTicket(ticket.id)
  })

  it('blocks verify when the repo has dirty changes outside .looptroop', async () => {
    const { app, repoDir, ticket, executionLogPath } = setupVerifyTicketApp()
    const broadcastSpy = vi.spyOn(broadcaster, 'broadcast')

    writeFileSync(resolve(repoDir, 'UNTRACKED.txt'), 'dirty\n')

    const response = await app.request(`/api/tickets/${ticket.id}/verify`, {
      method: 'POST',
    })

    expect(response.status).toBe(200)
    const payload = await response.json() as { status?: string; message?: string }
    expect(payload).toMatchObject({
      status: 'BLOCKED_ERROR',
      message: 'Verification failed and ticket was blocked',
    })
    expect(getTicketByRef(ticket.id)?.status).toBe('BLOCKED_ERROR')

    const emittedCommandLogs = broadcastSpy.mock.calls
      .filter(([, event, data]) =>
        event === 'log'
        && data.phase === 'WAITING_MANUAL_VERIFICATION'
        && String(data.content ?? '').startsWith('[CMD]'))
      .map(([, , data]) => String(data.content ?? ''))

    expect(emittedCommandLogs.some((msg) => msg.includes(FILTERED_STATUS_COMMAND))).toBe(true)
    expect(emittedCommandLogs.some((msg) => msg.includes('merge --no-edit'))).toBe(false)

    const persistedCommandLogs = readPersistedLogEvents(executionLogPath)
      .filter((entry) =>
        entry.phase === 'WAITING_MANUAL_VERIFICATION'
        && entry.status === 'WAITING_MANUAL_VERIFICATION')
      .map((entry) => String(entry.message ?? entry.content ?? ''))
      .filter((msg) => msg.startsWith('[CMD]'))

    expect(persistedCommandLogs.some((msg) => msg.includes(FILTERED_STATUS_COMMAND))).toBe(true)
    expect(persistedCommandLogs.some((msg) => msg.includes('merge --no-edit'))).toBe(false)

    broadcaster.clearTicket(ticket.id)
  })
})
