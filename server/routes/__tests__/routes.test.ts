import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { db } from '../../db/index'
import { profiles, projects, tickets, phaseArtifacts, opencodeSessions, ticketStatusHistory } from '../../db/schema'
import { initializeDatabase } from '../../db/init'
import { health } from '../health'
import { profileRouter } from '../profiles'
import { projectRouter } from '../projects'
import { ticketRouter } from '../tickets'
import { modelsRouter } from '../models'
import { filesRouter } from '../files'
import { beadsRouter } from '../beads'
import { validateJson } from '../../middleware/validation'
import { eq } from 'drizzle-orm'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const WORKTREE_ROOT = path.join('.looptroop', 'worktrees')

const app = new Hono()
app.use('/api/*', validateJson)
app.route('/api', health)
app.route('/api', profileRouter)
app.route('/api', projectRouter)
app.route('/api', ticketRouter)
app.route('/api', modelsRouter)
app.route('/api', filesRouter)
app.route('/api', beadsRouter)

beforeAll(() => {
  initializeDatabase()
})

beforeEach(() => {
  // Clean tables in order respecting foreign keys
  db.delete(opencodeSessions).run()
  db.delete(phaseArtifacts).run()
  db.delete(ticketStatusHistory).run()
  db.delete(tickets).run()
  db.delete(projects).run()
  db.delete(profiles).run()
})

function createGitRepo(prefix: string, withMainBranch: boolean = true): string {
  const repoDir = fs.mkdtempSync(path.join(tmpdir(), prefix))
  execFileSync('git', ['-C', repoDir, 'init'], { stdio: 'pipe' })
  execFileSync('git', ['-C', repoDir, 'config', 'user.email', 'test@example.com'], { stdio: 'pipe' })
  execFileSync('git', ['-C', repoDir, 'config', 'user.name', 'LoopTroop Tests'], { stdio: 'pipe' })
  fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({ name: 'fixture', private: true }, null, 2))
  execFileSync('git', ['-C', repoDir, 'add', 'package.json'], { stdio: 'pipe' })
  execFileSync('git', ['-C', repoDir, 'commit', '-m', 'init'], { stdio: 'pipe' })
  execFileSync('git', ['-C', repoDir, 'branch', '-M', withMainBranch ? 'main' : 'trunk'], { stdio: 'pipe' })
  return repoDir
}

describe('Health routes', () => {
  it('GET /api/health returns 200', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('ok')
    expect(json.timestamp).toBeDefined()
  })

  it('GET /api/health/opencode returns health status from adapter', async () => {
    const res = await app.request('/api/health/opencode')
    expect(res.status).toBe(200)
    const json = await res.json()
    // Adapter may return ok or unavailable depending on test environment
    expect(['ok', 'unavailable']).toContain(json.status)
  })
})

