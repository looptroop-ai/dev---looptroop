import { initializeDatabase } from './db/init'
import { startWalCheckpoint } from './db/index'
import { createIndexes } from './db/indexes'
import { hydrateAllTickets } from './machines/persistence'

export function startupSequence() {
  console.log('[startup] Step 1: Initialize database')
  initializeDatabase()

  console.log('[startup] Step 1b: Create indexes')
  createIndexes()

  console.log('[startup] Step 2: Start WAL checkpoint timer')
  startWalCheckpoint()

  console.log('[startup] Step 3: OpenCode health check (skipped - not yet implemented)')

  console.log('[startup] Step 4: Hydrate XState actors from SQLite')
  const hydrated = hydrateAllTickets()
  console.log(`[startup] Hydrated ${hydrated} ticket actors`)

  console.log('[startup] Step 5: Reconnect OpenCode sessions (skipped - not yet implemented)')

  console.log('[startup] Startup complete')
}
