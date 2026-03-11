import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { db as appDb } from '../../db/index'
import { initializeDatabase } from '../../db/init'
import { clearProjectDatabaseCache } from '../../db/project'
import { attachedProjects, profiles } from '../../db/schema'
import { appendLogEvent } from '../../log/executionLog'
import { stopAllActors } from '../../machines/persistence'
import { resetOpenCodeAdapter } from '../../opencode/factory'
import { cleanupTicketResources } from '../../phases/cleanup/cleaner'
import { attachProject } from '../../storage/projects'
import { createTicket } from '../../storage/tickets'
import { getTicketExecutionLogPath, getTicketRuntimeDir, getTicketWorktreePath } from '../../storage/paths'
import { initializeTicket } from '../initialize'
import { createFixtureRepoManager } from '../../test/fixtureRepo'
import { getTicketBeadsPath } from '../metadata'

const repoFixture = createFixtureRepoManager({
  templatePrefix: 'looptroop-ticket-lifecycle-template-',
  files: {
    'package.json': JSON.stringify({ name: 'fixture', private: true }, null, 2),
  },
})

let projectRepoPath = ''
let projectId = 0

beforeAll(() => {
  initializeDatabase()
})

afterAll(() => {
  repoFixture.cleanup()
})

beforeEach(() => {
  stopAllActors()
  resetOpenCodeAdapter()
  clearProjectDatabaseCache()
  appDb.delete(attachedProjects).run()
  appDb.delete(profiles).run()

  projectRepoPath = repoFixture.createRepo('looptroop-ticket-lifecycle-')
  const project = attachProject({
    folderPath: projectRepoPath,
    name: 'Test Project',
    shortname: 'TEST',
  })
  projectId = project.id
})

afterEach(() => {
  stopAllActors()
  resetOpenCodeAdapter()
  clearProjectDatabaseCache()
  appDb.delete(attachedProjects).run()
  appDb.delete(profiles).run()
})

describe('Ticket Lifecycle', () => {
  it('creates ticket metadata only inside the project-local .looptroop tree', () => {
    const ticket = createTicket({ projectId, title: 'Test Ticket' })
    const worktreePath = getTicketWorktreePath(projectRepoPath, ticket.externalId)
    const metaPath = resolve(worktreePath, '.ticket', 'meta', 'ticket.meta.json')

    expect(ticket.externalId).toBe('TEST-1')
    expect(ticket.id).toBe(`${projectId}:TEST-1`)
    expect(existsSync(metaPath)).toBe(true)
    expect(existsSync(resolve(worktreePath, '.ticket', 'runtime'))).toBe(false)
    expect(existsSync(resolve(worktreePath, '.ticket', 'codebase-map.yaml'))).toBe(false)

    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
    expect(meta).toMatchObject({
      externalId: 'TEST-1',
      title: 'Test Ticket',
    })
    expect(meta.projectId).toBeUndefined()
    expect(meta.id).toBeUndefined()
  })

  it('initializes the git worktree and runtime layout under the project-local storage root', () => {
    const ticket = createTicket({ projectId, title: 'Initialize me' })
    const result = initializeTicket({
      externalId: ticket.externalId,
      projectFolder: projectRepoPath,
    })

    expect(result.reused).toBe(false)
    expect(result.branchName).toBe(ticket.externalId)
    expect(result.baseBranch.length).toBeGreaterThan(0)
    expect(result.worktreePath).toBe(getTicketWorktreePath(projectRepoPath, ticket.externalId))

    const ticketDir = resolve(result.worktreePath, '.ticket')
    const runtimeDir = getTicketRuntimeDir(projectRepoPath, ticket.externalId)
    expect(existsSync(runtimeDir)).toBe(true)
    expect(existsSync(resolve(runtimeDir, 'streams'))).toBe(true)
    expect(existsSync(resolve(runtimeDir, 'sessions'))).toBe(true)
    expect(existsSync(resolve(runtimeDir, 'locks'))).toBe(true)
    expect(existsSync(resolve(runtimeDir, 'tmp'))).toBe(true)
    expect(existsSync(resolve(ticketDir, '.gitignore'))).toBe(true)
    expect(readFileSync(resolve(ticketDir, '.gitignore'), 'utf-8')).toContain('runtime/**')
    expect(existsSync(resolve(ticketDir, 'codebase-map.yaml'))).toBe(true)
  })

  it('writes execution logs in runtime and preserves them while cleaning transient runtime state', () => {
    const ticket = createTicket({ projectId, title: 'Runtime cleanup' })
    initializeTicket({
      externalId: ticket.externalId,
      projectFolder: projectRepoPath,
    })

    const runtimeDir = getTicketRuntimeDir(projectRepoPath, ticket.externalId)
    const executionLogPath = getTicketExecutionLogPath(projectRepoPath, ticket.externalId)
    const ticketDir = resolve(getTicketWorktreePath(projectRepoPath, ticket.externalId), '.ticket')

    writeFileSync(resolve(ticketDir, 'interview.yaml'), 'questions: []\n')
    writeFileSync(resolve(ticketDir, 'prd.yaml'), 'epics: []\n')
    const beadsPath = getTicketBeadsPath(projectRepoPath, ticket.externalId)
    writeFileSync(beadsPath, '{"id":"b1"}\n')
    writeFileSync(resolve(runtimeDir, 'sessions', 'active.json'), '{"state":"active"}\n')
    writeFileSync(resolve(runtimeDir, 'streams', 'events.log'), 'stream\n')
    writeFileSync(resolve(runtimeDir, 'locks', 'ticket.lock'), 'lock\n')
    writeFileSync(resolve(runtimeDir, 'tmp', 'scratch.txt'), 'tmp\n')

    appendLogEvent(ticket.id, 'info', 'CODING', 'Mock execution log entry')
    expect(existsSync(executionLogPath)).toBe(true)
    expect(existsSync(resolve(ticketDir, 'execution-log.jsonl'))).toBe(false)

    const report = cleanupTicketResources(ticket.id)

    expect(report.errors).toEqual([])
    expect(report.preservedPaths).toContain(executionLogPath)
    expect(report.preservedPaths).toContain(resolve(ticketDir, 'interview.yaml'))
    expect(report.preservedPaths).toContain(resolve(ticketDir, 'prd.yaml'))
    expect(report.preservedPaths).toContain(beadsPath)
    expect(existsSync(executionLogPath)).toBe(true)
    expect(existsSync(resolve(runtimeDir, 'sessions'))).toBe(false)
    expect(existsSync(resolve(runtimeDir, 'streams'))).toBe(false)
    expect(existsSync(resolve(runtimeDir, 'locks'))).toBe(false)
    expect(existsSync(resolve(runtimeDir, 'tmp'))).toBe(false)
  })
})