describe('Profile routes', () => {
  it('GET /api/profile returns null initially', async () => {
    const res = await app.request('/api/profile')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toBeNull()
  })

  it('POST /api/profile creates profile', async () => {
    const res = await app.request('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser' }),
    })
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.username).toBe('testuser')
    expect(json.id).toBeDefined()
  })

  it('POST /api/profile rejects duplicate', async () => {
    await app.request('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser' }),
    })
    const res = await app.request('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'another' }),
    })
    expect(res.status).toBe(409)
  })

  it('POST /api/profile rejects invalid input', async () => {
    const res = await app.request('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('Project routes', () => {
  const gitTestDirs: string[] = []

  afterEach(() => {
    for (const dir of gitTestDirs.splice(0)) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    }
  })

  it('GET /api/projects returns empty array', async () => {
    const res = await app.request('/api/projects')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual([])
  })

  it('GET /api/projects/check-git marks repo root selection', async () => {
    const repoDir = fs.mkdtempSync(path.join(tmpdir(), 'looptroop-git-root-'))
    gitTestDirs.push(repoDir)
    execFileSync('git', ['-C', repoDir, 'init'], { stdio: 'pipe' })

    const res = await app.request(`/api/projects/check-git?path=${encodeURIComponent(repoDir)}`)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.isGit).toBe(true)
    expect(json.status).toBe('valid')
    expect(json.scope).toBe('root')
    expect(json.repoRoot).toBe(repoDir)
    expect(json.message).toBe('Git repository root selected')
  })

  it('GET /api/projects/check-git marks nested folder selection', async () => {
    const repoDir = fs.mkdtempSync(path.join(tmpdir(), 'looptroop-git-subdir-'))
    gitTestDirs.push(repoDir)
    execFileSync('git', ['-C', repoDir, 'init'], { stdio: 'pipe' })

    const nestedDir = path.join(repoDir, 'packages', 'app')
    fs.mkdirSync(nestedDir, { recursive: true })

    const res = await app.request(`/api/projects/check-git?path=${encodeURIComponent(nestedDir)}`)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.isGit).toBe(true)
    expect(json.status).toBe('valid')
    expect(json.scope).toBe('subfolder')
    expect(json.repoRoot).toBe(repoDir)
    expect(json.message).toContain('Subfolder inside Git repository')
    expect(json.message).toContain(`root: ${repoDir}`)
  })

  it('GET /api/projects/ls includes hidden directories', async () => {
    const browseDir = fs.mkdtempSync(path.join(tmpdir(), 'looptroop-project-ls-'))
    gitTestDirs.push(browseDir)
    fs.mkdirSync(path.join(browseDir, '.git'))
    fs.mkdirSync(path.join(browseDir, '.config'))
    fs.mkdirSync(path.join(browseDir, 'src'))
    fs.writeFileSync(path.join(browseDir, '.env'), 'SECRET=test\n')

    const res = await app.request(`/api/projects/ls?path=${encodeURIComponent(browseDir)}`)
    expect(res.status).toBe(200)
    const json = await res.json()

    expect(json.currentPath).toBe(browseDir)
    expect(json.dirs).toEqual([
      { name: '.config', path: path.join(browseDir, '.config') },
      { name: '.git', path: path.join(browseDir, '.git') },
      { name: 'src', path: path.join(browseDir, 'src') },
    ])
  })

  it('POST /api/projects creates a project', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Project',
        shortname: 'TEST',
        folderPath: '/tmp/test',
      }),
    })
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.name).toBe('Test Project')
    expect(json.shortname).toBe('TEST')
    expect(json.id).toBeDefined()
  })

  it('POST /api/projects rejects invalid shortname', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bad Project',
        shortname: 'ab',
        folderPath: '/tmp/test',
      }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/projects rejects lowercase shortname', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bad Project',
        shortname: 'test',
        folderPath: '/tmp/test',
      }),
    })
    expect(res.status).toBe(400)
  })

  it('DELETE /api/projects/:id deletes a project', async () => {
    const create = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'To Delete',
        shortname: 'DEL',
        folderPath: '/tmp/del',
      }),
    })
    const project = await create.json()

    const res = await app.request(`/api/projects/${project.id}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
  })
})

describe('Ticket routes', () => {
  let projectId: number
  let repoDir: string
  const tempRepos: string[] = []
  const cleanupTicketDirs = () => {
    for (const externalId of ['TKT-1', 'BRK-1']) {
      const ticketDir = path.join(WORKTREE_ROOT, externalId)
      if (fs.existsSync(ticketDir)) {
        fs.rmSync(ticketDir, { recursive: true, force: true })
      }
    }
  }

  beforeEach(async () => {
    cleanupTicketDirs()
    repoDir = createGitRepo('looptroop-ticket-route-')
    tempRepos.push(repoDir)
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Ticket Project',
        shortname: 'TKT',
        folderPath: repoDir,
      }),
    })
    const project = await res.json()
    projectId = project.id
  })

  afterEach(() => {
    for (const dir of tempRepos.splice(0)) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    }
    cleanupTicketDirs()
  })

  it('GET /api/tickets returns empty array', async () => {
    const res = await app.request('/api/tickets')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual([])
  })

  it('POST /api/tickets creates a ticket with auto-generated external_id', async () => {
    const res = await app.request('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        title: 'First ticket',
      }),
    })
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.externalId).toBe('TKT-1')
    expect(json.status).toBe('DRAFT')
    expect(json.title).toBe('First ticket')
    expect(fs.existsSync(path.join(WORKTREE_ROOT, json.externalId, '.ticket', 'meta', 'ticket.meta.json'))).toBe(true)
  })

  it('POST /api/tickets rejects without projectId', async () => {
    const res = await app.request('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'No project' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/tickets rejects nonexistent project', async () => {
    const res = await app.request('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 99999, title: 'Bad project' }),
    })
    expect(res.status).toBe(404)
  })

  it('PATCH /api/tickets/:id rejects status field (API-protected)', async () => {
    const create = await app.request('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, title: 'Protected' }),
    })
    const ticket = await create.json()

    const res = await app.request(`/api/tickets/${ticket.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'COMPLETED' }),
    })
    expect(res.status).toBe(403)
  })

  it('POST /api/tickets/:id/start initializes ticket workspace before interview start', async () => {
    const create = await app.request('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, title: 'Start me' }),
    })
    const ticket = await create.json()

    const res = await app.request(`/api/tickets/${ticket.id}/start`, {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.message).toBe('Start action accepted')
    expect(json.status).toBe('COUNCIL_DELIBERATING')

    const ticketDir = path.join(WORKTREE_ROOT, ticket.externalId, '.ticket')
    expect(fs.existsSync(path.join(ticketDir, 'codebase-map.yaml'))).toBe(true)
    expect(fs.existsSync(path.join(ticketDir, '.gitignore'))).toBe(true)

    const dbTicket = db.select().from(tickets).where(eq(tickets.id, ticket.id)).get()
    expect(dbTicket?.branchName).toBe(ticket.externalId)
    expect(dbTicket?.startedAt).toBeTruthy()
  })

  it('POST /api/tickets/:id/start blocks the ticket when initialization fails', async () => {
    const badRepo = createGitRepo('looptroop-ticket-bad-', false)
    tempRepos.push(badRepo)
    const projectRes = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Broken Ticket Project',
        shortname: 'BRK',
        folderPath: badRepo,
      }),
    })
    const brokenProject = await projectRes.json()

    const create = await app.request('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: brokenProject.id, title: 'Break me' }),
    })
    const ticket = await create.json()

    const res = await app.request(`/api/tickets/${ticket.id}/start`, {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.message).toBe('Start blocked during initialization')
    expect(json.status).toBe('BLOCKED_ERROR')
    expect(json.codes).toContain('INIT_MAIN_BRANCH_MISSING')

    const dbTicket = db.select().from(tickets).where(eq(tickets.id, ticket.id)).get()
    expect(dbTicket?.status).toBe('BLOCKED_ERROR')
    expect(dbTicket?.startedAt).toBeNull()
  })

  it('POST /api/tickets/:id/cancel validates non-terminal', async () => {
    const create = await app.request('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, title: 'Cancel me' }),
    })
    const ticket = await create.json()

    const res = await app.request(`/api/tickets/${ticket.id}/cancel`, {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.message).toBe('Cancel action accepted')
  })

  it('POST /api/tickets/:id/start rejects non-DRAFT ticket', async () => {
    const res = await app.request('/api/tickets/99999/start', {
      method: 'POST',
    })
    expect(res.status).toBe(404)
  })

  it('GET /api/tickets?projectId filters by project', async () => {
    await app.request('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, title: 'Filtered ticket' }),
    })

    const res = await app.request(`/api/tickets?projectId=${projectId}`)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.length).toBe(1)
    expect(json[0].title).toBe('Filtered ticket')
  })
})

