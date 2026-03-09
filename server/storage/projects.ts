import { eq } from 'drizzle-orm'
import { existsSync } from 'fs'
import { db as appDb } from '../db/index'
import { getProjectDatabase } from '../db/project'
import { attachedProjects, projects, tickets } from '../db/schema'
import {
  ensureProjectStorageDirs,
  getProjectDbPath,
  normalizeFolderPath,
  resolveGitRepoRoot,
} from './paths'

type AttachedProjectRow = typeof attachedProjects.$inferSelect
type LocalProjectRow = typeof projects.$inferSelect
type LocalTicketRow = typeof tickets.$inferSelect

export interface PublicProject extends Omit<LocalProjectRow, 'id'> {
  id: number
}

export interface ProjectContext {
  attached: AttachedProjectRow
  project: LocalProjectRow
  projectRoot: string
  projectDb: ReturnType<typeof getProjectDatabase>['db']
}

export interface ExistingProjectMetadata {
  name: string
  shortname: string
  icon: string | null
  color: string | null
  ticketCounter: number
  ticketCount: number
}

function hydrateProject(attached: AttachedProjectRow, project: LocalProjectRow): PublicProject {
  return {
    ...project,
    id: attached.id,
  }
}

function getAttachedByPath(projectRoot: string): AttachedProjectRow | undefined {
  return appDb.select().from(attachedProjects).where(eq(attachedProjects.folderPath, projectRoot)).get()
}

function getAttachedRow(id: number): AttachedProjectRow | undefined {
  return appDb.select().from(attachedProjects).where(eq(attachedProjects.id, id)).get()
}

function readLocalProject(projectRoot: string): LocalProjectRow | undefined {
  const { db } = getProjectDatabase(projectRoot)
  return db.select().from(projects).limit(1).get()
}

function ensureAttachedProject(projectRoot: string): AttachedProjectRow {
  let attached = getAttachedByPath(projectRoot)
  if (!attached) {
    attached = appDb.insert(attachedProjects)
      .values({ folderPath: projectRoot })
      .returning()
      .get()
  } else {
    appDb.update(attachedProjects)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(attachedProjects.id, attached.id))
      .run()
    attached = getAttachedByPath(projectRoot)
  }

  if (!attached) {
    throw new Error(`Failed to attach project at ${projectRoot}`)
  }

  return attached
}

function ensureLocalProject(projectRoot: string, input?: {
  name: string
  shortname: string
  icon?: string
  color?: string
  profileId?: number
  councilMembers?: string
  maxIterations?: number
  perIterationTimeout?: number
  councilResponseTimeout?: number
  minCouncilQuorum?: number
  interviewQuestions?: number
}): LocalProjectRow {
  const existing = readLocalProject(projectRoot)
  if (existing) return existing
  if (!input) {
    throw new Error(`No LoopTroop project state found in ${projectRoot}`)
  }

  ensureProjectStorageDirs(projectRoot)
  const { db } = getProjectDatabase(projectRoot)
  return db.insert(projects)
    .values({
      name: input.name,
      shortname: input.shortname,
      icon: input.icon ?? '📁',
      color: input.color ?? '#3b82f6',
      folderPath: projectRoot,
      profileId: input.profileId ?? null,
      councilMembers: input.councilMembers ?? null,
      maxIterations: input.maxIterations ?? null,
      perIterationTimeout: input.perIterationTimeout ?? null,
      councilResponseTimeout: input.councilResponseTimeout ?? null,
      minCouncilQuorum: input.minCouncilQuorum ?? null,
      interviewQuestions: input.interviewQuestions ?? null,
    })
    .returning()
    .get()
}

export function hasLoopTroopState(projectRoot: string): boolean {
  const repoRoot = resolveGitRepoRoot(projectRoot)
  if (!repoRoot) return false
  return existsSync(getProjectDbPath(repoRoot)) && !!readLocalProject(repoRoot)
}

export function attachProject(input: {
  folderPath: string
  name: string
  shortname: string
  icon?: string
  color?: string
  profileId?: number
  councilMembers?: string
  maxIterations?: number
  perIterationTimeout?: number
  councilResponseTimeout?: number
  minCouncilQuorum?: number
  interviewQuestions?: number
}): PublicProject {
  const projectRoot = resolveGitRepoRoot(input.folderPath)
  if (!projectRoot) {
    throw new Error(`Folder is not a git repository: ${input.folderPath}`)
  }

  const localProject = ensureLocalProject(projectRoot, input)
  const attached = ensureAttachedProject(projectRoot)

  return hydrateProject(attached, localProject)
}

