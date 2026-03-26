import { Hono } from 'hono'
import { z } from 'zod'
import { existsSync, readdirSync, statSync } from 'fs'
import { dirname, resolve as resolvePath } from 'path'
import { homedir } from 'os'
import {
  attachExistingProject,
  attachProject,
  deleteProject,
  type ExistingProjectMetadata,
  getProjectById,
  getProjectRootById,
  listProjectTickets,
  listProjects,
  resolveProjectState,
  updateProject,
} from '../storage/projects'
import { isGitRepo, normalizeFolderPath, resolveGitRepoRoot } from '../storage/paths'

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

interface GitRepoInfo {
  isGit: boolean
  repoRoot?: string
  isRepoRoot?: boolean
  hasLoopTroopState?: boolean
  existingProject?: ExistingProjectMetadata | null
}

function getGitRepoInfo(folderPath: string): GitRepoInfo {
  const resolved = normalizeFolderPath(folderPath)
  if (!existsSync(resolved)) {
    console.warn(`[getGitRepoInfo] Path does not exist: ${resolved} (original: ${folderPath})`)
    return { isGit: false }
  }

  const repoRoot = resolveGitRepoRoot(resolved)
  if (!repoRoot) return { isGit: false }

  const state = resolveProjectState(repoRoot)
  return {
    isGit: true,
    repoRoot,
    isRepoRoot: repoRoot === resolved,
    hasLoopTroopState: state.exists,
    existingProject: state.existingProject,
  }
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
    return c.json({
      isGit: true,
      status: 'valid',
      scope: gitInfo.isRepoRoot ? 'root' : 'subfolder',
      repoRoot: gitInfo.repoRoot,
      hasLoopTroopState: gitInfo.hasLoopTroopState ?? false,
      existingProject: gitInfo.existingProject ?? null,
      message: gitInfo.isRepoRoot
        ? (gitInfo.hasLoopTroopState ? 'Existing LoopTroop project found at repository root' : 'Git repository root selected')
        : `Subfolder inside Git repository (root: ${gitInfo.repoRoot})`,
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
  return c.json(listProjects())
})

projectRouter.get('/projects/:id', (c) => {
  const id = Number(c.req.param('id'))
  if (Number.isNaN(id)) return c.json({ error: 'Invalid project ID' }, 400)
  const project = getProjectById(id)
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

  if (process.env.NODE_ENV !== 'test' && !isGitRepo(parsed.data.folderPath)) {
    return c.json({
      error: 'Folder is not a git repository',
      details: `No git repository found at: ${parsed.data.folderPath}. Please initialize the repository with 'git init' first.`,
    }, 400)
  }

  const projectState = resolveProjectState(parsed.data.folderPath)
  try {
    const result = projectState.exists
      ? attachExistingProject(parsed.data)
      : attachProject(parsed.data)
    return c.json(result, 201)
  } catch (err) {
    return c.json({ error: 'Failed to attach project', details: String(err) }, 500)
  }
})

projectRouter.patch('/projects/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (Number.isNaN(id)) return c.json({ error: 'Invalid project ID' }, 400)
  const body = await c.req.json()
  const parsed = updateProjectSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.flatten() }, 400)
  }

  const result = updateProject(id, parsed.data)
  if (!result) return c.json({ error: 'Project not found' }, 404)
  return c.json(result)
})

projectRouter.delete('/projects/:id', (c) => {
  const id = Number(c.req.param('id'))
  if (Number.isNaN(id)) return c.json({ error: 'Invalid project ID' }, 400)
  const projectRoot = getProjectRootById(id)
  if (!projectRoot) return c.json({ error: 'Project not found' }, 404)

  const projectTickets = listProjectTickets(id)
  const allowedStatuses = ['DRAFT', 'COMPLETED', 'CANCELED']
  const hasInProgress = projectTickets.some(ticket => !allowedStatuses.includes(ticket.status))
  if (hasInProgress) {
    return c.json({ error: 'Cannot delete project. Some tickets are still in progress. Move all tickets to Done or cancel them first.' }, 409)
  }

  try {
    deleteProject(id)
    return c.json({ success: true, projectRoot })
  } catch (err) {
    return c.json({ error: 'Failed to delete project', details: String(err) }, 500)
  }
})

export { projectRouter }