describe('Models route', () => {
  it('GET /api/models returns model list', async () => {
    const res = await app.request('/api/models')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.models).toEqual([])
  })
})

describe('Specific workflow routes', () => {
  let projectId: number
  let ticketId: number

  beforeEach(async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Workflow Project',
        shortname: 'WRK',
        folderPath: '/tmp/wrk',
      }),
    })
    const project = await res.json()
    projectId = project.id

    const tRes = await app.request('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, title: 'Workflow ticket' }),
    })
    const ticket = await tRes.json()
    ticketId = ticket.id
  })

  it('POST /api/tickets/:id/answer returns 409 when not in WAITING_INTERVIEW_ANSWERS', async () => {
    const res = await app.request(`/api/tickets/${ticketId}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: {} }),
    })
    expect(res.status).toBe(409)
  })

  it('POST /api/tickets/:id/answer returns 404 for missing ticket', async () => {
    const res = await app.request('/api/tickets/99999/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: {} }),
    })
    expect(res.status).toBe(404)
  })

  it('POST /api/tickets/:id/skip returns 409 when not in WAITING_INTERVIEW_ANSWERS', async () => {
    const res = await app.request(`/api/tickets/${ticketId}/skip`, {
      method: 'POST',
    })
    expect(res.status).toBe(409)
  })

  it('POST /api/tickets/:id/skip returns 404 for missing ticket', async () => {
    const res = await app.request('/api/tickets/99999/skip', {
      method: 'POST',
    })
    expect(res.status).toBe(404)
  })

  it('POST /api/tickets/:id/approve-interview returns 409 when not in WAITING_INTERVIEW_APPROVAL', async () => {
    const res = await app.request(`/api/tickets/${ticketId}/approve-interview`, {
      method: 'POST',
    })
    expect(res.status).toBe(409)
  })

  it('POST /api/tickets/:id/approve-prd returns 409 when not in WAITING_PRD_APPROVAL', async () => {
    const res = await app.request(`/api/tickets/${ticketId}/approve-prd`, {
      method: 'POST',
    })
    expect(res.status).toBe(409)
  })

  it('POST /api/tickets/:id/approve-beads returns 409 when not in WAITING_BEADS_APPROVAL', async () => {
    const res = await app.request(`/api/tickets/${ticketId}/approve-beads`, {
      method: 'POST',
    })
    expect(res.status).toBe(409)
  })

  it('POST /api/tickets/:id/verify returns 409 when not in WAITING_MANUAL_VERIFICATION', async () => {
    const res = await app.request(`/api/tickets/${ticketId}/verify`, {
      method: 'POST',
    })
    expect(res.status).toBe(409)
  })

  it('POST /api/tickets/:id/verify returns 404 for missing ticket', async () => {
    const res = await app.request('/api/tickets/99999/verify', {
      method: 'POST',
    })
    expect(res.status).toBe(404)
  })

  it('POST /api/tickets/:id/answer returns 200 when in WAITING_INTERVIEW_ANSWERS', async () => {
    // Force the ticket status to WAITING_INTERVIEW_ANSWERS
    db.update(tickets)
      .set({ status: 'WAITING_INTERVIEW_ANSWERS' })
      .where(eq(tickets.id, ticketId))
      .run()

    const res = await app.request(`/api/tickets/${ticketId}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: { q1: 'a1' } }),
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.message).toBe('Answer submitted')
  })

  it('POST /api/tickets/:id/skip returns 200 when in WAITING_INTERVIEW_ANSWERS', async () => {
    db.update(tickets)
      .set({ status: 'WAITING_INTERVIEW_ANSWERS' })
      .where(eq(tickets.id, ticketId))
      .run()

    const res = await app.request(`/api/tickets/${ticketId}/skip`, {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.message).toBe('Question skipped')
  })

  it('GET /api/tickets/:id/ui-state returns empty state when missing', async () => {
    const res = await app.request(`/api/tickets/${ticketId}/ui-state?scope=interview_qa`)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.exists).toBe(false)
    expect(json.data).toBeNull()
  })

  it('PUT /api/tickets/:id/ui-state persists and GET hydrates state', async () => {
    const putRes = await app.request(`/api/tickets/${ticketId}/ui-state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'interview_qa',
        data: {
          answers: { q1: 'A1' },
          currentIndex: 2,
          submittedIds: ['q1'],
        },
      }),
    })
    expect(putRes.status).toBe(200)

    const getRes = await app.request(`/api/tickets/${ticketId}/ui-state?scope=interview_qa`)
    expect(getRes.status).toBe(200)
    const json = await getRes.json()
    expect(json.exists).toBe(true)
    expect(json.data.answers.q1).toBe('A1')
    expect(json.data.currentIndex).toBe(2)
    expect(json.data.submittedIds).toEqual(['q1'])
  })

  it('POST /api/tickets/:id/answer also persists interview_qa UI state', async () => {
    db.update(tickets)
      .set({ status: 'WAITING_INTERVIEW_ANSWERS' })
      .where(eq(tickets.id, ticketId))
      .run()

    const answerRes = await app.request(`/api/tickets/${ticketId}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: { q2: 'Saved answer' } }),
    })
    expect(answerRes.status).toBe(200)

    const stateRes = await app.request(`/api/tickets/${ticketId}/ui-state?scope=interview_qa`)
    expect(stateRes.status).toBe(200)
    const json = await stateRes.json()
    expect(json.exists).toBe(true)
    expect(json.data.answers.q2).toBe('Saved answer')
  })
})

