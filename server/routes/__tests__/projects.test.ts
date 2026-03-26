import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { Hono } from 'hono'
import { initializeDatabase } from '../../db/init'
import { sqlite } from '../../db/index'
import { clearProjectDatabaseCache } from '../../db/project'
import { getProjectLoopTroopDir } from '../../storage/paths'
import { attachProject, listProjects, resolveProjectState } from '../../storage/projects'
import { createFixtureRepoManager } from '../../test/fixtureRepo'
import { projectRouter } from '../projects'

const repoManager = createFixtureRepoManager({
  templatePrefix: 'looptroop-project-route-',
  files: {
    'README.md': '# LoopTroop Project Route Test\n',
  },
})

describe('projectRouter project cleanup', () => {
  beforeEach(() => {
    clearProjectDatabaseCache()
    initializeDatabase()
    sqlite.exec('DELETE FROM attached_projects; DELETE FROM profiles;')
  })

  afterAll(() => {
    clearProjectDatabaseCache()
    repoManager.cleanup()
  })

  it('deletes project-local LoopTroop state and allows a clean re-attach', async () => {
    const repoDir = repoManager.createRepo()
    const app = new Hono()
    app.route('/api', projectRouter)

    const createResponse = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Original Project',
        shortname: 'TST',
        folderPath: repoDir,
      }),
    })

    expect(createResponse.status).toBe(201)
    const created = await createResponse.json() as { id: number }
    const projectStateDir = getProjectLoopTroopDir(repoDir)

    expect(existsSync(projectStateDir)).toBe(true)
    expect(resolveProjectState(repoDir).exists).toBe(true)

    const deleteResponse = await app.request(`/api/projects/${created.id}`, {
      method: 'DELETE',
    })

    expect(deleteResponse.status).toBe(200)
    expect(existsSync(projectStateDir)).toBe(false)

    const checkResponse = await app.request(`/api/projects/check-git?path=${encodeURIComponent(repoDir)}`)
    expect(checkResponse.status).toBe(200)
    const checkPayload = await checkResponse.json() as {
      hasLoopTroopState?: boolean
      existingProject?: unknown
    }
    expect(checkPayload.hasLoopTroopState).toBe(false)
    expect(checkPayload.existingProject).toBeNull()

    const recreateResponse = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Fresh Project',
        shortname: 'NEW',
        folderPath: repoDir,
      }),
    })

    expect(recreateResponse.status).toBe(201)
    const recreated = await recreateResponse.json() as {
      name: string
      shortname: string
    }
    expect(recreated.name).toBe('Fresh Project')
    expect(recreated.shortname).toBe('NEW')
  })

  it('drops stale cached state after .looptroop is removed outside the app', () => {
    const repoDir = repoManager.createRepo()
    attachProject({
      folderPath: repoDir,
      name: 'Original Project',
      shortname: 'OLD',
    })

    expect(resolveProjectState(repoDir).exists).toBe(true)

    rmSync(getProjectLoopTroopDir(repoDir), { recursive: true, force: true })

    const stateAfterDelete = resolveProjectState(repoDir)
    expect(stateAfterDelete.exists).toBe(false)
    expect(stateAfterDelete.existingProject).toBeNull()
    expect(listProjects()).toEqual([])
    expect(existsSync(getProjectLoopTroopDir(repoDir))).toBe(false)

    const reattached = attachProject({
      folderPath: repoDir,
      name: 'Fresh Project',
      shortname: 'NEW',
    })

    expect(reattached.name).toBe('Fresh Project')
    expect(reattached.shortname).toBe('NEW')
  })
})
