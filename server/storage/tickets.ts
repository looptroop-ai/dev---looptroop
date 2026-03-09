import { execFileSync } from 'child_process'
import { and, desc, eq } from 'drizzle-orm'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { resolve } from 'path'
import { getProjectContextById, getProjectById, listProjects } from './projects'
import { opencodeSessions, phaseArtifacts, projects, ticketStatusHistory, tickets } from '../db/schema'
import { getTicketDir, getTicketExecutionLogPath, getTicketWorktreePath } from './paths'
import { safeAtomicWrite } from '../io/atomicWrite'

type LocalTicketRow = typeof tickets.$inferSelect
type LocalProjectRow = typeof projects.$inferSelect
type LocalPhaseArtifactRow = typeof phaseArtifacts.$inferSelect

export interface PublicTicket extends Omit<LocalTicketRow, 'id'> {
  id: string
  projectId: number
}

export interface TicketContext {
  ticketRef: string
  externalId: string
  projectId: number
  projectRoot: string
  localProject: LocalProjectRow
  localTicket: LocalTicketRow
  localTicketId: number
  projectDb: NonNullable<ReturnType<typeof getProjectContextById>>['projectDb']
}

export function buildTicketRef(projectId: number, externalId: string): string {
  return `${projectId}:${externalId}`
}

export function parseTicketRef(ticketRef: string): { projectId: number; externalId: string } | null {
  const separator = ticketRef.indexOf(':')
  if (separator <= 0) return null
  const projectId = Number(ticketRef.slice(0, separator))
  const externalId = ticketRef.slice(separator + 1)
  if (Number.isNaN(projectId) || !externalId) return null
  return { projectId, externalId }
}

function toPublicTicket(projectId: number, ticket: LocalTicketRow): PublicTicket {
  return {
    ...ticket,
    id: buildTicketRef(projectId, ticket.externalId),
    projectId,
  }
}

function runGit(projectRoot: string, args: string[]) {
  execFileSync('git', ['-C', projectRoot, ...args], { stdio: 'ignore' })
}

function removeTicketFilesystem(projectRoot: string, externalId: string, branchName?: string | null) {
  const worktreePath = getTicketWorktreePath(projectRoot, externalId)
  const resolvedBranchName = branchName?.trim() || externalId

  if (existsSync(worktreePath)) {
    try {
      runGit(projectRoot, ['worktree', 'remove', '--force', worktreePath])
    } catch {
      rmSync(worktreePath, { recursive: true, force: true })
      try {
        runGit(projectRoot, ['worktree', 'prune'])
      } catch {
        // Best-effort cleanup only.
      }
    }
  }

  if (resolvedBranchName !== 'main') {
    try {
      runGit(projectRoot, ['branch', '-D', resolvedBranchName])
    } catch {
      // Ignore missing/already-removed branches.
    }
  }
}

export function listTickets(projectId?: number): PublicTicket[] {
  const projectsToRead = projectId != null
    ? [getProjectContextById(projectId)].filter(Boolean)
    : listProjects().map(project => getProjectContextById(project.id)).filter(Boolean)
  const aggregated: PublicTicket[] = []
  for (const project of projectsToRead) {
    if (!project) continue
    const projectTickets = project.projectDb.select().from(tickets).orderBy(desc(tickets.updatedAt)).all()
    aggregated.push(...projectTickets.map(ticket => toPublicTicket(project.attached.id, ticket)))
  }
  return aggregated.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

export function getTicketByRef(ticketRef: string): PublicTicket | undefined {
  const context = getTicketContext(ticketRef)
  if (!context) return undefined
  return toPublicTicket(context.projectId, context.localTicket)
}

export function findTicketRefByLocalId(localTicketId: number): string | undefined {
  for (const project of listProjects()) {
    const context = getProjectContextById(project.id)
    if (!context) continue
    const localTicket = context.projectDb.select().from(tickets).where(eq(tickets.id, localTicketId)).get()
    if (localTicket) {
      return buildTicketRef(project.id, localTicket.externalId)
    }
  }
  return undefined
}

export function getTicketContext(ticketRef: string): TicketContext | undefined {
  const parsed = parseTicketRef(ticketRef)
  if (!parsed) return undefined
  const project = getProjectContextById(parsed.projectId)
  if (!project) return undefined
  const localTicket = project.projectDb.select().from(tickets).where(eq(tickets.externalId, parsed.externalId)).get()
  if (!localTicket) return undefined
  return {
    ticketRef,
    externalId: parsed.externalId,
    projectId: parsed.projectId,
    projectRoot: project.projectRoot,
    localProject: project.project,
    localTicket,
    localTicketId: localTicket.id,
    projectDb: project.projectDb,
  }
}

export function getTicketStorageContext(ticketRef: string): { projectId: number; projectRoot: string; externalId: string } | undefined {
  const parsed = parseTicketRef(ticketRef)
  if (!parsed) return undefined
  const project = getProjectById(parsed.projectId)
  if (!project) return undefined
  return {
    projectId: parsed.projectId,
    projectRoot: project.folderPath,
    externalId: parsed.externalId,
  }
}

export function createTicket(input: {
  projectId: number
  title: string
  description?: string
  priority?: number
}): PublicTicket {
  const project = getProjectContextById(input.projectId)
  if (!project) throw new Error('Project not found')

  const newCounter = (project.project.ticketCounter ?? 0) + 1
  const externalId = `${project.project.shortname}-${newCounter}`

  project.projectDb.update(projects)
    .set({ ticketCounter: newCounter, updatedAt: new Date().toISOString() })
    .where(eq(projects.id, project.project.id))
    .run()

  const ticket = project.projectDb.insert(tickets)
    .values({
      externalId,
      projectId: project.project.id,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? 3,
      status: 'DRAFT',
    })
    .returning()
    .get()

  const metaDir = resolve(getTicketDir(project.projectRoot, externalId), 'meta')
  mkdirSync(metaDir, { recursive: true })
  safeAtomicWrite(
    resolve(metaDir, 'ticket.meta.json'),
    JSON.stringify({
      externalId,
      title: input.title,
      createdAt: ticket.createdAt,
    }, null, 2),
  )

  return toPublicTicket(input.projectId, ticket)
}

export function updateTicket(ticketRef: string, patch: Partial<Pick<LocalTicketRow, 'title' | 'description' | 'priority'>>): PublicTicket | undefined {
  const context = getTicketContext(ticketRef)
  if (!context) return undefined
  context.projectDb.update(tickets)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(tickets.id, context.localTicketId))
    .run()
  const updated = context.projectDb.select().from(tickets).where(eq(tickets.id, context.localTicketId)).get()
  if (!updated) return undefined
  return toPublicTicket(context.projectId, updated)
}

