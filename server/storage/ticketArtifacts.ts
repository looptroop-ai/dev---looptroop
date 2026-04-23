import { and, desc, eq } from 'drizzle-orm'
import { phaseArtifacts } from '../db/schema'
import { broadcaster } from '../sse/broadcaster'
import type { ArtifactSnapshot } from '../sse/eventTypes'
import { getTicketContext } from './ticketQueries'
import { resolvePhaseAttempt } from './ticketPhaseAttempts'

type LocalPhaseArtifactRow = typeof phaseArtifacts.$inferSelect

export type PublicPhaseArtifactRow = ArtifactSnapshot

function toPublicPhaseArtifact(ticketRef: string, artifact: LocalPhaseArtifactRow): PublicPhaseArtifactRow {
  return {
    id: artifact.id,
    ticketId: ticketRef,
    phase: artifact.phase,
    phaseAttempt: artifact.phaseAttempt ?? 1,
    artifactType: artifact.artifactType ?? '',
    filePath: null,
    content: artifact.content,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
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

export function listPhaseArtifacts(
  ticketRef: string,
  options?: {
    phase?: string
    phaseAttempt?: number
  },
): PublicPhaseArtifactRow[] {
  const context = getTicketContext(ticketRef)
  if (!context) return []
  const artifacts = context.projectDb
    .select()
    .from(phaseArtifacts)
    .where(eq(phaseArtifacts.ticketId, context.localTicketId))
    .all()
  return artifacts
    .filter((artifact) => {
      if (options?.phase && artifact.phase !== options.phase) return false
      const expectedAttempt = resolvePhaseAttempt(ticketRef, artifact.phase, options?.phase === artifact.phase ? options.phaseAttempt : undefined)
      return artifact.phaseAttempt === expectedAttempt
    })
    .map((artifact) => toPublicPhaseArtifact(ticketRef, artifact))
}

export function getLatestPhaseArtifact(
  ticketRef: string,
  artifactType: string,
  phase?: string,
  phaseAttempt?: number,
): LocalPhaseArtifactRow | undefined {
  const context = getTicketContext(ticketRef)
  if (!context) return undefined
  const conditions = [
    eq(phaseArtifacts.ticketId, context.localTicketId),
    eq(phaseArtifacts.artifactType, artifactType),
  ]
  if (phase) {
    conditions.push(eq(phaseArtifacts.phase, phase))
    conditions.push(eq(phaseArtifacts.phaseAttempt, resolvePhaseAttempt(ticketRef, phase, phaseAttempt)))
  }
  return context.projectDb.select().from(phaseArtifacts).where(and(...conditions)).orderBy(desc(phaseArtifacts.id)).get()
}

export function countPhaseArtifacts(ticketRef: string, artifactType: string, phase?: string, phaseAttempt?: number): number {
  const context = getTicketContext(ticketRef)
  if (!context) return 0

  const conditions = [
    eq(phaseArtifacts.ticketId, context.localTicketId),
    eq(phaseArtifacts.artifactType, artifactType),
  ]
  if (phase) {
    conditions.push(eq(phaseArtifacts.phase, phase))
    conditions.push(eq(phaseArtifacts.phaseAttempt, resolvePhaseAttempt(ticketRef, phase, phaseAttempt)))
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
  const phaseAttempt = resolvePhaseAttempt(ticketRef, artifact.phase, artifact.phaseAttempt)
  const timestamp = new Date().toISOString()
  const inserted = context.projectDb.insert(phaseArtifacts).values({
    ...artifact,
    ticketId: context.localTicketId,
    phaseAttempt,
    updatedAt: artifact.updatedAt ?? timestamp,
  }).returning().get()
  broadcastArtifactChange(ticketRef, artifact.phase, artifact.artifactType ?? '', inserted)
}

export function upsertLatestPhaseArtifact(
  ticketRef: string,
  artifactType: string,
  phase: string,
  content: string,
  phaseAttempt?: number,
): void {
  const context = getTicketContext(ticketRef)
  if (!context) throw new Error(`Ticket not found: ${ticketRef}`)
  const resolvedPhaseAttempt = resolvePhaseAttempt(ticketRef, phase, phaseAttempt)
  const updatedAt = new Date().toISOString()
  const existing = context.projectDb.select().from(phaseArtifacts)
    .where(and(
      eq(phaseArtifacts.ticketId, context.localTicketId),
      eq(phaseArtifacts.artifactType, artifactType),
      eq(phaseArtifacts.phase, phase),
      eq(phaseArtifacts.phaseAttempt, resolvedPhaseAttempt),
    ))
    .orderBy(desc(phaseArtifacts.id))
    .get()
  if (existing) {
    context.projectDb.update(phaseArtifacts)
      .set({ content, updatedAt })
      .where(eq(phaseArtifacts.id, existing.id))
      .run()
    broadcastArtifactChange(ticketRef, phase, artifactType, {
      ...existing,
      content,
      updatedAt,
    })
    return
  }
  const inserted = context.projectDb.insert(phaseArtifacts).values({
    ticketId: context.localTicketId,
    phase,
    phaseAttempt: resolvedPhaseAttempt,
    artifactType,
    content,
    createdAt: updatedAt,
    updatedAt,
  }).returning().get()
  broadcastArtifactChange(ticketRef, phase, artifactType, inserted)
}