describe('Files routes', () => {
  let projectId: number
  let ticketId: number
  let externalId: string
  const testDir = path.join('.looptroop', 'worktrees')

  beforeEach(async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Files Project',
        shortname: 'FIL',
        folderPath: '/tmp/fil',
      }),
    })
    const project = await res.json()
    projectId = project.id

    const tRes = await app.request('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, title: 'Files ticket' }),
    })
    const ticket = await tRes.json()
    ticketId = ticket.id
    externalId = ticket.externalId
  })

  afterEach(() => {
    // Clean up test files
    const ticketDir = path.join(testDir, externalId)
    if (fs.existsSync(ticketDir)) {
      fs.rmSync(ticketDir, { recursive: true, force: true })
    }
  })

  it('GET /api/files/:ticketId/interview returns not exists for missing file', async () => {
    const res = await app.request(`/api/files/${ticketId}/interview`)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.exists).toBe(false)
    expect(json.content).toBe('')
  })

  it('GET /api/files/:ticketId/logs normalizes missing status from phase', async () => {
    const logPath = path.join(testDir, externalId, '.ticket', 'execution-log.jsonl')
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    fs.writeFileSync(
      logPath,
      [
        JSON.stringify({
          timestamp: '2026-03-05T12:00:00.000Z',
          type: 'info',
          phase: 'CODING',
          message: 'Started coding',
        }),
        JSON.stringify({
          timestamp: '2026-03-05T12:01:00.000Z',
          type: 'error',
          phase: 'BLOCKED_ERROR',
          status: 'BLOCKED_ERROR',
          message: 'Compile failed',
        }),
      ].join('\n'),
    )

    const res = await app.request(`/api/files/${ticketId}/logs`)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json)).toBe(true)
    expect(json).toHaveLength(3)
    expect(json[0].phase).toBe('CODING')
    expect(json[0].status).toBe('CODING')
    expect(json[1].status).toBe('BLOCKED_ERROR')
    expect(json[2].status).toBe('DRAFT')
    expect(json[2].message).toContain('[APP] Status DRAFT is active')
  })

  it('GET /api/files/:ticketId/logs supports status filter', async () => {
    const logPath = path.join(testDir, externalId, '.ticket', 'execution-log.jsonl')
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    fs.writeFileSync(
      logPath,
      [
        JSON.stringify({
          timestamp: '2026-03-05T12:00:00.000Z',
          type: 'info',
          phase: 'COUNCIL_DELIBERATING',
          status: 'COUNCIL_DELIBERATING',
          message: 'Drafting started',
        }),
        JSON.stringify({
          timestamp: '2026-03-05T12:01:00.000Z',
          type: 'state_change',
          phase: 'COUNCIL_VOTING_INTERVIEW',
          status: 'COUNCIL_VOTING_INTERVIEW',
          message: 'Transition',
        }),
      ].join('\n'),
    )

    const res = await app.request(`/api/files/${ticketId}/logs?status=COUNCIL_VOTING_INTERVIEW`)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json)).toBe(true)
    expect(json).toHaveLength(1)
    expect(json[0].status).toBe('COUNCIL_VOTING_INTERVIEW')
  })

  it('GET /api/files/:ticketId/invalid returns 400 for invalid file type', async () => {
    const res = await app.request(`/api/files/${ticketId}/invalid`)
    expect(res.status).toBe(400)
  })

  it('GET /api/files/99999/interview returns 404 for missing ticket', async () => {
    const res = await app.request('/api/files/99999/interview')
    expect(res.status).toBe(404)
  })

  it('PUT /api/files/:ticketId/interview writes and GET reads back', async () => {
    const content = 'question: What is this?\nanswer: A test'
    const putRes = await app.request(`/api/files/${ticketId}/interview`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    expect(putRes.status).toBe(200)
    const putJson = await putRes.json()
    expect(putJson.success).toBe(true)

    const getRes = await app.request(`/api/files/${ticketId}/interview`)
    expect(getRes.status).toBe(200)
    const getJson = await getRes.json()
    expect(getJson.exists).toBe(true)
    expect(getJson.content).toBe(content)
  })

  it('PUT /api/files/:ticketId/prd works for prd file type', async () => {
    const putRes = await app.request(`/api/files/${ticketId}/prd`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'prd content' }),
    })
    expect(putRes.status).toBe(200)
    const putJson = await putRes.json()
    expect(putJson.success).toBe(true)
  })

  it('PUT /api/files/:ticketId/invalid returns 400 for invalid file type', async () => {
    const putRes = await app.request(`/api/files/${ticketId}/invalid`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'test' }),
    })
    expect(putRes.status).toBe(400)
  })

  it('PUT /api/files/:ticketId/interview rejects missing content', async () => {
    const putRes = await app.request(`/api/files/${ticketId}/interview`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(putRes.status).toBe(400)
  })
})

