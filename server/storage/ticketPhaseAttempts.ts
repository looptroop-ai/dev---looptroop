import { desc, eq } from 'drizzle-orm'
import { ticketPhaseAttempts } from '../db/schema'
import { getTicketContext } from './ticketQueries'

const ATTEMPT_TRACKED_PHASES = new Set([
  'SCANNING_RELEVANT_FILES',
  'COUNCIL_DELIBERATING',
  'COUNCIL_VOTING_INTERVIEW',
  'COMPILING_INTERVIEW',
  'WAITING_INTERVIEW_ANSWERS',
  'VERIFYING_INTERVIEW_COVERAGE',
  'WAITING_INTERVIEW_APPROVAL',
  'DRAFTING_PRD',
  'COUNCIL_VOTING_PRD',
  'REFINING_PRD',
  'VERIFYING_PRD_COVERAGE',
  'WAITING_PRD_APPROVAL',
  'DRAFTING_BEADS',
  'COUNCIL_VOTING_BEADS',
  'REFINING_BEADS',
  'VERIFYING_BEADS_COVERAGE',
  'EXPANDING_BEADS',
  'WAITING_BEADS_APPROVAL',
])

export const INTERVIEW_EDIT_RESTART_PHASES = [
  'WAITING_INTERVIEW_APPROVAL',
  'DRAFTING_PRD',
  'COUNCIL_VOTING_PRD',
  'REFINING_PRD',
  'VERIFYING_PRD_COVERAGE',
  'WAITING_PRD_APPROVAL',
  'DRAFTING_BEADS',
  'COUNCIL_VOTING_BEADS',
  'REFINING_BEADS',
  'VERIFYING_BEADS_COVERAGE',
  'EXPANDING_BEADS',
  'WAITING_BEADS_APPROVAL',
] as const

export const PRD_EDIT_RESTART_PHASES = [
  'WAITING_PRD_APPROVAL',
  'DRAFTING_BEADS',
  'COUNCIL_VOTING_BEADS',
  'REFINING_BEADS',
  'VERIFYING_BEADS_COVERAGE',
  'EXPANDING_BEADS',
  'WAITING_BEADS_APPROVAL',
] as const

type LocalTicketPhaseAttemptRow = typeof ticketPhaseAttempts.$inferSelect

export interface PublicTicketPhaseAttemptRow {
  ticketId: string
  phase: string
  attemptNumber: number
  state: string
  archivedReason: string | null
  createdAt: string
  archivedAt: string | null
}

function toPublicAttempt(ticketRef: string, row: LocalTicketPhaseAttemptRow): PublicTicketPhaseAttemptRow {
  return {
    ticketId: ticketRef,
    phase: row.phase,
    attemptNumber: row.attemptNumber,
    state: row.state,
    archivedReason: row.archivedReason,
    createdAt: row.createdAt,
    archivedAt: row.archivedAt,
  }
}

function listAttemptRows(ticketRef: string, phase: string): LocalTicketPhaseAttemptRow[] {
  const context = getTicketContext(ticketRef)
  if (!context) return []
  return context.projectDb
    .select()
    .from(ticketPhaseAttempts)
    .where(eq(ticketPhaseAttempts.ticketId, context.localTicketId))
    .all()
    .filter((row) => row.phase === phase)
    .sort((left, right) => right.attemptNumber - left.attemptNumber)
}

function nextAttemptNumber(rows: LocalTicketPhaseAttemptRow[]): number {
  return (rows[0]?.attemptNumber ?? 0) + 1
}

export function isAttemptTrackedPhase(phase: string): boolean {
  return ATTEMPT_TRACKED_PHASES.has(phase)
}

export function getActivePhaseAttempt(ticketRef: string, phase: string): number | null {
  if (!isAttemptTrackedPhase(phase)) return 1
  const rows = listAttemptRows(ticketRef, phase)
  const active = rows.find((row) => row.state === 'active')
  return active?.attemptNumber ?? null
}

