import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { db as appDb } from '../../db/index'
import { initializeDatabase } from '../../db/init'
import { clearProjectDatabaseCache } from '../../db/project'
import { attachedProjects, opencodeSessions, phaseArtifacts, profiles, ticketStatusHistory, tickets } from '../../db/schema'
import { appendLogEvent } from '../../log/executionLog'
import { stopAllActors } from '../../machines/persistence'
import { resetOpenCodeAdapter } from '../../opencode/factory'
import { getProjectContextById } from '../../storage/projects'
import { getTicketByRef, getTicketPaths, patchTicket } from '../../storage/tickets'
import { getProjectDbPath, getProjectLoopTroopDir, getTicketExecutionLogPath, getTicketRuntimeDir, getTicketWorktreePath } from '../../storage/paths'
import { initializeTicket } from '../../ticket/initialize'
import { validateJson } from '../../middleware/validation'
import { broadcaster } from '../../sse/broadcaster'
import { cancelTicket } from '../../workflow/runner'
import { beadsRouter } from '../beads'
import { filesRouter } from '../files'
import { health } from '../health'
import { modelsRouter } from '../models'
import { profileRouter } from '../profiles'
import { projectRouter } from '../projects'
import { ticketRouter } from '../tickets'
import { createFixtureRepoManager } from '../../test/fixtureRepo'
import * as modelValidation from '../../opencode/modelValidation'

const app = new Hono()
app.use('/api/*', validateJson)
app.route('/api', health)
app.route('/api', profileRouter)
app.route('/api', projectRouter)
app.route('/api', ticketRouter)
app.route('/api', modelsRouter)
app.route('/api', filesRouter)
app.route('/api', beadsRouter)

const repoFixture = createFixtureRepoManager({
  templatePrefix: 'looptroop-routes-template-',
  files: {
    'package.json': JSON.stringify({ name: 'fixture', private: true }, null, 2),
    'src/index.ts': 'export const ready = true\n',
  },
})
const createdTicketIds = new Set<string>()

function createGitRepo(prefix: string): string {
  return repoFixture.createRepo(prefix)
}

async function parseJson<T>(response: Response): Promise<T> {
  return await response.json() as T
}

function trackTicket(ticketId: string) {
  createdTicketIds.add(ticketId)
  return ticketId
}

async function createValidProfile() {
  return await app.request('/api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'testuser',
      mainImplementer: 'openai/codex-mini-latest',
      councilMembers: JSON.stringify([
        'openai/codex-mini-latest',
        'openai/gpt-5.3-codex',
      ]),
    }),
  })
}

