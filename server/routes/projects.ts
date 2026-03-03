import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db/index'
import { projects, tickets, phaseArtifacts } from '../db/schema'
import { eq, inArray } from 'drizzle-orm'
import { existsSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'

const projectRouter = new Hono()

const perProjectOverrides = {
  councilMembers: z.string().optional(),
  maxIterations: z.number().int().min(0).max(20).optional(),
  perIterationTimeout: z.number().int().nonnegative().optional(),
  councilResponseTimeout: z.number().int().positive().optional(),
  minCouncilQuorum: z.number().int().min(1).max(4).optional(),
  interviewQuestions: z.number().int().min(0).max(50).optional(),
}

const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  shortname: z.string().min(3).max(5).regex(/^[A-Z0-9]+$/, 'Shortname must be 3-5 uppercase letters or numbers'),
  icon: z.string().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  folderPath: z.string().min(1),
  profileId: z.number().int().positive().optional(),
  ...perProjectOverrides,
})

const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  icon: z.string().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  ...perProjectOverrides,
})

// Normalize Windows paths for WSL compatibility (e.g. D:\foo → /mnt/d/foo)
function normalizeFolderPath(p: string): string {
  p = p.trim().replace(/[\\/]+$/, '')
  p = p.replace(/\\/g, '/')
  const driveMatch = p.match(/^([A-Za-z]):\/(.*)$/)
  if (driveMatch && driveMatch[1] && driveMatch[2] !== undefined) {
    p = `/mnt/${driveMatch[1].toLowerCase()}/${driveMatch[2]}`
  }
  return p
}

function isGitRepo(folderPath: string): boolean {
  const resolved = normalizeFolderPath(folderPath)
  if (!existsSync(resolved)) {
    console.warn(`[isGitRepo] Path does not exist: ${resolved} (original: ${folderPath})`)
    return false
  }
  const gitPath = join(resolved, '.git')
  if (existsSync(gitPath)) return true
  try {
    execSync('git rev-parse --git-dir', { cwd: resolved, stdio: 'pipe' })
    return true
  } catch (err) {
    console.warn(`[isGitRepo] Not a git repo: ${resolved}`, (err as Error).message)
    return false
  }
}

projectRouter.get('/projects/check-git', (c) => {
  const rawPath = c.req.query('path')
  if (!rawPath) return c.json({ status: 'none', message: 'No path provided' })

  const folderPath = normalizeFolderPath(rawPath)

  if (!existsSync(folderPath)) {
    return c.json({ status: 'invalid', isGit: false, message: `Folder does not exist: ${folderPath}` })
  }

  const gitPath = join(folderPath, '.git')
  if (existsSync(gitPath)) {
    return c.json({ status: 'valid', isGit: true, message: 'Git repository detected' })
  }

  try {
    execSync('git rev-parse --git-dir', { cwd: folderPath, stdio: 'pipe' })
    return c.json({ status: 'valid', isGit: true, message: 'Git repository detected (subdirectory)' })
  } catch {
    return c.json({ status: 'invalid', isGit: false, message: 'Folder is not a git repository' })
  }
})

projectRouter.get('/projects', (c) => {
  const all = db.select().from(projects).all()
  return c.json(all)
})

projectRouter.get('/projects/:id', (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid project ID' }, 400)
  const project = db.select().from(projects).where(eq(projects.id, id)).get()
  if (!project) return c.json({ error: 'Project not found' }, 404)
  return c.json(project)
})

projectRouter.post('/projects', async (c) => {
  const body = await c.req.json()
  const parsed = createProjectSchema.safeParse(body)
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors
    const message = Object.entries(fieldErrors)
      .map(([field, errors]) => `${field}: ${(errors as string[]).join(', ')}`)
      .join('; ')
    return c.json({ error: 'Invalid input', details: parsed.error.flatten(), message }, 400)
  }
  
  // Validate git repository
  if (!isGitRepo(parsed.data.folderPath)) {
    return c.json({ 
      error: 'Folder is not a git repository',
      details: `No git repository found at: ${parsed.data.folderPath}. Please initialize the repository with 'git init' first.`
    }, 400)
  }
  
  const result = db.insert(projects).values(parsed.data).returning().get()
  return c.json(result, 201)
})

projectRouter.patch('/projects/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid project ID' }, 400)
  const body = await c.req.json()
  const parsed = updateProjectSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.flatten() }, 400)
  }
  const existing = db.select().from(projects).where(eq(projects.id, id)).get()
  if (!existing) return c.json({ error: 'Project not found' }, 404)
  const result = db.update(projects)
    .set({ ...parsed.data, updatedAt: new Date().toISOString() })
    .where(eq(projects.id, id))
    .returning()
    .get()
  return c.json(result)
})

projectRouter.delete('/projects/:id', (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid project ID' }, 400)
  const existing = db.select().from(projects).where(eq(projects.id, id)).get()
  if (!existing) return c.json({ error: 'Project not found' }, 404)

  // Check all tickets for this project
  const projectTickets = db.select().from(tickets).where(eq(tickets.projectId, id)).all()
  const allowedStatuses = ['DRAFT', 'COMPLETED', 'CANCELED']
  const hasInProgress = projectTickets.some(t => !allowedStatuses.includes(t.status))

  if (hasInProgress) {
    return c.json({ error: 'Cannot delete project. Some tickets are still in progress. Move all tickets to Done or cancel them first.' }, 409)
  }

  // Cascade delete: phase_artifacts → tickets → project
  if (projectTickets.length > 0) {
    const ticketIds = projectTickets.map(t => t.id)
    db.delete(phaseArtifacts).where(inArray(phaseArtifacts.ticketId, ticketIds)).run()
    db.delete(tickets).where(eq(tickets.projectId, id)).run()
  }
  db.delete(projects).where(eq(projects.id, id)).run()
  return c.json({ success: true })
})

export { projectRouter }