export function resolvePhaseAttempt(ticketRef: string, phase: string, phaseAttempt?: number | null): number {
  if (typeof phaseAttempt === 'number' && Number.isFinite(phaseAttempt) && phaseAttempt > 0) {
    return phaseAttempt
  }
  return getActivePhaseAttempt(ticketRef, phase) ?? 1
}

export function ensureActivePhaseAttempt(ticketRef: string, phase: string): number {
  if (!isAttemptTrackedPhase(phase)) return 1

  const context = getTicketContext(ticketRef)
  if (!context) throw new Error(`Ticket not found: ${ticketRef}`)

  const rows = listAttemptRows(ticketRef, phase)
  const active = rows.find((row) => row.state === 'active')
  if (active) return active.attemptNumber

  const inserted = context.projectDb.insert(ticketPhaseAttempts)
    .values({
      ticketId: context.localTicketId,
      phase,
      attemptNumber: nextAttemptNumber(rows),
      state: 'active',
    })
    .returning()
    .get()

  return inserted.attemptNumber
}

export function listPhaseAttempts(ticketRef: string, phase: string): PublicTicketPhaseAttemptRow[] {
  if (!isAttemptTrackedPhase(phase)) {
    return [{
      ticketId: ticketRef,
      phase,
      attemptNumber: 1,
      state: 'active',
      archivedReason: null,
      createdAt: new Date(0).toISOString(),
      archivedAt: null,
    }]
  }

  const rows = listAttemptRows(ticketRef, phase)
  if (rows.length === 0) {
    return [{
      ticketId: ticketRef,
      phase,
      attemptNumber: 1,
      state: 'active',
      archivedReason: null,
      createdAt: new Date(0).toISOString(),
      archivedAt: null,
    }]
  }
  return rows.map((row) => toPublicAttempt(ticketRef, row))
}

export function archiveActivePhaseAttempts(
  ticketRef: string,
  phases: readonly string[],
  archivedReason: string,
): PublicTicketPhaseAttemptRow[] {
  const context = getTicketContext(ticketRef)
  if (!context) throw new Error(`Ticket not found: ${ticketRef}`)

  const archivedAt = new Date().toISOString()
  const archived: PublicTicketPhaseAttemptRow[] = []

  for (const phase of phases) {
    if (!isAttemptTrackedPhase(phase)) continue

    const active = context.projectDb
      .select()
      .from(ticketPhaseAttempts)
      .where(eq(ticketPhaseAttempts.ticketId, context.localTicketId))
      .orderBy(desc(ticketPhaseAttempts.attemptNumber))
      .all()
      .find((row) => row.phase === phase && row.state === 'active')

    if (!active) continue

    context.projectDb.update(ticketPhaseAttempts)
      .set({
        state: 'archived',
        archivedReason,
        archivedAt,
      })
      .where(eq(ticketPhaseAttempts.id, active.id))
      .run()

    archived.push(toPublicAttempt(ticketRef, {
      ...active,
      state: 'archived',
      archivedReason,
      archivedAt,
    }))
  }

  return archived
}

export function createFreshPhaseAttempts(
  ticketRef: string,
  phases: readonly string[],
): PublicTicketPhaseAttemptRow[] {
  const context = getTicketContext(ticketRef)
  if (!context) throw new Error(`Ticket not found: ${ticketRef}`)

  const created: PublicTicketPhaseAttemptRow[] = []

  for (const phase of phases) {
    if (!isAttemptTrackedPhase(phase)) continue

    const rows = listAttemptRows(ticketRef, phase)
    const active = rows.find((row) => row.state === 'active')
    if (active) {
      created.push(toPublicAttempt(ticketRef, active))
      continue
    }

    const inserted = context.projectDb.insert(ticketPhaseAttempts)
      .values({
        ticketId: context.localTicketId,
        phase,
        attemptNumber: nextAttemptNumber(rows),
        state: 'active',
      })
      .returning()
      .get()

    created.push(toPublicAttempt(ticketRef, inserted))
  }

  return created
}
