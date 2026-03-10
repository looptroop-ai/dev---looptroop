import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { APP_CONFIG_DIR, APP_DB_PATH, db as appDb, sqlite } from '../index'
import { initializeDatabase } from '../init'
import { clearProjectDatabaseCache, getProjectDatabase } from '../project'
import { attachedProjects, profiles, projects, tickets } from '../schema'
import { attachProject } from '../../storage/projects'
import { createTicket } from '../../storage/tickets'
import { stopAllActors } from '../../machines/persistence'
import { resetOpenCodeAdapter } from '../../opencode/factory'
import { createFixtureRepoManager } from '../../test/fixtureRepo'

const repoFixture = createFixtureRepoManager({
  templatePrefix: 'looptroop-db-template-',
  files: {
    'README.md': '# Fixture\n',
  },
})

function listTableNames(database: { prepare: (sql: string) => { all: () => { name: string }[] } }) {
  return database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map(row => row.name)
}

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
})

afterEach(() => {
  stopAllActors()
  resetOpenCodeAdapter()
  clearProjectDatabaseCache()
  appDb.delete(attachedProjects).run()
  appDb.delete(profiles).run()
})

describe('Database layout', () => {
  it('initializes the app database with only global tables', () => {
    expect(path.isAbsolute(APP_CONFIG_DIR)).toBe(true)
    expect(APP_CONFIG_DIR).toContain(path.join('looptroop-vitest'))
    expect(APP_DB_PATH).toBe(path.join(APP_CONFIG_DIR, 'app.sqlite'))
    expect(fs.existsSync(APP_CONFIG_DIR)).toBe(true)
    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(sqlite.pragma('busy_timeout', { simple: true })).toBe(5000)
    expect(listTableNames(sqlite)).toEqual(['attached_projects', 'profiles'])
  })

  it('creates project-local databases with project and ticket state tables', () => {
    const repoDir = repoFixture.createRepo('looptroop-db-local-')
    const project = attachProject({
      folderPath: repoDir,
      name: 'Database Fixture',
      shortname: 'DBX',
    })

    const projectDatabase = getProjectDatabase(repoDir)
    expect(listTableNames(projectDatabase.sqlite)).toEqual([
      'opencode_sessions',
      'phase_artifacts',
      'projects',
      'ticket_status_history',
      'tickets',
    ])

    const localProject = projectDatabase.db.select().from(projects).limit(1).get()
    expect(localProject?.folderPath).toBe(repoDir)
    expect(appDb.select().from(attachedProjects).all()).toHaveLength(1)
    expect(project.id).toBeGreaterThan(0)
  })

  it('stores tickets in the project-local database and not the app database', () => {
    const repoDir = repoFixture.createRepo('looptroop-db-ticket-')
    const project = attachProject({
      folderPath: repoDir,
      name: 'Ticket Fixture',
      shortname: 'TKT',
    })

    const created = createTicket({
      projectId: project.id,
      title: 'Move storage local',
    })

    const projectDatabase = getProjectDatabase(repoDir)
    const localTickets = projectDatabase.db.select().from(tickets).all()
    expect(localTickets).toHaveLength(1)
    expect(localTickets[0]?.externalId).toBe('TKT-1')
    expect(created.id).toBe(`${project.id}:TKT-1`)

    expect(() => appDb.select().from(tickets).all()).toThrow()
  })
})
