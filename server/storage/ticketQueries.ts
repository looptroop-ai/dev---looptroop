import { and, desc, eq } from 'drizzle-orm'
import { getProjectContextById, getProjectById, listProjects } from './projects'
import { phaseArtifacts, projects, tickets } from '../db/schema'
import { getTicketDir, getTicketExecutionLogPath, getTicketWorktreePath } from './paths'
import { readJsonl } from '../io/jsonl'
import { getAvailableWorkflowActions } from '@shared/workflowMeta'
import { getTicketBeadsPath, resolveTicketBaseBranch } from '../ticket/metadata'
import type { ArtifactSnapshot } from '../sse/eventTypes'

type LocalTicketRow = typeof tickets.$inferSelect
type LocalProjectRow = typeof projects.$inferSelect

export interface PublicTicket extends Omit<LocalTicketRow, 'id' | 'lockedCouncilMembers' | 'lockedCouncilMemberVariants'> {
  id: string
  projectId: number
  lockedCouncilMembers: string[]
  lockedCouncilMemberVariants: Record<string, string> | null
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

export function parseJsonArray(raw: string | null | undefined): string[] {
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

export function normalizeModelId(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeModelList(values: Array<string | null | undefined>): string[] {
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

export function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function parseJsonObject<T>(raw: string | null | undefined): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
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

export function toPublicTicket(projectId: number, ticket: LocalTicketRow): PublicTicket {
  const project = getProjectById(projectId)
  const projectContext = getProjectContextById(projectId)
  const baseBranch = project ? resolveTicketBaseBranch(project.folderPath, ticket.externalId) : 'unknown'
  const lockedCouncilMembers = parseJsonArray(ticket.lockedCouncilMembers)
  const lockedCouncilMemberVariants = ticket.lockedCouncilMemberVariants
    ? parseJsonObject<Record<string, string>>(ticket.lockedCouncilMemberVariants)
    : null
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
    lockedCouncilMemberVariants,
    availableActions: getAvailableWorkflowActions(ticket.status),
    previousStatus: typeof snapshot?.context?.previousStatus === 'string' ? snapshot.context.previousStatus : null,
    errorSeenSignature,
    runtime,
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

export function listNonTerminalTickets(): PublicTicket[] {
  return listTickets().filter(ticket => !['COMPLETED', 'CANCELED'].includes(ticket.status))
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
