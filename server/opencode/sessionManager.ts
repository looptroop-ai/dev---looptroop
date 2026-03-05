import { db } from '../db/index'
import { opencodeSessions } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import type { OpenCodeAdapter } from './adapter'
import type { Session } from './types'
import { OpenCodeSDKAdapter } from './adapter'

export class SessionManager {
  constructor(private adapter: OpenCodeAdapter) {}

  async createSessionForPhase(
    ticketId: number,
    phase: string,
    phaseAttempt: number,
    memberId?: string,
    beadId?: string,
    iteration?: number,
    projectPath?: string,
  ): Promise<Session> {
    const session = await this.adapter.createSession(projectPath ?? process.cwd())

    db.insert(opencodeSessions)
      .values({
        sessionId: session.id,
        ticketId,
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

  async completeSession(sessionId: string) {
    db.update(opencodeSessions)
      .set({ state: 'completed', updatedAt: new Date().toISOString() })
      .where(eq(opencodeSessions.sessionId, sessionId))
      .run()
  }

  async abandonSession(sessionId: string) {
    db.update(opencodeSessions)
      .set({ state: 'abandoned', updatedAt: new Date().toISOString() })
      .where(eq(opencodeSessions.sessionId, sessionId))
      .run()
  }

  getActiveSession(ticketId: number, phase: string, memberId?: string) {
    const conditions = [
      eq(opencodeSessions.ticketId, ticketId),
      eq(opencodeSessions.phase, phase),
      eq(opencodeSessions.state, 'active'),
    ]
    if (memberId) {
      conditions.push(eq(opencodeSessions.memberId, memberId))
    }
    return db
      .select()
      .from(opencodeSessions)
      .where(and(...conditions))
      .get()
  }

  async validateAndReconnect(ticketId: number, phase: string): Promise<Session | null> {
    const existing = this.getActiveSession(ticketId, phase)
    if (!existing) return null

    // Verify session still exists in OpenCode
    const sessions = await this.adapter.listSessions()
    const found = sessions.find((s) => s.id === existing.sessionId)

    if (!found) {
      // Session lost — abandon and return null
      await this.abandonSession(existing.sessionId)
      return null
    }

    return found
  }
}

const _defaultAdapter = new OpenCodeSDKAdapter()

/**
 * Abort all active OpenCode sessions for a ticket and mark them abandoned in the DB.
 * Used when a ticket is canceled to stop any ongoing AI work.
 */
export async function abortTicketSessions(ticketId: number): Promise<void> {
  const activeSessions = db
    .select()
    .from(opencodeSessions)
    .where(and(eq(opencodeSessions.ticketId, ticketId), eq(opencodeSessions.state, 'active')))
    .all()

  if (activeSessions.length === 0) return

  await Promise.allSettled(
    activeSessions.map(async (session) => {
      try {
        await _defaultAdapter.abortSession(session.sessionId)
      } catch (err) {
        console.warn(`[sessionManager] Failed to abort OpenCode session ${session.sessionId}:`, err)
      } finally {
        db.update(opencodeSessions)
          .set({ state: 'abandoned', updatedAt: new Date().toISOString() })
          .where(eq(opencodeSessions.id, session.id))
          .run()
      }
    }),
  )

  console.log(`[sessionManager] Aborted ${activeSessions.length} active session(s) for ticket ${ticketId}`)
}