export function attachExistingProject(input: {
  folderPath: string
  name?: string
  icon?: string
  color?: string
} | string): PublicProject {
  const projectRootOrFolder = typeof input === 'string' ? input : input.folderPath
  const projectRoot = resolveGitRepoRoot(projectRootOrFolder)
  if (!projectRoot) {
    throw new Error(`Folder is not a git repository: ${projectRootOrFolder}`)
  }

  const localProject = ensureLocalProject(projectRoot)
  const patch = typeof input === 'string'
    ? null
    : {
        name: input.name ?? localProject.name,
        icon: input.icon ?? localProject.icon,
        color: input.color ?? localProject.color,
      }

  let effectiveProject = localProject
  if (patch && (
    patch.name !== localProject.name
    || patch.icon !== localProject.icon
    || patch.color !== localProject.color
  )) {
    const { db } = getProjectDatabase(projectRoot)
    db.update(projects)
      .set({
        name: patch.name,
        icon: patch.icon,
        color: patch.color,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(projects.id, localProject.id))
      .run()
    effectiveProject = db.select().from(projects).where(eq(projects.id, localProject.id)).get() ?? localProject
  }

  const attached = ensureAttachedProject(projectRoot)
  return hydrateProject(attached, effectiveProject)
}

export function listProjects(): PublicProject[] {
  const attachedRows = appDb.select().from(attachedProjects).all()
  const aggregated: PublicProject[] = []
  for (const attached of attachedRows) {
    const localProject = readLocalProject(attached.folderPath)
    if (!localProject) continue
    aggregated.push(hydrateProject(attached, localProject))
  }
  return aggregated.sort((a, b) => a.name.localeCompare(b.name))
}

export function getProjectById(id: number): PublicProject | undefined {
  const attached = getAttachedRow(id)
  if (!attached) return undefined
  const localProject = readLocalProject(attached.folderPath)
  if (!localProject) return undefined
  return hydrateProject(attached, localProject)
}

export function getProjectContextById(id: number): ProjectContext | undefined {
  const attached = getAttachedRow(id)
  if (!attached) return undefined
  const projectRoot = attached.folderPath
  const { db } = getProjectDatabase(projectRoot)
  const project = db.select().from(projects).limit(1).get()
  if (!project) return undefined
  return { attached, projectRoot, projectDb: db, project }
}

export function updateProject(id: number, patch: Partial<Pick<LocalProjectRow, 'name' | 'icon' | 'color' | 'councilMembers' | 'maxIterations' | 'perIterationTimeout' | 'councilResponseTimeout' | 'minCouncilQuorum' | 'interviewQuestions'>>): PublicProject | undefined {
  const context = getProjectContextById(id)
  if (!context) return undefined
  context.projectDb.update(projects)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(projects.id, context.project.id))
    .run()
  const updated = context.projectDb.select().from(projects).where(eq(projects.id, context.project.id)).get()
  if (!updated) return undefined
  appDb.update(attachedProjects)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(attachedProjects.id, id))
    .run()
  return hydrateProject(context.attached, updated)
}

export function detachProject(id: number): boolean {
  const attached = getAttachedRow(id)
  if (!attached) return false
  appDb.delete(attachedProjects).where(eq(attachedProjects.id, id)).run()
  return true
}

export function listProjectTickets(id: number): LocalTicketRow[] {
  const context = getProjectContextById(id)
  if (!context) return []
  return context.projectDb.select().from(tickets).all()
}

export function getProjectRootById(id: number): string | undefined {
  return getAttachedRow(id)?.folderPath
}

export function getExistingProjectMetadata(projectRootOrFolder: string): ExistingProjectMetadata | null {
  const projectRoot = resolveGitRepoRoot(projectRootOrFolder)
  if (!projectRoot) return null

  const { db } = getProjectDatabase(projectRoot)
  const project = db.select().from(projects).limit(1).get()
  if (!project) return null

  const ticketCount = db.select().from(tickets).all().length
  return {
    name: project.name,
    shortname: project.shortname,
    icon: project.icon ?? null,
    color: project.color ?? null,
    ticketCounter: project.ticketCounter ?? 0,
    ticketCount,
  }
}

export function resolveProjectState(projectRootOrFolder: string): { projectRoot: string; exists: boolean; existingProject: ExistingProjectMetadata | null } {
  const projectRoot = resolveGitRepoRoot(projectRootOrFolder)
  if (!projectRoot) {
    return { projectRoot: normalizeFolderPath(projectRootOrFolder), exists: false, existingProject: null }
  }

  const existingProject = getExistingProjectMetadata(projectRoot)
  return { projectRoot, exists: existingProject !== null, existingProject }
}
