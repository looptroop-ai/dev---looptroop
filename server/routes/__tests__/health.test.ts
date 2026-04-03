import Database from 'better-sqlite3'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { createFixtureRepoManager } from '../../test/fixtureRepo'

const repoManager = createFixtureRepoManager({
  templatePrefix: 'looptroop-health-route-',
  files: {
    'README.md': '# LoopTroop Health Route Test\n',
  },
})

interface LoadedHealthApp {
  app: Hono
  sqlite: Database.Database
  initializeDatabase: () => void
  initializeStartupState: () => unknown
  resetStartupStateForTests: () => void
  closeDatabase: () => void
  clearProjectDatabaseCache: () => void
  attachProject: (input: {
    folderPath: string
    name: string
    shortname: string
  }) => unknown
}

const tempRoots = new Set<string>()
let activeApp: LoadedHealthApp | null = null

async function loadHealthApp(configDir: string): Promise<LoadedHealthApp> {
  process.env.LOOPTROOP_CONFIG_DIR = configDir
  delete process.env.LOOPTROOP_APP_DB_PATH
  vi.resetModules()

  const [
    { health },
    { initializeStartupState, resetStartupStateForTests },
    { initializeDatabase },
    { sqlite, closeDatabase },
    { clearProjectDatabaseCache },
    { attachProject },
  ] = await Promise.all([
    import('../health'),
    import('../../startupState'),
    import('../../db/init'),
    import('../../db/index'),
    import('../../db/project'),
    import('../../storage/projects'),
  ])

  const app = new Hono()
  app.route('/api', health)

  return {
    app,
    sqlite,
    initializeDatabase,
    initializeStartupState,
    resetStartupStateForTests,
    closeDatabase,
    clearProjectDatabaseCache,
    attachProject,
  }
}

async function closeLoadedHealthApp(instance: LoadedHealthApp | null) {
  if (!instance) return
  instance.resetStartupStateForTests()
  instance.clearProjectDatabaseCache()
  instance.closeDatabase()
}

