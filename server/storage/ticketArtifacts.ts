import { and, desc, eq } from 'drizzle-orm'
import { phaseArtifacts } from '../db/schema'
import { broadcaster } from '../sse/broadcaster'
import type { ArtifactSnapshot } from '../sse/eventTypes'
import { getTicketContext } from './ticketQueries'

type LocalPhaseArtifactRow = typeof phaseArtifacts.$inferSelect

export type PublicPhaseArtifactRow = ArtifactSnapshot

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