async function waitForTicketStatus(ticketId: string, expectedStatus: string, timeoutMs: number = 4000) {
  const currentStatus = getTicketByRef(ticketId)?.status
  if (currentStatus === expectedStatus) {
    return { status: currentStatus }
  }

  return await new Promise<{ status: string }>((resolve, reject) => {
    const clientId = `test-wait-${ticketId}-${Date.now()}`
    const cleanup = () => {
      clearTimeout(timer)
      broadcaster.removeClient(ticketId, clientId)
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for ${ticketId} to reach ${expectedStatus}; last status was ${getTicketByRef(ticketId)?.status ?? 'missing'}`))
    }, timeoutMs)

    broadcaster.addClient(ticketId, {
      id: clientId,
      ticketId,
      send: (event, data) => {
        if (event !== 'state_change') return
        const payload = JSON.parse(data) as { to?: string }
        if (payload.to === expectedStatus) {
          cleanup()
          resolve({ status: expectedStatus })
        }
      },
      close: cleanup,
    })

    const latestStatus = getTicketByRef(ticketId)?.status
    if (latestStatus === expectedStatus) {
      cleanup()
      resolve({ status: latestStatus })
    }
  })
}

async function requestAndWaitForTicketStatus(
  ticketId: string,
  expectedStatus: string,
  request: () => Response | Promise<Response>,
  timeoutMs?: number,
) {
  const pendingStatus = waitForTicketStatus(ticketId, expectedStatus, timeoutMs)
  try {
    const response = await request()
    await pendingStatus
    return response
  } catch (error) {
    await pendingStatus.catch(() => undefined)
    throw error
  }
}

beforeAll(() => {
  initializeDatabase()
})

afterAll(() => {
  repoFixture.cleanup()
})

beforeEach(() => {
  createdTicketIds.clear()
  stopAllActors()
  resetOpenCodeAdapter()
  clearProjectDatabaseCache()
  appDb.delete(attachedProjects).run()
  appDb.delete(profiles).run()
})

afterEach(() => {
  for (const ticketId of createdTicketIds) {
    cancelTicket(ticketId)
    broadcaster.clearTicket(ticketId)
  }
  vi.restoreAllMocks()
  stopAllActors()
  createdTicketIds.clear()
  resetOpenCodeAdapter()
  clearProjectDatabaseCache()
  appDb.delete(attachedProjects).run()
  appDb.delete(profiles).run()
})

describe('Routes', () => {
  it('serves health and profile endpoints from the global app database', async () => {
    const healthResponse = await app.request('/api/health')
    expect(healthResponse.status).toBe(200)
    expect(await parseJson<{ status: string }>(healthResponse)).toMatchObject({ status: 'ok' })

    const initialProfile = await app.request('/api/profile')
    expect(initialProfile.status).toBe(200)
    expect(await parseJson<null>(initialProfile)).toBeNull()

    const createProfile = await createValidProfile()
    expect(createProfile.status).toBe(201)
    expect(await parseJson<{ username: string }>(createProfile)).toMatchObject({ username: 'testuser' })
  })

  it('updates non-model profile fields without revalidating unchanged model selections', async () => {
    const createProfile = await createValidProfile()
    expect(createProfile.status).toBe(201)
    const created = await parseJson<{
      username: string
      mainImplementer: string
      councilMembers: string
      minCouncilQuorum: number
    }>(createProfile)

    const validateSpy = vi.spyOn(modelValidation, 'validateModelSelection')
      .mockRejectedValue(new Error('OpenCode unavailable'))

    const updateResponse = await app.request('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'updated-user',
        mainImplementer: created.mainImplementer,
        councilMembers: created.councilMembers,
        minCouncilQuorum: created.minCouncilQuorum,
      }),
    })

    expect(updateResponse.status).toBe(200)
    expect(await parseJson<{ username: string }>(updateResponse)).toMatchObject({ username: 'updated-user' })
    expect(validateSpy).not.toHaveBeenCalled()
  })

  it('attaches project state under the repo-local .looptroop directory and restores existing state on reattach', async () => {
    const repoDir = createGitRepo('looptroop-project-route-')
    const nestedDir = path.join(repoDir, 'src')

    const beforeAttach = await app.request(`/api/projects/check-git?path=${encodeURIComponent(repoDir)}`)
    expect(beforeAttach.status).toBe(200)
    expect(await parseJson<{ isGit: boolean; hasLoopTroopState: boolean; scope: string }>(beforeAttach)).toMatchObject({
      isGit: true,
      hasLoopTroopState: false,
      scope: 'root',
    })

    const nestedCheck = await app.request(`/api/projects/check-git?path=${encodeURIComponent(nestedDir)}`)
    expect(nestedCheck.status).toBe(200)
    expect(await parseJson<{ scope: string; repoRoot: string }>(nestedCheck)).toMatchObject({
      scope: 'subfolder',
      repoRoot: repoDir,
    })

    const createProject = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Route Project',
        shortname: 'RTE',
        icon: '📁',
        color: '#3b82f6',
        folderPath: repoDir,
      }),
    })
    expect(createProject.status).toBe(201)
    const project = await parseJson<{ id: number; name: string; shortname: string; folderPath: string; icon: string; color: string }>(createProject)
    expect(project.folderPath).toBe(repoDir)
    expect(fs.existsSync(getProjectDbPath(repoDir))).toBe(true)
    expect(fs.existsSync(getProjectLoopTroopDir(repoDir))).toBe(true)

    const createTicket = await app.request('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, title: 'Persist me on disk' }),
    })
    expect(createTicket.status).toBe(201)
    const ticket = await parseJson<{ externalId: string }>(createTicket)
    expect(ticket.externalId).toBe('RTE-1')

    const detach = await app.request(`/api/projects/${project.id}`, { method: 'DELETE' })
    expect(detach.status).toBe(200)
    expect(fs.existsSync(getProjectDbPath(repoDir))).toBe(true)

    const afterDetach = await app.request('/api/projects')
    expect(await parseJson<unknown[]>(afterDetach)).toEqual([])

    const existingState = await app.request(`/api/projects/check-git?path=${encodeURIComponent(repoDir)}`)
    expect(existingState.status).toBe(200)
    expect(await parseJson<{
      hasLoopTroopState: boolean
      existingProject: {
        name: string
        shortname: string
        icon: string | null
        color: string | null
        ticketCounter: number
        ticketCount: number
      } | null
    }>(existingState)).toMatchObject({
      hasLoopTroopState: true,
      existingProject: {
        name: 'Route Project',
        shortname: 'RTE',
        icon: '📁',
        color: '#3b82f6',
        ticketCounter: 1,
        ticketCount: 1,
      },
    })

    const reattach = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Merged on restore',
        shortname: 'NEW',
        icon: '🔥',
        color: '#166534',
        folderPath: repoDir,
      }),
    })
    expect(reattach.status).toBe(201)
    const restoredProject = await parseJson<{ id: number; name: string; shortname: string; icon: string; color: string }>(reattach)
    expect(restoredProject.name).toBe('Merged on restore')
    expect(restoredProject.shortname).toBe('RTE')
    expect(restoredProject.icon).toBe('🔥')
    expect(restoredProject.color).toBe('#166534')
    expect(restoredProject.id).not.toBe(project.id)

    const afterReattach = await app.request(`/api/projects/check-git?path=${encodeURIComponent(repoDir)}`)
    expect(await parseJson<{
      hasLoopTroopState: boolean
      existingProject: {
        name: string
        shortname: string
        icon: string | null
        color: string | null
        ticketCounter: number
        ticketCount: number
      } | null
    }>(afterReattach)).toMatchObject({
      hasLoopTroopState: true,
      existingProject: {
        name: 'Merged on restore',
        shortname: 'RTE',
        icon: '🔥',
        color: '#166534',
        ticketCounter: 1,
        ticketCount: 1,
      },
    })

    const restoredTickets = await app.request(`/api/tickets?projectId=${restoredProject.id}`)
    expect(restoredTickets.status).toBe(200)
    expect(await parseJson<Array<{ externalId: string }>>(restoredTickets)).toEqual([
      expect.objectContaining({ externalId: 'RTE-1' }),
    ])

    const restoredContext = getProjectContextById(restoredProject.id)
    expect(restoredContext?.project).toMatchObject({
      name: 'Merged on restore',
      shortname: 'RTE',
      icon: '🔥',
      color: '#166534',
      folderPath: repoDir,
    })

    const secondTicketResponse = await app.request('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: restoredProject.id, title: 'Still uses original shortname' }),
    })
    expect(secondTicketResponse.status).toBe(201)
    expect(await parseJson<{ externalId: string }>(secondTicketResponse)).toMatchObject({
      externalId: 'RTE-2',
    })
  })

  it('runs the mock planning lifecycle through the real route flow and stops before execution', async () => {
    const repoDir = createGitRepo('looptroop-ticket-route-')
    const profileResponse = await createValidProfile()
    expect(profileResponse.status).toBe(201)

    const createProject = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Lifecycle Project',
        shortname: 'LFC',
        folderPath: repoDir,
      }),
    })
    const project = await parseJson<{ id: number }>(createProject)

    const createTicket = await app.request('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        title: 'Mock planning lifecycle',
        description: 'Ensure mock mode stops before execution phases',
      }),
    })
    expect(createTicket.status).toBe(201)
    const ticket = await parseJson<{ id: string; externalId: string }>(createTicket)
    trackTicket(ticket.id)
    expect(ticket.id).toBe(`${project.id}:LFC-1`)

    const worktreePath = getTicketWorktreePath(repoDir, ticket.externalId)
    const metaPath = path.join(worktreePath, '.ticket', 'meta', 'ticket.meta.json')
    expect(fs.existsSync(metaPath)).toBe(true)
    expect(fs.existsSync(path.join(worktreePath, '.ticket', 'codebase-map.yaml'))).toBe(false)

    const start = await requestAndWaitForTicketStatus(
      ticket.id,
      'WAITING_INTERVIEW_ANSWERS',
      () => app.request(`/api/tickets/${encodeURIComponent(ticket.id)}/start`, { method: 'POST' }),
    )
    expect(start.status).toBe(200)
    const startedTicket = await app.request(`/api/tickets/${encodeURIComponent(ticket.id)}`)
    expect(startedTicket.status).toBe(200)
    expect(await parseJson<{ lockedMainImplementer: string | null; lockedCouncilMembers: string[] }>(startedTicket)).toMatchObject({
      lockedMainImplementer: 'openai/codex-mini-latest',
      lockedCouncilMembers: ['openai/codex-mini-latest', 'openai/gpt-5.3-codex'],
    })

    const runtimeDir = getTicketRuntimeDir(repoDir, ticket.externalId)
    expect(fs.existsSync(path.join(worktreePath, '.ticket', 'codebase-map.yaml'))).toBe(true)
    expect(fs.existsSync(runtimeDir)).toBe(true)
    expect(fs.existsSync(path.join(runtimeDir, 'sessions'))).toBe(true)

    const interviewBatch = await app.request(`/api/tickets/${encodeURIComponent(ticket.id)}/interview-batch`)
    expect(interviewBatch.status).toBe(200)
    const batchPayload = await parseJson<{ status: string; batch: { questions: Array<{ id: string }> } }>(interviewBatch)
    expect(batchPayload.status).toBe('ok')
    expect(batchPayload.batch.questions.length).toBeGreaterThan(0)

    const batchAnswers = Object.fromEntries(
      batchPayload.batch.questions.map((question, index) => [question.id, `answer-${index + 1}`]),
    )
    const answerBatch = await requestAndWaitForTicketStatus(
      ticket.id,
      'WAITING_INTERVIEW_APPROVAL',
      () => app.request(`/api/tickets/${encodeURIComponent(ticket.id)}/answer-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: batchAnswers }),
      }),
    )
    expect(answerBatch.status).toBe(200)
    expect(await parseJson<{ isComplete: boolean }>(answerBatch)).toMatchObject({ isComplete: true })

    const interviewFile = await app.request(`/api/files/${encodeURIComponent(ticket.id)}/interview`)
    expect(interviewFile.status).toBe(200)
    expect(await parseJson<{ exists: boolean }>(interviewFile)).toMatchObject({ exists: true })

    const approveInterview = await requestAndWaitForTicketStatus(
      ticket.id,
      'WAITING_PRD_APPROVAL',
      () => app.request(`/api/tickets/${encodeURIComponent(ticket.id)}/approve-interview`, { method: 'POST' }),
    )
    expect(approveInterview.status).toBe(200)

    const prdFile = await app.request(`/api/files/${encodeURIComponent(ticket.id)}/prd`)
    expect(prdFile.status).toBe(200)
    expect(await parseJson<{ exists: boolean; content: string }>(prdFile)).toMatchObject({ exists: true })

    const approvePrd = await requestAndWaitForTicketStatus(
      ticket.id,
      'WAITING_BEADS_APPROVAL',
      () => app.request(`/api/tickets/${encodeURIComponent(ticket.id)}/approve-prd`, { method: 'POST' }),
    )
    expect(approvePrd.status).toBe(200)

    const beadsResponse = await app.request(`/api/tickets/${encodeURIComponent(ticket.id)}/beads`)
    expect(beadsResponse.status).toBe(200)
    const beads = await parseJson<Array<{ id: string; status: string }>>(beadsResponse)
    expect(beads.length).toBeGreaterThan(0)
    expect(beads.every(bead => bead.status === 'pending')).toBe(true)

    const approveBeads = await requestAndWaitForTicketStatus(
      ticket.id,
      'BLOCKED_ERROR',
      () => app.request(`/api/tickets/${encodeURIComponent(ticket.id)}/approve-beads`, { method: 'POST' }),
    )
    expect(approveBeads.status).toBe(200)

    const executionLogPath = getTicketExecutionLogPath(repoDir, ticket.externalId)
    expect(fs.existsSync(executionLogPath)).toBe(true)
    expect(fs.existsSync(path.join(worktreePath, '.ticket', 'execution-log.jsonl'))).toBe(false)

    const logsResponse = await app.request(`/api/files/${encodeURIComponent(ticket.id)}/logs`)
    expect(logsResponse.status).toBe(200)
    const logs = await parseJson<Array<{ phase: string; message: string }>>(logsResponse)
    expect(logs.length).toBeGreaterThan(0)
    expect(logs.some(entry => entry.phase === 'PRE_FLIGHT_CHECK')).toBe(true)

    const artifacts = await app.request(`/api/tickets/${encodeURIComponent(ticket.id)}/artifacts`)
    expect(artifacts.status).toBe(200)
    expect(await parseJson<Array<{ artifactType: string }>>(artifacts)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ artifactType: 'final_test_report' }),
        expect.objectContaining({ artifactType: 'integration_report' }),
        expect.objectContaining({ artifactType: 'cleanup_report' }),
      ]),
    )

    const paths = getTicketPaths(ticket.id)
    expect(paths?.worktreePath).toBe(worktreePath)
    expect(paths?.executionLogPath).toBe(executionLogPath)
  })

  it('deletes completed or canceled tickets and clears stored ticket data', async () => {
    const repoDir = createGitRepo('looptroop-ticket-delete-')

    const createProject = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Delete Project',
        shortname: 'DEL',
        folderPath: repoDir,
      }),
    })
    const project = await parseJson<{ id: number }>(createProject)

    const createTicket = await app.request('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        title: 'Delete me',
      }),
    })
    expect(createTicket.status).toBe(201)
    const ticket = await parseJson<{ id: string; externalId: string }>(createTicket)
    trackTicket(ticket.id)

    initializeTicket({
      externalId: ticket.externalId,
      projectFolder: repoDir,
    })

    patchTicket(ticket.id, {
      status: 'CANCELED',
      branchName: ticket.externalId,
    })

    const projectContext = getProjectContextById(project.id)
    expect(projectContext).toBeTruthy()
    const localTicket = projectContext?.projectDb.select().from(tickets).get()
    expect(localTicket).toBeTruthy()
    const localTicketId = localTicket!.id

    projectContext!.projectDb.insert(phaseArtifacts).values({
      ticketId: localTicketId,
      phase: 'CANCELED',
      artifactType: 'ui_state:interview_qa',
      content: '{"data":{"answers":{}}}',
    }).run()
    projectContext!.projectDb.insert(opencodeSessions).values({
      ticketId: localTicketId,
      sessionId: 'mock-session-delete',
      phase: 'CANCELED',
      phaseAttempt: 1,
      state: 'completed',
    }).run()
    projectContext!.projectDb.insert(ticketStatusHistory).values({
      ticketId: localTicketId,
      previousStatus: 'DRAFT',
      newStatus: 'CANCELED',
      reason: 'Deleted in test',
    }).run()
    appendLogEvent(ticket.id, 'info', 'CANCELED', 'Delete test log entry')

    const worktreePath = getTicketWorktreePath(repoDir, ticket.externalId)
    expect(fs.existsSync(worktreePath)).toBe(true)

    const deleteResponse = await app.request(`/api/tickets/${encodeURIComponent(ticket.id)}`, { method: 'DELETE' })
    expect(deleteResponse.status).toBe(200)
    expect(await parseJson<{ success: boolean; ticketId: string }>(deleteResponse)).toMatchObject({
      success: true,
      ticketId: ticket.id,
    })

    const deletedTicket = await app.request(`/api/tickets/${encodeURIComponent(ticket.id)}`)
    expect(deletedTicket.status).toBe(404)

    const listedTickets = await app.request(`/api/tickets?projectId=${project.id}`)
    expect(await parseJson<Array<{ id: string }>>(listedTickets)).toEqual([])

    expect(projectContext!.projectDb.select().from(tickets).all()).toEqual([])
    expect(projectContext!.projectDb.select().from(phaseArtifacts).all()).toEqual([])
    expect(projectContext!.projectDb.select().from(opencodeSessions).all()).toEqual([])
    expect(projectContext!.projectDb.select().from(ticketStatusHistory).all()).toEqual([])
    expect(fs.existsSync(worktreePath)).toBe(false)

    const worktreeList = execFileSync('git', ['-C', repoDir, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' })
    expect(worktreeList).not.toContain(worktreePath)
    expect(() => execFileSync(
      'git',
      ['-C', repoDir, 'show-ref', '--verify', '--quiet', `refs/heads/${ticket.externalId}`],
      { stdio: 'pipe' },
    )).toThrow()
  })

  it('rejects deleting non-terminal tickets', async () => {
    const repoDir = createGitRepo('looptroop-ticket-delete-guard-')

    const createProject = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Delete Guard Project',
        shortname: 'DLG',
        folderPath: repoDir,
      }),
    })
    const project = await parseJson<{ id: number }>(createProject)

    const createTicket = await app.request('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        title: 'Still draft',
      }),
    })
    const ticket = await parseJson<{ id: string }>(createTicket)
    trackTicket(ticket.id)

    const deleteResponse = await app.request(`/api/tickets/${encodeURIComponent(ticket.id)}`, { method: 'DELETE' })
    expect(deleteResponse.status).toBe(409)
    expect(await parseJson<{ error: string }>(deleteResponse)).toMatchObject({
      error: 'Only completed or canceled tickets can be deleted',
    })
  })
})
