import { and, desc, eq, isNull } from 'drizzle-orm'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { resolve } from 'path'
import { execFileSync } from 'child_process'
import { getProjectContextById } from './projects'
import { opencodeSessions, phaseArtifacts, projects, ticketErrorOccurrences, ticketStatusHistory, tickets } from '../db/schema'
import { getTicketDir, getTicketWorktreePath } from './paths'
import { safeAtomicWrite } from '../io/atomicWrite'
import { lockTicketModelSelection, resolveTicketBaseBranch } from '../ticket/metadata'
import type {
  PublicTicket,
  TicketErrorOccurrence,
  TicketErrorResolutionStatus,
} from './ticketQueries'
import {
  getTicketContext,
  toPublicTicket,
  parseJsonArray,
  normalizeModelId,
  normalizeModelList,
  arraysEqual,
} from './ticketQueries'

type LocalTicketRow = typeof tickets.$inferSelect

function parseErrorCodes(values: string[] | null | undefined): string {
  return JSON.stringify((values ?? []).filter((value) => typeof value === 'string' && value.trim().length > 0))
}

function hydrateErrorOccurrence(row: {
  id: number
  ticketId: number
  occurrenceNumber: number
  blockedFromStatus: string
  errorMessage: string | null
  errorCodes: string | null
  occurredAt: string
  resolvedAt: string | null
  resolutionStatus: string | null
  resumedToStatus: string | null
}): TicketErrorOccurrence {
  return {
    id: row.id,
    ticketId: row.ticketId,
    occurrenceNumber: row.occurrenceNumber,
    blockedFromStatus: row.blockedFromStatus,
    errorMessage: row.errorMessage,
    errorCodes: parseJsonArray(row.errorCodes),
    occurredAt: row.occurredAt,
    resolvedAt: row.resolvedAt,
    resolutionStatus: row.resolutionStatus as TicketErrorResolutionStatus | null,
    resumedToStatus: row.resumedToStatus,
  }
}

export function recordTicketErrorOccurrence(
  ticketRef: string,
  input: {
    blockedFromStatus: string
    errorMessage: string | null
    errorCodes?: string[] | null
    occurredAt?: string
  },
): TicketErrorOccurrence | undefined {
  const context = getTicketContext(ticketRef)
  if (!context) return undefined

  const latestOccurrence = context.projectDb.select({
    occurrenceNumber: ticketErrorOccurrences.occurrenceNumber,
  })
    .from(ticketErrorOccurrences)
    .where(eq(ticketErrorOccurrences.ticketId, context.localTicketId))
    .orderBy(desc(ticketErrorOccurrences.occurrenceNumber))
    .get()

  const inserted = context.projectDb.insert(ticketErrorOccurrences)
    .values({
      ticketId: context.localTicketId,
      occurrenceNumber: (latestOccurrence?.occurrenceNumber ?? 0) + 1,
      blockedFromStatus: input.blockedFromStatus,
      errorMessage: input.errorMessage,
      errorCodes: parseErrorCodes(input.errorCodes),
      occurredAt: input.occurredAt ?? new Date().toISOString(),
    })
    .returning()
    .get()

  return inserted ? hydrateErrorOccurrence(inserted) : undefined
}

export function resolveLatestTicketErrorOccurrence(
  ticketRef: string,
  input: {
    resolutionStatus: TicketErrorResolutionStatus
    resumedToStatus: string | null
    resolvedAt?: string
  },
): TicketErrorOccurrence | undefined {
  const context = getTicketContext(ticketRef)
  if (!context) return undefined

  const latestOpenOccurrence = context.projectDb.select({
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
    .where(and(
      eq(ticketErrorOccurrences.ticketId, context.localTicketId),
      isNull(ticketErrorOccurrences.resolvedAt),
    ))
    .orderBy(desc(ticketErrorOccurrences.occurrenceNumber))
    .get()

  if (!latestOpenOccurrence) return undefined

  const resolvedAt = input.resolvedAt ?? new Date().toISOString()
  context.projectDb.update(ticketErrorOccurrences)
    .set({
      resolvedAt,
      resolutionStatus: input.resolutionStatus,
      resumedToStatus: input.resumedToStatus,
    })
    .where(eq(ticketErrorOccurrences.id, latestOpenOccurrence.id))
    .run()

  return hydrateErrorOccurrence({
    ...latestOpenOccurrence,
    resolvedAt,
    resolutionStatus: input.resolutionStatus,
    resumedToStatus: input.resumedToStatus,
  })
}

function assertLockedModelConfigurationMutable(
  ticket: LocalTicketRow,
  patch: Partial<Omit<LocalTicketRow, 'id' | 'projectId' | 'externalId' | 'createdAt'>>,
) {
  const updatesLockedModels = 'lockedMainImplementer' in patch
    || 'lockedCouncilMembers' in patch
    || 'lockedMainImplementerVariant' in patch
    || 'lockedCouncilMemberVariants' in patch
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
    lockedMainImplementerVariant?: string | null
    lockedCouncilMembers: string[]
    lockedCouncilMemberVariants?: Record<string, string> | null
    lockedInterviewQuestions: number
    lockedCoverageFollowUpBudgetPercent: number
    lockedMaxCoveragePasses: number
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
      lockedMainImplementerVariant: input.lockedMainImplementerVariant ?? null,
      lockedCouncilMembers: lockedCouncilMembersRaw,
      lockedCouncilMemberVariants: input.lockedCouncilMemberVariants ? JSON.stringify(input.lockedCouncilMemberVariants) : null,
      lockedInterviewQuestions: input.lockedInterviewQuestions,
      lockedCoverageFollowUpBudgetPercent: input.lockedCoverageFollowUpBudgetPercent,
      lockedMaxCoveragePasses: input.lockedMaxCoveragePasses,
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
    tx.delete(ticketErrorOccurrences).where(eq(ticketErrorOccurrences.ticketId, localTicketId)).run()
    tx.delete(ticketStatusHistory).where(eq(ticketStatusHistory.ticketId, localTicketId)).run()
    tx.delete(tickets).where(eq(tickets.id, localTicketId)).run()
  })

  removeTicketFilesystem(projectRoot, externalId, branchName)
  return true
}
