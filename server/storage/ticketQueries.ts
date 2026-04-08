import { and, asc, desc, eq } from 'drizzle-orm'
import { db as appDb } from '../db/index'
import { PROFILE_DEFAULTS } from '../db/defaults'
import { getProjectContextById, getProjectById, listProjects } from './projects'
import { phaseArtifacts, profiles, projects, ticketErrorOccurrences, tickets } from '../db/schema'
import { getTicketDir, getTicketExecutionLogPath, getTicketWorktreePath } from './paths'
import { readJsonl } from '../io/jsonl'
import { getAvailableWorkflowActions } from '@shared/workflowMeta'
import { getTicketBeadsPath, resolveTicketBaseBranch } from '../ticket/metadata'
import type { ArtifactSnapshot } from '../sse/eventTypes'
import { EXECUTION_BAND_STATUSES } from '../workflow/executionBand'

type LocalTicketRow = typeof tickets.$inferSelect
type LocalProjectRow = typeof projects.$inferSelect

export type TicketErrorResolutionStatus = 'RETRIED' | 'CANCELED'

export interface TicketErrorOccurrence {
  id: number
  ticketId: number
  occurrenceNumber: number
  blockedFromStatus: string
  errorMessage: string | null
  errorCodes: string[]
  occurredAt: string
  resolvedAt: string | null
  resolutionStatus: TicketErrorResolutionStatus | null
  resumedToStatus: string | null
}