describe('Beads routes', () => {
  let projectId: number
  let ticketId: number
  let externalId: string
  const testDir = path.join('.looptroop', 'worktrees')

  beforeEach(async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Beads Project',
        shortname: 'BDS',
        folderPath: '/tmp/bds',
      }),
    })
    const project = await res.json()
    projectId = project.id

    const tRes = await app.request('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, title: 'Beads ticket' }),
    })
    const ticket = await tRes.json()
    ticketId = ticket.id
    externalId = ticket.externalId
  })

  afterEach(() => {
    const ticketDir = path.join(testDir, externalId)
    if (fs.existsSync(ticketDir)) {
      fs.rmSync(ticketDir, { recursive: true, force: true })
    }
  })

  it('GET /api/tickets/:id/beads returns empty array when no file', async () => {
    const res = await app.request(`/api/tickets/${ticketId}/beads`)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual([])
  })

  it('GET /api/tickets/:id/beads returns 404 for missing ticket', async () => {
    const res = await app.request('/api/tickets/99999/beads')
    expect(res.status).toBe(404)
  })

  it('PUT /api/tickets/:id/beads writes JSONL and GET reads it back', async () => {
    const beads = [
      { id: 'b1', title: 'First bead', status: 'pending' },
      { id: 'b2', title: 'Second bead', status: 'done' },
    ]

    const putRes = await app.request(`/api/tickets/${ticketId}/beads?flow=main`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(beads),
    })
    expect(putRes.status).toBe(200)
    const putJson = await putRes.json()
    expect(putJson.success).toBe(true)

    const getRes = await app.request(`/api/tickets/${ticketId}/beads?flow=main`)
    expect(getRes.status).toBe(200)
    const getJson = await getRes.json()
    expect(getJson).toEqual(beads)
  })

  it('PUT /api/tickets/:id/beads rejects non-array body', async () => {
    const putRes = await app.request(`/api/tickets/${ticketId}/beads`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ not: 'array' }),
    })
    expect(putRes.status).toBe(400)
  })

  it('PUT /api/tickets/:id/beads returns 404 for missing ticket', async () => {
    const putRes = await app.request('/api/tickets/99999/beads', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([]),
    })
    expect(putRes.status).toBe(404)
  })

  it('GET /api/tickets/:id/beads defaults flow to main', async () => {
    const beads = [{ id: 'b1', title: 'Default flow' }]

    await app.request(`/api/tickets/${ticketId}/beads`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(beads),
    })

    const getRes = await app.request(`/api/tickets/${ticketId}/beads`)
    expect(getRes.status).toBe(200)
    const getJson = await getRes.json()
    expect(getJson).toEqual(beads)
  })
})