export function patchTicket(
  ticketRef: string,
  patch: Partial<Omit<LocalTicketRow, 'id' | 'projectId' | 'externalId' | 'createdAt'>>,
): PublicTicket | undefined {
  const context = getTicketContext(ticketRef)
  if (!context) return undefined

  const previousStatus = context.localTicket.status

  context.projectDb.update(tickets)
    .set({
      ...patch,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(tickets.id, context.localTicketId))
    .run()

  const updated = context.projectDb.select().from(tickets).where(eq(tickets.id, context.localTicketId)).get()
  if (!updated) return undefined

  if (patch.status && patch.status !== previousStatus) {
    context.projectDb.insert(ticketStatusHistory)
      .values({
        ticketId: context.localTicketId,
        previousStatus,
        newStatus: patch.status,
        reason: typeof patch.errorMessage === 'string' ? patch.errorMessage : null,
      })
      .run()
  }

  return toPublicTicket(context.projectId, updated)
}

export function deleteTicket(ticketRef: string): boolean {
  const context = getTicketContext(ticketRef)
  if (!context) return false

  const { localTicketId, projectDb, projectRoot, externalId } = context
  const branchName = context.localTicket.branchName

  projectDb.transaction((tx) => {
    tx.delete(phaseArtifacts).where(eq(phaseArtifacts.ticketId, localTicketId)).run()
    tx.delete(opencodeSessions).where(eq(opencodeSessions.ticketId, localTicketId)).run()
    tx.delete(ticketStatusHistory).where(eq(ticketStatusHistory.ticketId, localTicketId)).run()
    tx.delete(tickets).where(eq(tickets.id, localTicketId)).run()
  })

  removeTicketFilesystem(projectRoot, externalId, branchName)
  return true
}

export function listNonTerminalTickets(): PublicTicket[] {
  return listTickets().filter(ticket => !['COMPLETED', 'CANCELED'].includes(ticket.status))
}

export function listPhaseArtifacts(ticketRef: string): LocalPhaseArtifactRow[] {
  const context = getTicketContext(ticketRef)
  if (!context) return []
  return context.projectDb.select().from(phaseArtifacts).where(eq(phaseArtifacts.ticketId, context.localTicketId)).all()
}

export function getLatestPhaseArtifact(ticketRef: string, artifactType: string, phase?: string): LocalPhaseArtifactRow | undefined {
  const context = getTicketContext(ticketRef)
  if (!context) return undefined
  const conditions = [
    eq(phaseArtifacts.ticketId, context.localTicketId),
    eq(phaseArtifacts.artifactType, artifactType),
  ]
  if (phase) {
    conditions.push(eq(phaseArtifacts.phase, phase))
  }
  return context.projectDb.select().from(phaseArtifacts).where(and(...conditions)).orderBy(desc(phaseArtifacts.id)).get()
}

export function insertPhaseArtifact(ticketRef: string, artifact: Omit<typeof phaseArtifacts.$inferInsert, 'ticketId'>): void {
  const context = getTicketContext(ticketRef)
  if (!context) throw new Error(`Ticket not found: ${ticketRef}`)
  context.projectDb.insert(phaseArtifacts).values({
    ...artifact,
    ticketId: context.localTicketId,
  }).run()
}

export function upsertLatestPhaseArtifact(ticketRef: string, artifactType: string, phase: string, content: string): void {
  const context = getTicketContext(ticketRef)
  if (!context) throw new Error(`Ticket not found: ${ticketRef}`)
  const existing = context.projectDb.select().from(phaseArtifacts)
    .where(and(
      eq(phaseArtifacts.ticketId, context.localTicketId),
      eq(phaseArtifacts.artifactType, artifactType),
      eq(phaseArtifacts.phase, phase),
    ))
    .orderBy(desc(phaseArtifacts.id))
    .get()
  if (existing) {
    context.projectDb.update(phaseArtifacts)
      .set({ content })
      .where(eq(phaseArtifacts.id, existing.id))
      .run()
    return
  }
  context.projectDb.insert(phaseArtifacts).values({
    ticketId: context.localTicketId,
    phase,
    artifactType,
    content,
  }).run()
}

export function getTicketPaths(ticketRef: string): {
  worktreePath: string
  ticketDir: string
  executionLogPath: string
} | undefined {
  const storage = getTicketStorageContext(ticketRef)
  if (!storage) return undefined
  return {
    worktreePath: getTicketWorktreePath(storage.projectRoot, storage.externalId),
    ticketDir: getTicketDir(storage.projectRoot, storage.externalId),
    executionLogPath: getTicketExecutionLogPath(storage.projectRoot, storage.externalId),
  }
}