export interface PublicTicket extends Omit<LocalTicketRow, 'id' | 'lockedCouncilMembers' | 'lockedCouncilMemberVariants'> {
  id: string
  projectId: number
  lockedCouncilMembers: string[]
  lockedCouncilMemberVariants: Record<string, string> | null
  availableActions: string[]
  previousStatus: string | null
  reviewCutoffStatus: string | null
  errorOccurrences: TicketErrorOccurrence[]
  activeErrorOccurrenceId: number | null
  hasPastErrors: boolean
  errorSeenSignature: string | null
  runtime: {
    baseBranch: string
    currentBead: number
    completedBeads: number
    totalBeads: number
    percentComplete: number
    iterationCount: number
    maxIterations: number | null
    maxIterationsPerBead: number | null
    activeBeadId: string | null
    activeBeadIteration: number | null
    lastFailedBeadId: string | null
    artifactRoot: string
    beads: Array<{
      id: string
      title: string
      status: string
      iteration: number
      notes?: string
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

function parseTicketErrorCodes(raw: string | null | undefined): string[] {
  if (!raw) return []
  const parsed = parseJsonObject<unknown>(raw)
  return Array.isArray(parsed)
    ? parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []
}

function readTicketErrorOccurrences(
  projectContext: NonNullable<ReturnType<typeof getProjectContextById>> | null | undefined,
  localTicketId: number,
): TicketErrorOccurrence[] {
  if (!projectContext) return []

  const rows = projectContext.projectDb.select({
    id: ticketErrorOccurrences.id,
    ticketId: ticketErrorOccurrences.ticketId,
    occurrenceNumber: ticketErrorOccurrences.occurrenceNumber,
    blockedFromStatus: ticketErrorOccurrences.blockedFromStatus,
    errorMessage: ticketErrorOccurrences.errorMessage,
    errorCodes: ticketErrorOccurrences.errorCodes,
    occurredAt: ticketErrorOccurrences.occurredAt,
    resolvedAt: ticketErrorOccurrences.resolvedAt,
    resolutionStatus: ticketErrorOccurrences.resolutionStatus,
    resumedToStatus: ticketErrorOccurrences.resumedToStatus,
  })
    .from(ticketErrorOccurrences)
    .where(eq(ticketErrorOccurrences.ticketId, localTicketId))
    .orderBy(asc(ticketErrorOccurrences.occurrenceNumber))
    .all()

  return rows.map((row) => ({
    id: row.id,
    ticketId: row.ticketId,
    occurrenceNumber: row.occurrenceNumber,
    blockedFromStatus: row.blockedFromStatus,
    errorMessage: row.errorMessage,
    errorCodes: parseTicketErrorCodes(row.errorCodes),
    occurredAt: row.occurredAt,
    resolvedAt: row.resolvedAt,
    resolutionStatus: row.resolutionStatus as TicketErrorResolutionStatus | null,
    resumedToStatus: row.resumedToStatus,
  }))
}

function readActiveErrorOccurrenceId(errorOccurrences: TicketErrorOccurrence[]): number | null {
  for (let index = errorOccurrences.length - 1; index >= 0; index -= 1) {
    const occurrence = errorOccurrences[index]
    if (!occurrence) continue
    if (!occurrence.resolvedAt) return occurrence.id
  }
  return null
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

export function resolveReviewCutoffStatus(
  ticketStatus: string,
  previousStatus: string | null,
  latestBlockedErrorPreviousStatus: string | null = null,
): string | null {
  if (ticketStatus === 'BLOCKED_ERROR') {
    return previousStatus
  }

  if (ticketStatus !== 'CANCELED') {
    return null
  }

  if (previousStatus !== 'BLOCKED_ERROR') {
    return previousStatus
  }

  return latestBlockedErrorPreviousStatus ?? null
}

function readReviewCutoffStatus(
  ticket: LocalTicketRow,
  previousStatus: string | null,
  errorOccurrences: TicketErrorOccurrence[],
): string | null {
  const latestBlockedErrorPreviousStatus = previousStatus === 'BLOCKED_ERROR'
    ? errorOccurrences.at(-1)?.blockedFromStatus ?? null
    : null

  return resolveReviewCutoffStatus(ticket.status, previousStatus, latestBlockedErrorPreviousStatus)
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
  const errorOccurrences = readTicketErrorOccurrences(projectContext, ticket.id)
  const activeErrorOccurrenceId = readActiveErrorOccurrenceId(errorOccurrences)
  const previousStatusFromSnapshot = typeof snapshot?.context?.previousStatus === 'string' ? snapshot.context.previousStatus : null
  const previousStatus = previousStatusFromSnapshot
    ?? (ticket.status === 'BLOCKED_ERROR' ? errorOccurrences.at(-1)?.blockedFromStatus ?? null : null)
  const reviewCutoffStatus = readReviewCutoffStatus(ticket, previousStatus, errorOccurrences)
  const errorSeenSignature = projectContext ? readErrorSeenSignature(projectContext, ticket.id) : null
  const runtime = project ? buildRuntime(projectId, project.folderPath, ticket, baseBranch, previousStatus) : {
    baseBranch,
    currentBead: ticket.currentBead ?? 0,
    completedBeads: 0,
    totalBeads: ticket.totalBeads ?? 0,
    percentComplete: Math.round(ticket.percentComplete ?? 0),
    iterationCount: 0,
    maxIterations: null,
    maxIterationsPerBead: null,
    activeBeadId: null,
    activeBeadIteration: null,
    lastFailedBeadId: null,
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
    previousStatus,
    reviewCutoffStatus,
    errorOccurrences,
    activeErrorOccurrenceId,
    hasPastErrors: errorOccurrences.some((occurrence) => occurrence.resolvedAt !== null),
    errorSeenSignature,
    runtime,
  }
}

function buildRuntime(
  projectId: number,
  projectRoot: string,
  ticket: LocalTicketRow,
  baseBranch: string,
  previousStatus: string | null,
): PublicTicket['runtime'] {
  const projectContext = getProjectContextById(projectId)
  const profile = appDb.select().from(profiles).get()
  const snapshot = parseJsonObject<{ context?: { iterationCount?: unknown; maxIterations?: unknown } }>(ticket.xstateSnapshot)
  const iterationCount = typeof snapshot?.context?.iterationCount === 'number' ? snapshot.context.iterationCount : 0
  const maxIterations = typeof snapshot?.context?.maxIterations === 'number'
    ? snapshot.context.maxIterations
    : projectContext?.project.maxIterations
      ?? profile?.maxIterations
      ?? PROFILE_DEFAULTS.maxIterations
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
  const inProgressBead = beads.find((bead) => bead.status === 'in_progress') ?? null
  const lastFailedBead = [...beads]
    .filter((bead) => bead.status === 'error')
    .sort((left, right) => {
      const leftUpdatedAt = Date.parse(left.updatedAt ?? '')
      const rightUpdatedAt = Date.parse(right.updatedAt ?? '')

      if (!Number.isNaN(leftUpdatedAt) || !Number.isNaN(rightUpdatedAt)) {
        if (Number.isNaN(leftUpdatedAt)) return 1
        if (Number.isNaN(rightUpdatedAt)) return -1
        return rightUpdatedAt - leftUpdatedAt
      }

      return right.iteration - left.iteration
    })[0] ?? null
  const blockedFromCoding = ticket.status === 'BLOCKED_ERROR' && previousStatus === 'CODING'
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
    maxIterationsPerBead: maxIterations,
    activeBeadId: inProgressBead?.id ?? (blockedFromCoding ? lastFailedBead?.id ?? null : null),
    activeBeadIteration: inProgressBead?.iteration ?? (blockedFromCoding ? lastFailedBead?.iteration ?? null : null),
    lastFailedBeadId: blockedFromCoding ? lastFailedBead?.id ?? null : null,
    artifactRoot: getTicketDir(projectRoot, ticket.externalId),
    beads: beads.map((bead) => ({
      id: bead.id,
      title: bead.title,
      status: bead.status,
      iteration: bead.iteration,
      notes: bead.notes,
    })),
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
        notes: typeof bead.notes === 'string' ? bead.notes : '',
        updatedAt: typeof bead.updatedAt === 'string' ? bead.updatedAt : null,
      }))
      .filter((bead) => bead.id.length > 0)
  } catch {
    return []
  }
}

export interface ExecutionBandConflict {
  ticketId: string
  externalId: string
  title: string
  status: string
}

export function findProjectExecutionBandConflict(
  projectId: number,
  excludeTicketRef?: string,
): ExecutionBandConflict | null {
  const project = getProjectContextById(projectId)
  if (!project) return null

  const excludedExternalId = excludeTicketRef ? parseTicketRef(excludeTicketRef)?.externalId ?? null : null
  const executionBandStatusSet = new Set<string>(EXECUTION_BAND_STATUSES)

  const conflict = project.projectDb.select({
    externalId: tickets.externalId,
    title: tickets.title,
    status: tickets.status,
  })
    .from(tickets)
    .orderBy(desc(tickets.updatedAt))
    .all()
    .find((candidate) => candidate.externalId !== excludedExternalId && executionBandStatusSet.has(candidate.status))

  return conflict
    ? {
        ticketId: buildTicketRef(projectId, conflict.externalId),
        externalId: conflict.externalId,
        title: conflict.title,
        status: conflict.status,
      }
    : null
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
