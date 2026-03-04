import { initializeDatabase } from './db/init'
import { startWalCheckpoint } from './db/index'
import { createIndexes } from './db/indexes'
import { hydrateAllTickets } from './machines/persistence'
import { OpenCodeSDKAdapter } from './opencode/adapter'

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

  // TODO: Step 5 — Reconnect OpenCode sessions for in-progress tickets.
  // Requires tracking active session IDs in the DB and calling adapter.listSessions()
  // to match and resubscribe to event streams.

  console.log('[startup] Startup complete')
}