describe('health startup routes', () => {
  afterEach(async () => {
    await closeLoadedHealthApp(activeApp)
    activeApp = null
    delete process.env.LOOPTROOP_CONFIG_DIR
    delete process.env.LOOPTROOP_APP_DB_PATH
    vi.resetModules()

    for (const root of tempRoots) {
      rmSync(root, { recursive: true, force: true })
    }
    tempRoots.clear()
  })

  afterAll(() => {
    repoManager.cleanup()
  })

  it('reports fresh startup state when the app db did not exist before boot', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'looptroop-health-fresh-'))
    tempRoots.add(tempRoot)
    const configDir = join(tempRoot, 'config')

    activeApp = await loadHealthApp(configDir)
    activeApp.initializeDatabase()
    activeApp.initializeStartupState()

    const response = await activeApp.app.request('/api/health/startup')
    expect(response.status).toBe(200)

    const payload = await response.json() as {
      storage: {
        kind: string
        source: string
        profileRestored: boolean
        restoredProjectCount: number
        restoredProjects: Array<{ name: string; shortname: string; folderPath: string }>
      }
      ui: { restoreNotice: { shouldShow: boolean; dismissedAt: string | null } }
    }

    expect(payload.storage.kind).toBe('fresh')
    expect(payload.storage.source).toBe('LOOPTROOP_CONFIG_DIR')
    expect(payload.storage.profileRestored).toBe(false)
    expect(payload.storage.restoredProjectCount).toBe(0)
    expect(payload.storage.restoredProjects).toEqual([])
    expect(payload.ui.restoreNotice).toEqual({
      shouldShow: false,
      dismissedAt: null,
    })
  })

  it('reports empty_existing when the app db existed before boot with no saved state', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'looptroop-health-empty-'))
    tempRoots.add(tempRoot)
    const configDir = join(tempRoot, 'config')
    mkdirSync(configDir, { recursive: true })
    new Database(join(configDir, 'app.sqlite')).close()

    activeApp = await loadHealthApp(configDir)
    activeApp.initializeDatabase()
    activeApp.initializeStartupState()

    const response = await activeApp.app.request('/api/health/startup')
    expect(response.status).toBe(200)

    const payload = await response.json() as {
      storage: {
        kind: string
        profileRestored: boolean
        restoredProjectCount: number
        restoredProjects: Array<{ name: string; shortname: string; folderPath: string }>
      }
      ui: { restoreNotice: { shouldShow: boolean } }
    }

    expect(payload.storage.kind).toBe('empty_existing')
    expect(payload.storage.profileRestored).toBe(false)
    expect(payload.storage.restoredProjectCount).toBe(0)
    expect(payload.storage.restoredProjects).toEqual([])
    expect(payload.ui.restoreNotice.shouldShow).toBe(false)
  })

  it('reports restored startup state, keeps the boot snapshot stable, and persists notice dismissal', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'looptroop-health-restored-'))
    tempRoots.add(tempRoot)
    const configDir = join(tempRoot, 'config')
    const repoDir = repoManager.createRepo()

    const seedApp = await loadHealthApp(configDir)
    seedApp.initializeDatabase()
    seedApp.attachProject({
      folderPath: repoDir,
      name: 'Restored Project',
      shortname: 'RST',
    })
    seedApp.sqlite.exec(`
      INSERT INTO profiles (main_implementer, council_members)
      VALUES ('openai/gpt-5.4', '[]');
    `)
    await closeLoadedHealthApp(seedApp)

    activeApp = await loadHealthApp(configDir)
    activeApp.initializeDatabase()
    activeApp.initializeStartupState()

    const initialResponse = await activeApp.app.request('/api/health/startup')
    expect(initialResponse.status).toBe(200)
    const initialPayload = await initialResponse.json() as {
      storage: {
        kind: string
        profileRestored: boolean
        restoredProjectCount: number
        restoredProjects: Array<{ name: string; shortname: string; folderPath: string }>
      }
      ui: { restoreNotice: { shouldShow: boolean; dismissedAt: string | null } }
    }

    expect(initialPayload.storage.kind).toBe('restored')
    expect(initialPayload.storage.profileRestored).toBe(true)
    expect(initialPayload.storage.restoredProjectCount).toBe(1)
    expect(initialPayload.storage.restoredProjects).toEqual([
      {
        name: 'Restored Project',
        shortname: 'RST',
        folderPath: repoDir,
      },
    ])
    expect(initialPayload.ui.restoreNotice.shouldShow).toBe(true)
    expect(initialPayload.ui.restoreNotice.dismissedAt).toBeNull()

    activeApp.sqlite.exec('DELETE FROM attached_projects; DELETE FROM profiles;')

    const snapshotAfterMutation = await activeApp.app.request('/api/health/startup')
    const mutatedPayload = await snapshotAfterMutation.json() as {
      storage: {
        kind: string
        profileRestored: boolean
        restoredProjectCount: number
      }
    }

    expect(mutatedPayload.storage.kind).toBe('restored')
    expect(mutatedPayload.storage.profileRestored).toBe(true)
    expect(mutatedPayload.storage.restoredProjectCount).toBe(1)

    const dismissResponse = await activeApp.app.request('/api/health/startup/restore-notice/dismiss', {
      method: 'POST',
    })
    expect(dismissResponse.status).toBe(200)
    const dismissPayload = await dismissResponse.json() as {
      success: boolean
      dismissedAt: string | null
    }

    expect(dismissPayload.success).toBe(true)
    expect(dismissPayload.dismissedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    const afterDismissResponse = await activeApp.app.request('/api/health/startup')
    const afterDismissPayload = await afterDismissResponse.json() as {
      ui: { restoreNotice: { shouldShow: boolean; dismissedAt: string | null } }
    }

    expect(afterDismissPayload.ui.restoreNotice.shouldShow).toBe(false)
    expect(afterDismissPayload.ui.restoreNotice.dismissedAt).toBe(dismissPayload.dismissedAt)
  })
})
