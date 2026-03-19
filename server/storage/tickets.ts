import { execFileSync } from 'child_process'
import { and, desc, eq } from 'drizzle-orm'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { resolve } from 'path'
import { getProjectContextById, getProjectById, listProjects } from './projects'
import { opencodeSessions, phaseArtifacts, projects, ticketStatusHistory, tickets } from '../db/schema'
import { getTicketDir, getTicketExecutionLogPath, getTicketWorktreePath } from './paths'
import { safeAtomicWrite } from '../io/atomicWrite'
import { readJsonl } from '../io/jsonl'
import { broadcaster } from '../sse/broadcaster'
import type { ArtifactSnapshot } from '../sse/eventTypes'
import { getAvailableWorkflowActions } from '@shared/workflowMeta'
import { getTicketBeadsPath, lockTicketModelSelection, resolveTicketBaseBranch } from '../ticket/metadata'

type LocalTicketRow = typeof tickets.$inferSelect
type LocalProjectRow = typeof projects.$inferSelect
type LocalPhaseArtifactRow = typeof phaseArtifacts.$inferSelect

export interface PublicTicket extends Omit<LocalTicketRow, 'id' | 'lockedCouncilMembers'> {
  id: string
  projectId: number
  lockedCouncilMembers: string[]
  availableActions: string[]
  previousStatus: string | null
  errorSeenSignature: string | null
  runtime: {
    baseBranch: string
    currentBead: number
    completedBeads: number
    totalBeads: number
    percentComplete: number
    iterationCount: number
    maxIterations: number | null
    artifactRoot: string
    beads: Array<{
      id: string
      title: string
      status: string
      iteration: number
    }>
    candidateCommitSha: string | null
    preSquashHead: string | null
    finalTestStatus: 'passed' | 'failed' | 'pending'
  }
}

export type PublicPhaseArtifactRow = ArtifactSnapshot

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

function readErrorSeenSignature(projectContext: NonNullable<ReturnType<typeof getProjectContextById>>, localTicketId: number): string | null {
  const artifact = projectContext.projectDb.select().from(phaseArtifacts)
    .where(and(
      eq(phaseArtifacts.ticketId, localTicketId),
      eq(phaseArtifacts.phase, 'UI_STATE'),
      eq(phaseArtifacts.artifactType, 'ui_state:error_attention'),
    ))
    .orderBy(desc(phaseArtifacts.id))
    .get()

  if (!artifact) return null

  const parsed = parseJsonObject<{ data?: { seenSignature?: unknown } }>(artifact.content)
  return typeof parsed?.data?.seenSignature === 'string' ? parsed.data.seenSignature : null
}

function toPublicTicket(projectId: number, ticket: LocalTicketRow): PublicTicket {
  const project = getProjectById(projectId)
  const projectContext = getProjectContextById(projectId)
  const baseBranch = project ? resolveTicketBaseBranch(project.folderPath, ticket.externalId) : 'unknown'
  const lockedCouncilMembers = parseJsonArray(ticket.lockedCouncilMembers)
  const snapshot = parseJsonObject<{ context?: { previousStatus?: unknown } }>(ticket.xstateSnapshot)
  const errorSeenSignature = projectContext ? readErrorSeenSignature(projectContext, ticket.id) : null
  const runtime = project ? buildRuntime(projectId, project.folderPath, ticket, baseBranch) : {
    baseBranch,
    currentBead: ticket.currentBead ?? 0,
    completedBeads: 0,
    totalBeads: ticket.totalBeads ?? 0,
    percentComplete: Math.round(ticket.percentComplete ?? 0),
    iterationCount: 0,
    maxIterations: null,
    artifactRoot: '',
    beads: [],
    candidateCommitSha: null,
    preSquashHead: null,
    finalTestStatus: 'pending' as const,
  }

  return {
    ...ticket,
    id: buildTicketRef(projectId, ticket.externalId),
    projectId,
    lockedCouncilMembers,
    availableActions: getAvailableWorkflowActions(ticket.status),
    previousStatus: typeof snapshot?.context?.previousStatus === 'string' ? snapshot.context.previousStatus : null,
    errorSeenSignature,
    runtime,
  }
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : []
  } catch {
    return []
  }
}

function normalizeModelId(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed.length > 0 ? trimmed : null
}

