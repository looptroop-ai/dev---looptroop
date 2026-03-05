import { initializeDatabase } from './db/init'
import { db, startWalCheckpoint } from './db/index'
import { createIndexes } from './db/indexes'
import { hydrateAllTickets } from './machines/persistence'
import { OpenCodeSDKAdapter } from './opencode/adapter'
import { opencodeSessions, tickets } from './db/schema'
import { not, inArray, eq, and } from 'drizzle-orm'
import { TERMINAL_STATES } from './machines/types'

export function startupSequence() {
  console.log('[startup] Step 1: Initialize database')
  initializeDatabase()

  console.log('[startup] Step 1b: Create indexes')
  createIndexes()

  console.log('[startup] Step 2: Start WAL checkpoint timer')
  startWalCheckpoint()

  console.log('[startup] Step 3: OpenCode health check')
  const adapter = new OpenCodeSDKAdapter()
  adapter.checkHealth().then(health => {
    if (health.available) {
      console.log(`[startup] OpenCode is reachable (version: ${health.version ?? 'unknown'})`)
    } else {
      console.warn(`[startup] OpenCode is NOT reachable: ${health.error ?? 'unknown error'}. Start it with \`opencode serve\`.`)
    }
  }).catch(err => {
    console.warn(`[startup] OpenCode health check failed: ${err instanceof Error ? err.message : String(err)}`)
  })

  console.log('[startup] Step 4: Hydrate XState actors from SQLite')
  const hydrated = hydrateAllTickets()
  console.log(`[startup] Hydrated ${hydrated} ticket actors`)

  // Step 5: Reconnect OpenCode sessions for in-progress tickets
  console.log('[startup] Step 5: Reconnecting OpenCode sessions for in-progress tickets')

  const terminalStatuses = [...TERMINAL_STATES] as string[]
  const inProgressTickets = db.select().from(tickets)
    .where(not(inArray(tickets.status, terminalStatuses)))
    .all()

  let reconnected = 0
  if (inProgressTickets.length > 0) {
    adapter.listSessions().then(remoteSessions => {
      const remoteIds = new Set(remoteSessions.map(s => s.id))
      for (const ticket of inProgressTickets) {
        const activeDbSessions = db.select().from(opencodeSessions)
          .where(and(
            eq(opencodeSessions.ticketId, ticket.id),
            eq(opencodeSessions.state, 'active'),
          ))
          .all()
        for (const sess of activeDbSessions) {
          if (remoteIds.has(sess.sessionId)) {
            reconnected++
          } else {
            // Session no longer exists on the OpenCode side — mark abandoned
            db.update(opencodeSessions)
              .set({ state: 'abandoned', updatedAt: new Date().toISOString() })
              .where(eq(opencodeSessions.id, sess.id))
              .run()
          }
        }
      }
      console.log(`[startup] Reconnected ${reconnected} OpenCode sessions, cleaned up stale entries`)
    }).catch((err: unknown) => {
      console.warn(`[startup] OpenCode session reconnection failed: ${err instanceof Error ? err.message : String(err)}`)
    })
  }

  console.log('[startup] Startup complete')
}
