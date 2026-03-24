import { and, eq, isNull } from 'drizzle-orm'
import { opencodeSessions } from '../db/schema'
import type { OpenCodeAdapter } from './adapter'
import type { Session } from './types'
import { getOpenCodeAdapter } from './factory'
import { getProjectContextById, listProjects } from '../storage/projects'
import { getTicketByRef, getTicketContext } from '../storage/tickets'

export interface SessionOwnership {
  ticketId?: string
  phaseAttempt?: number
  memberId?: string | null
  beadId?: string | null
  iteration?: number | null
}

function findSessionRecord(sessionId: string) {
  for (const project of listProjects()) {
    const context = getProjectContextById(project.id)
    if (!context) continue
    const record = context.projectDb.select().from(opencodeSessions)
      .where(eq(opencodeSessions.sessionId, sessionId))
      .get()
    if (record) {
      return { projectDb: context.projectDb, record }
    }
  }
  return null
}

export class SessionManager {
  constructor(private adapter: OpenCodeAdapter) {}

  async createSessionForPhase(
    ticketId: string,
    phase: string,
    phaseAttempt: number,
    memberId?: string,
    beadId?: string,
    iteration?: number,
    projectPath?: string,
  ): Promise<Session> {
    const context = getTicketContext(ticketId)
    if (!context) throw new Error(`Ticket not found: ${ticketId}`)

    const session = await this.adapter.createSession(projectPath ?? context.projectRoot)

    context.projectDb.insert(opencodeSessions)
      .values({
        sessionId: session.id,
        ticketId: context.localTicketId,
        phase,
        phaseAttempt,
        memberId: memberId ?? null,
        beadId: beadId ?? null,
        iteration: iteration ?? null,
        state: 'active',
      })
      .run()

    return session
  }

  createSessionForOwnership(
    ticketId: string,
    phase: string,
    ownership: SessionOwnership,
    projectPath?: string,
  ): Promise<Session> {
    return this.createSessionForPhase(
      ticketId,
      phase,
      ownership.phaseAttempt ?? 1,
      ownership.memberId ?? undefined,
      ownership.beadId ?? undefined,
      ownership.iteration ?? undefined,
      projectPath,
    )
  }

  async completeSession(sessionId: string) {
    const found = findSessionRecord(sessionId)
    if (!found) return
    found.projectDb.update(opencodeSessions)
      .set({ state: 'completed', updatedAt: new Date().toISOString() })
      .where(eq(opencodeSessions.sessionId, sessionId))
      .run()
  }

  async abandonSession(sessionId: string) {
    const found = findSessionRecord(sessionId)
    if (!found) return
    found.projectDb.update(opencodeSessions)
      .set({ state: 'abandoned', updatedAt: new Date().toISOString() })
      .where(eq(opencodeSessions.sessionId, sessionId))
      .run()
  }

  getActiveSession(ticketId: string, phase: string, memberId?: string) {
    const context = getTicketContext(ticketId)
    if (!context) return undefined
    const conditions = [
      eq(opencodeSessions.ticketId, context.localTicketId),
      eq(opencodeSessions.phase, phase),
      eq(opencodeSessions.state, 'active'),
    ]
    if (memberId) {
      conditions.push(eq(opencodeSessions.memberId, memberId))
    }
    return context.projectDb
      .select()
      .from(opencodeSessions)
      .where(and(...conditions))
      .get()
  }

  getOwnedActiveSession(ticketId: string, phase: string, ownership: SessionOwnership) {
    const context = getTicketContext(ticketId)
    if (!context) return undefined
    const conditions = [
      eq(opencodeSessions.ticketId, context.localTicketId),
      eq(opencodeSessions.phase, phase),
      eq(opencodeSessions.phaseAttempt, ownership.phaseAttempt ?? 1),
      eq(opencodeSessions.state, 'active'),
    ]
    if (ownership.memberId == null) {
      conditions.push(isNull(opencodeSessions.memberId))
    } else {
      conditions.push(eq(opencodeSessions.memberId, ownership.memberId))
    }
    if (ownership.beadId == null) {
      conditions.push(isNull(opencodeSessions.beadId))
    } else {
      conditions.push(eq(opencodeSessions.beadId, ownership.beadId))
    }
    if (ownership.iteration === undefined || ownership.iteration === null) {
      conditions.push(isNull(opencodeSessions.iteration))
    } else {
      conditions.push(eq(opencodeSessions.iteration, ownership.iteration))
    }
    return context.projectDb
      .select()
      .from(opencodeSessions)
      .where(and(...conditions))
      .get()
  }

  async validateAndReconnect(ticketId: string, phase: string, ownership?: SessionOwnership): Promise<Session | null> {
    const ticket = getTicketByRef(ticketId)
    if (!ticket || ticket.status !== phase) {
      return null
    }

    const existing = ownership
      ? this.getOwnedActiveSession(ticketId, phase, ownership)
      : this.getActiveSession(ticketId, phase)
    if (!existing) return null

    let sessions: Session[]
    try {
      sessions = await this.adapter.listSessions()
    } catch {
      // Transient failure listing sessions — return null so the caller
      // creates a fresh session, but do NOT abandon the DB record.
      return null
    }
    const found = sessions.find((s) => s.id === existing.sessionId)

    if (!found) {
      await this.abandonSession(existing.sessionId)
      return null
    }

    return found
  }
}

export async function abortTicketSessions(ticketId: string): Promise<void> {
  const context = getTicketContext(ticketId)
  if (!context) return

  const activeSessions = context.projectDb
    .select()
    .from(opencodeSessions)
    .where(and(eq(opencodeSessions.ticketId, context.localTicketId), eq(opencodeSessions.state, 'active')))
    .all()

  if (activeSessions.length === 0) return

  const adapter = getOpenCodeAdapter()

  await Promise.allSettled(
    activeSessions.map(async (session: typeof opencodeSessions.$inferSelect) => {
      try {
        await adapter.abortSession(session.sessionId)
      } catch (err) {
        console.warn(`[sessionManager] Failed to abort OpenCode session ${session.sessionId}:`, err)
      } finally {
        context.projectDb.update(opencodeSessions)
          .set({ state: 'abandoned', updatedAt: new Date().toISOString() })
          .where(eq(opencodeSessions.id, session.id))
          .run()
      }
    }),
  )

  console.log(`[sessionManager] Aborted ${activeSessions.length} active session(s) for ticket ${ticketId}`)
}