function normalizeModelList(values: Array<string | null | undefined>): string[] {
  const unique = new Set<string>()
  const normalized: string[] = []

  for (const value of values) {
    const modelId = normalizeModelId(value)
    if (!modelId || unique.has(modelId)) continue
    unique.add(modelId)
    normalized.push(modelId)
  }

  return normalized
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function assertLockedModelConfigurationMutable(
  ticket: LocalTicketRow,
  patch: Partial<Omit<LocalTicketRow, 'id' | 'projectId' | 'externalId' | 'createdAt'>>,
) {
  const updatesLockedModels = 'lockedMainImplementer' in patch || 'lockedCouncilMembers' in patch
  if (!updatesLockedModels) return

  const currentMainImplementer = normalizeModelId(ticket.lockedMainImplementer)
  const currentCouncilMembers = parseJsonArray(ticket.lockedCouncilMembers)
  if (!currentMainImplementer && currentCouncilMembers.length === 0) return

  const nextMainImplementer = 'lockedMainImplementer' in patch
    ? normalizeModelId(patch.lockedMainImplementer)
    : currentMainImplementer
  const nextCouncilMembers = 'lockedCouncilMembers' in patch
    ? parseJsonArray(patch.lockedCouncilMembers)
    : currentCouncilMembers

  if (currentMainImplementer && currentMainImplementer !== nextMainImplementer) {
    throw new Error(`Ticket model configuration is immutable after start: ${ticket.externalId}`)
  }
  if (currentCouncilMembers.length > 0 && !arraysEqual(currentCouncilMembers, nextCouncilMembers)) {
    throw new Error(`Ticket model configuration is immutable after start: ${ticket.externalId}`)
  }
}

function parseJsonObject<T>(raw: string | null | undefined): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function buildRuntime(
  projectId: number,
  projectRoot: string,
  ticket: LocalTicketRow,
  baseBranch: string,
): PublicTicket['runtime'] {
  const projectContext = getProjectContextById(projectId)
  const snapshot = parseJsonObject<{ context?: { iterationCount?: unknown; maxIterations?: unknown } }>(ticket.xstateSnapshot)
  const iterationCount = typeof snapshot?.context?.iterationCount === 'number' ? snapshot.context.iterationCount : 0
  const maxIterations = typeof snapshot?.context?.maxIterations === 'number'
    ? snapshot.context.maxIterations
    : projectContext?.project.maxIterations ?? null
  const finalTestArtifact = projectContext?.projectDb.select().from(phaseArtifacts)
    .where(and(
      eq(phaseArtifacts.ticketId, ticket.id),
      eq(phaseArtifacts.artifactType, 'final_test_report'),
    ))
    .orderBy(desc(phaseArtifacts.id))
    .get()
  const integrationArtifact = projectContext?.projectDb.select().from(phaseArtifacts)
    .where(and(
      eq(phaseArtifacts.ticketId, ticket.id),
      eq(phaseArtifacts.artifactType, 'integration_report'),
    ))
    .orderBy(desc(phaseArtifacts.id))
    .get()
  const finalTestReport = parseJsonObject<{ status?: 'passed' | 'failed'; passed?: boolean }>(finalTestArtifact?.content)
  const integrationReport = parseJsonObject<{ candidateCommitSha?: string | null; preSquashHead?: string | null }>(integrationArtifact?.content)
  const beads = readRuntimeBeads(projectRoot, ticket.externalId, baseBranch)
  const totalBeads = ticket.totalBeads ?? 0
  const currentBead = ticket.currentBead ?? 0
  const completedBeads = totalBeads === 0
    ? 0
    : currentBead >= totalBeads
      ? totalBeads
      : Math.max(0, currentBead - 1)

  return {
    baseBranch,
    currentBead,
    completedBeads,
    totalBeads,
    percentComplete: Math.round(ticket.percentComplete ?? 0),
    iterationCount,
    maxIterations,
    artifactRoot: getTicketDir(projectRoot, ticket.externalId),
    beads,
    candidateCommitSha: integrationReport?.candidateCommitSha ?? null,
    preSquashHead: integrationReport?.preSquashHead ?? null,
    finalTestStatus: finalTestReport?.status ?? (finalTestReport?.passed ? 'passed' : 'pending'),
  }
}

function readRuntimeBeads(projectRoot: string, externalId: string, baseBranch: string) {
  try {
    return readJsonl<Record<string, unknown>>(getTicketBeadsPath(projectRoot, externalId, baseBranch))
      .map((bead) => ({
        id: typeof bead.id === 'string' ? bead.id : '',
        title: typeof bead.title === 'string' ? bead.title : 'Untitled',
        status: typeof bead.status === 'string' ? bead.status : 'pending',
        iteration: typeof bead.iteration === 'number' ? bead.iteration : 0,
      }))
      .filter((bead) => bead.id.length > 0)
  } catch {
    return []
  }
}

function toPublicPhaseArtifact(ticketRef: string, artifact: LocalPhaseArtifactRow): PublicPhaseArtifactRow {
  return {
    id: artifact.id,
    ticketId: ticketRef,
    phase: artifact.phase,
    artifactType: artifact.artifactType ?? '',
    filePath: null,
    content: artifact.content,
    createdAt: artifact.createdAt,
  }
}

function broadcastArtifactChange(
  ticketRef: string,
  phase: string,
  artifactType: string,
  artifact: LocalPhaseArtifactRow,
) {
  broadcaster.broadcast(ticketRef, 'artifact_change', {
    ticketId: ticketRef,
    phase,
    artifactType,
    artifact: toPublicPhaseArtifact(ticketRef, artifact),
  })
}

function runGit(projectRoot: string, args: string[]) {
  execFileSync('git', ['-C', projectRoot, ...args], { stdio: 'ignore' })
}

function removeTicketFilesystem(projectRoot: string, externalId: string, branchName?: string | null) {
  const worktreePath = getTicketWorktreePath(projectRoot, externalId)
  const baseBranch = resolveTicketBaseBranch(projectRoot, externalId)
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

  if (resolvedBranchName !== baseBranch) {
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
  assertLockedModelConfigurationMutable(context.localTicket, patch)

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

export function lockTicketStartConfiguration(
  ticketRef: string,
  input: {
    branchName: string | null
    startedAt: string
    lockedMainImplementer: string
    lockedCouncilMembers: string[]
    lockedInterviewQuestions: number
    lockedCoverageFollowUpBudgetPercent: number
    lockedMaxCoveragePasses: number
    lockedUserBackground: string | null
    lockedDisableAnalogies: boolean
  },
): PublicTicket | undefined {
  const context = getTicketContext(ticketRef)
  if (!context) return undefined

  const lockedMainImplementer = normalizeModelId(input.lockedMainImplementer)
  const lockedCouncilMembers = normalizeModelList(input.lockedCouncilMembers)

  if (!lockedMainImplementer) {
    throw new Error('Locked main implementer is required.')
  }
  if (lockedCouncilMembers.length === 0) {
    throw new Error('Locked council members are required.')
  }

  const lockedCouncilMembersRaw = JSON.stringify(lockedCouncilMembers)
  assertLockedModelConfigurationMutable(context.localTicket, {
    lockedMainImplementer,
    lockedCouncilMembers: lockedCouncilMembersRaw,
  })

  const meta = lockTicketModelSelection(context.projectRoot, context.externalId, {
    startedAt: input.startedAt,
    lockedMainImplementer,
    lockedCouncilMembers,
  })

  context.projectDb.update(tickets)
    .set({
      branchName: input.branchName,
      lockedMainImplementer,
      lockedCouncilMembers: lockedCouncilMembersRaw,
      lockedInterviewQuestions: input.lockedInterviewQuestions,
      lockedCoverageFollowUpBudgetPercent: input.lockedCoverageFollowUpBudgetPercent,
      lockedMaxCoveragePasses: input.lockedMaxCoveragePasses,
      lockedUserBackground: input.lockedUserBackground,
      lockedDisableAnalogies: input.lockedDisableAnalogies ? 1 : 0,
      startedAt: meta.startedAt ?? input.startedAt,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(tickets.id, context.localTicketId))
    .run()

  const updated = context.projectDb.select().from(tickets).where(eq(tickets.id, context.localTicketId)).get()
  if (!updated) return undefined
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

export function listPhaseArtifacts(ticketRef: string): PublicPhaseArtifactRow[] {
  const context = getTicketContext(ticketRef)
  if (!context) return []
  return context.projectDb
    .select()
    .from(phaseArtifacts)
    .where(eq(phaseArtifacts.ticketId, context.localTicketId))
    .all()
    .map((artifact) => toPublicPhaseArtifact(ticketRef, artifact))
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

export function countPhaseArtifacts(ticketRef: string, artifactType: string, phase?: string): number {
  const context = getTicketContext(ticketRef)
  if (!context) return 0

  const conditions = [
    eq(phaseArtifacts.ticketId, context.localTicketId),
    eq(phaseArtifacts.artifactType, artifactType),
  ]
  if (phase) {
    conditions.push(eq(phaseArtifacts.phase, phase))
  }

  const rows = context.projectDb.select({ id: phaseArtifacts.id })
    .from(phaseArtifacts)
    .where(and(...conditions))
    .all()
  return rows.length
}

export function insertPhaseArtifact(ticketRef: string, artifact: Omit<typeof phaseArtifacts.$inferInsert, 'ticketId'>): void {
  const context = getTicketContext(ticketRef)
  if (!context) throw new Error(`Ticket not found: ${ticketRef}`)
  const inserted = context.projectDb.insert(phaseArtifacts).values({
    ...artifact,
    ticketId: context.localTicketId,
  }).returning().get()
  broadcastArtifactChange(ticketRef, artifact.phase, artifact.artifactType ?? '', inserted)
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
    broadcastArtifactChange(ticketRef, phase, artifactType, {
      ...existing,
      content,
    })
    return
  }
  const inserted = context.projectDb.insert(phaseArtifacts).values({
    ticketId: context.localTicketId,
    phase,
    artifactType,
    content,
  }).returning().get()
  broadcastArtifactChange(ticketRef, phase, artifactType, inserted)
}

export function getTicketPaths(ticketRef: string): {
  worktreePath: string
  ticketDir: string
  executionLogPath: string
  baseBranch: string
  beadsPath: string
} | undefined {
  const storage = getTicketStorageContext(ticketRef)
  if (!storage) return undefined
  const baseBranch = resolveTicketBaseBranch(storage.projectRoot, storage.externalId)
  return {
    worktreePath: getTicketWorktreePath(storage.projectRoot, storage.externalId),
    ticketDir: getTicketDir(storage.projectRoot, storage.externalId),
    executionLogPath: getTicketExecutionLogPath(storage.projectRoot, storage.externalId),
    baseBranch,
    beadsPath: getTicketBeadsPath(storage.projectRoot, storage.externalId, baseBranch),
  }
}
