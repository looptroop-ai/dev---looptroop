import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { Hono } from 'hono'
import { initializeDatabase } from '../../db/init'
import { sqlite } from '../../db/index'
import { clearProjectDatabaseCache } from '../../db/project'
import { attachProject } from '../../storage/projects'
import { createTicket, getTicketPaths } from '../../storage/tickets'
import { createFixtureRepoManager } from '../../test/fixtureRepo'
import { recoverTicketRuntimeArtifacts } from '../../startup'
import { cleanupTicketResources } from '../../phases/cleanup/cleaner'
import { filesRouter } from '../files'

const repoManager = createFixtureRepoManager({
  templatePrefix: 'looptroop-files-route-',
  files: {
    'README.md': '# LoopTroop Files Route Test\n',
  },
})

function writeJsonl(filePath: string, entries: Record<string, unknown>[]) {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`)
}

function createProjectTicket() {
  const repoDir = repoManager.createRepo()
  const project = attachProject({
    folderPath: repoDir,
    name: 'Files Route',
    shortname: 'FILE',
  })
  const ticket = createTicket({
    projectId: project.id,
    title: 'Read logs',
    description: 'Regression coverage for log file channel reads.',
  })
  const paths = getTicketPaths(ticket.id)
  if (!paths) throw new Error('Expected ticket paths')
  return { repoDir, project, ticket, paths }
}

beforeEach(() => {
  clearProjectDatabaseCache()
  initializeDatabase()
  sqlite.exec('DELETE FROM attached_projects; DELETE FROM profiles;')
})

afterAll(() => {
  clearProjectDatabaseCache()
  repoManager.cleanup()
})

describe('filesRouter GET /files/:ticketId/logs', () => {
  const app = new Hono()
  app.route('/api', filesRouter)

  it('reads the normal log by default and the debug log with channel=debug while preserving filters', async () => {
    const { ticket, paths } = createProjectTicket()

    writeJsonl(paths.executionLogPath, [
      {
        timestamp: '2026-03-13T12:00:00.000Z',
        type: 'info',
        ticketId: ticket.id,
        phase: 'CODING',
        phaseAttempt: 1,
        status: 'CODING',
        message: 'normal coding entry',
        content: 'normal coding entry',
      },
    ])
    writeJsonl(paths.debugLogPath, [
      {
        timestamp: '2026-03-13T12:00:01.000Z',
        type: 'debug',
        ticketId: ticket.id,
        phase: 'CODING',
        phaseAttempt: 1,
        status: 'CODING',
        message: 'debug attempt one',
        content: 'debug attempt one',
        source: 'debug',
      },
      {
        timestamp: '2026-03-13T12:00:02.000Z',
        type: 'debug',
        ticketId: ticket.id,
        phase: 'CODING',
        phaseAttempt: 2,
        status: 'CODING',
        message: 'debug attempt two',
        content: 'debug attempt two',
        source: 'debug',
      },
    ])

    const encodedTicketId = encodeURIComponent(ticket.id)
    const normalResponse = await app.request(`/api/files/${encodedTicketId}/logs?status=CODING&phase=CODING&phaseAttempt=1`)
    expect(normalResponse.status).toBe(200)
    const normalPayload = await normalResponse.json() as Array<Record<string, unknown>>
    expect(normalPayload.map((entry) => entry.content)).toEqual(['normal coding entry'])

    const debugResponse = await app.request(`/api/files/${encodedTicketId}/logs?channel=debug&status=CODING&phase=CODING&phaseAttempt=2`)
    expect(debugResponse.status).toBe(200)
    const debugPayload = await debugResponse.json() as Array<Record<string, unknown>>
    expect(debugPayload.map((entry) => entry.content)).toEqual(['debug attempt two'])
    expect(debugPayload.every((entry) => entry.source === 'debug')).toBe(true)
  })
})

describe('recoverTicketRuntimeArtifacts', () => {
  it('repairs trailing corruption in normal and debug execution logs', () => {
    const { paths } = createProjectTicket()
    const normalEntry = JSON.stringify({ timestamp: '2026-03-13T12:00:00.000Z', message: 'normal' })
    const debugEntry = JSON.stringify({ timestamp: '2026-03-13T12:00:01.000Z', message: 'debug' })

    mkdirSync(dirname(paths.executionLogPath), { recursive: true })
    writeFileSync(paths.executionLogPath, `${normalEntry}\n{"broken":`)
    writeFileSync(paths.debugLogPath, `${debugEntry}\n{"broken":`)

    const recovery = recoverTicketRuntimeArtifacts()

    expect(recovery.repairedExecutionLogs).toBe(2)
    expect(readFileSync(paths.executionLogPath, 'utf8')).toBe(`${normalEntry}\n`)
    expect(readFileSync(paths.debugLogPath, 'utf8')).toBe(`${debugEntry}\n`)
    expect(existsSync(paths.executionLogPath)).toBe(true)
    expect(existsSync(paths.debugLogPath)).toBe(true)
  })
})

describe('cleanupTicketResources', () => {
  it('preserves normal and debug execution logs as audit artifacts', () => {
    const { ticket, paths } = createProjectTicket()
    writeJsonl(paths.executionLogPath, [{ timestamp: '2026-03-13T12:00:00.000Z', message: 'normal' }])
    writeJsonl(paths.debugLogPath, [{ timestamp: '2026-03-13T12:00:01.000Z', message: 'debug' }])

    const report = cleanupTicketResources(ticket.id)

    expect(report.errors).toEqual([])
    expect(report.preservedPaths).toContain(paths.executionLogPath)
    expect(report.preservedPaths).toContain(paths.debugLogPath)
    expect(existsSync(paths.executionLogPath)).toBe(true)
    expect(existsSync(paths.debugLogPath)).toBe(true)
  })
})
