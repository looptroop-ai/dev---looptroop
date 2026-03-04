import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { resolve } from 'path'
import { mkdirSync } from 'fs'
import * as schema from './schema'

const DB_PATH = resolve(process.cwd(), '.looptroop/db.sqlite')

// Ensure directory exists
mkdirSync(resolve(process.cwd(), '.looptroop'), { recursive: true })

const sqlite = new Database(DB_PATH)

// WAL hardening pragmas (applied on every connection)
sqlite.pragma('journal_mode=WAL')
sqlite.pragma('locking_mode=NORMAL')
sqlite.pragma('synchronous=NORMAL')
sqlite.pragma('busy_timeout=5000')
sqlite.pragma('wal_autocheckpoint=1000')

export const db = drizzle(sqlite, { schema })
export { sqlite }

// Idle WAL checkpoint every 30s
let checkpointInterval: ReturnType<typeof setInterval> | null = null

export function startWalCheckpoint() {
  checkpointInterval = setInterval(() => {
    try {
      sqlite.pragma('wal_checkpoint(PASSIVE)')
    } catch {
      // Silently handle checkpoint errors
    }
  }, 30000)
}

export function stopWalCheckpoint() {
  if (checkpointInterval) {
    clearInterval(checkpointInterval)
    checkpointInterval = null
  }
}

export function closeDatabase() {
  stopWalCheckpoint()
  sqlite.close()
}
