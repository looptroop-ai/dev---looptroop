import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db/index'
import { projects, tickets, phaseArtifacts } from '../db/schema'
import { eq, inArray } from 'drizzle-orm'
import { existsSync, readdirSync, statSync } from 'fs'
import { resolve as resolvePath, isAbsolute, dirname } from 'path'
import { homedir } from 'os'
import { execFileSync } from 'child_process'

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
  if (!isAbsolute(p)) {
    p = resolvePath(process.cwd(), p)
  }
  return p
}

interface GitRepoInfo {
  isGit: boolean
  repoRoot?: string
  isRepoRoot?: boolean
}

function getGitRepoInfo(folderPath: string): GitRepoInfo {
  const resolved = normalizeFolderPath(folderPath)
  if (!existsSync(resolved)) {
    console.warn(`[getGitRepoInfo] Path does not exist: ${resolved} (original: ${folderPath})`)
    return { isGit: false }
  }

  try {
    const inside = execFileSync('git', ['-C', resolved, 'rev-parse', '--is-inside-work-tree'], { stdio: 'pipe' })
      .toString()
      .trim()

    if (inside !== 'true') return { isGit: false }

    const repoRoot = normalizeFolderPath(
      execFileSync('git', ['-C', resolved, 'rev-parse', '--show-toplevel'], { stdio: 'pipe' })
        .toString()
        .trim(),
    )

    return {
      isGit: true,
      repoRoot,
      isRepoRoot: repoRoot === resolved,
    }
  } catch (err) {
    console.warn(`[getGitRepoInfo] Not a git repo: ${resolved}`, (err as Error).message)
    return { isGit: false }
  }
}

function isGitRepo(folderPath: string): boolean {
  return getGitRepoInfo(folderPath).isGit
}

projectRouter.get('/projects/check-git', (c) => {
  const rawPath = c.req.query('path')
  if (!rawPath) return c.json({ isGit: false, status: 'none', message: 'No path provided' })

  const folderPath = normalizeFolderPath(rawPath)

  if (!existsSync(folderPath)) {
    return c.json({ isGit: false, status: 'invalid', message: `Folder does not exist: ${folderPath}` })
  }

  const gitInfo = getGitRepoInfo(folderPath)
  if (gitInfo.isGit) {
    if (gitInfo.isRepoRoot) {
      return c.json({
        isGit: true,
        status: 'valid',
        scope: 'root',
        repoRoot: gitInfo.repoRoot,
        message: 'Git repository root selected',
      })
    }

    return c.json({
      isGit: true,
      status: 'valid',
      scope: 'subfolder',
      repoRoot: gitInfo.repoRoot,
      message: `Subfolder inside Git repository (root: ${gitInfo.repoRoot})`,
    })
  }

  return c.json({ isGit: false, status: 'invalid', message: 'Folder is not a git repository' })
})

projectRouter.get('/projects/ls', (c) => {
  const rawPath = c.req.query('path')
  const targetPath = normalizeFolderPath(rawPath || homedir())

  if (!existsSync(targetPath)) {
    return c.json({ error: `Path does not exist: ${targetPath}` }, 400)
  }

  try {
    const entries = readdirSync(targetPath)
    const dirs = entries
      .filter((name) => !name.startsWith('.'))
      .flatMap((name) => {
        try {
          const full = resolvePath(targetPath, name)
          return statSync(full).isDirectory() ? [{ name, path: full }] : []
        } catch {
          return []
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))

    const parent = dirname(targetPath)
    return c.json({
      currentPath: targetPath,
      parentPath: parent === targetPath ? null : parent,
      dirs,
    })
  } catch {
    return c.json({ error: `Cannot read directory: ${targetPath}` }, 400)
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
  
  // Validate git repository (skip in test environment)
  if (process.env.NODE_ENV !== 'test' && !isGitRepo(parsed.data.folderPath)) {
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
