import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { resolve, isAbsolute } from 'path'
import { mkdirSync } from 'fs'
import * as schema from './schema'

const isTestRuntime = process.env.NODE_ENV === 'test'
  || process.env.VITEST === 'true'
  || process.env.VITEST === '1'

const defaultDbPath = resolve(
  process.cwd(),
  isTestRuntime ? '.looptroop/test-db.sqlite' : '.looptroop/db.sqlite',
)

const configuredDbPath = process.env.LOOPTROOP_DB_PATH
const DB_PATH = configuredDbPath
  ? (isAbsolute(configuredDbPath) ? configuredDbPath : resolve(process.cwd(), configuredDbPath))
  : defaultDbPath

if (isTestRuntime && DB_PATH === resolve(process.cwd(), '.looptroop/db.sqlite')) {
  throw new Error(
    `[db] Refusing to use primary DB during tests: ${DB_PATH}. ` +
    `Use LOOPTROOP_DB_PATH or allow default test DB.`,
  )
}

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
