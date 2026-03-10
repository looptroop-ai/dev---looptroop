import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { isAbsolute, resolve } from 'path'
import { homedir, tmpdir } from 'os'
import { mkdirSync } from 'fs'
import { isMainThread, threadId } from 'worker_threads'
import * as schema from './schema'

const isTestRuntime = process.env.NODE_ENV === 'test'
  || process.env.VITEST === 'true'
  || process.env.VITEST === '1'

function resolveAppConfigDir(): string {
  const configured = process.env.LOOPTROOP_CONFIG_DIR?.trim()
  if (configured) {
    return isAbsolute(configured) ? configured : resolve(process.cwd(), configured)
  }

  if (isTestRuntime) {
    const workerSuffix = `${process.pid}-${isMainThread ? 'main' : `thread-${threadId}`}`
    return resolve(tmpdir(), 'looptroop-vitest', workerSuffix)
  }

  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim()
  const baseDir = xdgConfigHome
    ? (isAbsolute(xdgConfigHome) ? xdgConfigHome : resolve(process.cwd(), xdgConfigHome))
    : resolve(homedir(), '.config')
  return resolve(baseDir, 'looptroop')
}

const APP_CONFIG_DIR = resolveAppConfigDir()
const defaultDbPath = resolve(APP_CONFIG_DIR, 'app.sqlite')
const configuredDbPath = process.env.LOOPTROOP_APP_DB_PATH?.trim()
const DB_PATH = configuredDbPath
  ? (isAbsolute(configuredDbPath) ? configuredDbPath : resolve(process.cwd(), configuredDbPath))
  : defaultDbPath

mkdirSync(APP_CONFIG_DIR, { recursive: true })

const sqlite = new Database(DB_PATH)
sqlite.pragma('journal_mode=WAL')
sqlite.pragma('locking_mode=NORMAL')
sqlite.pragma('synchronous=NORMAL')
sqlite.pragma('busy_timeout=5000')
sqlite.pragma('wal_autocheckpoint=1000')

export const db = drizzle(sqlite, { schema })
export { sqlite, DB_PATH as APP_DB_PATH, APP_CONFIG_DIR }

let checkpointInterval: ReturnType<typeof setInterval> | null = null

export function startWalCheckpoint() {
  checkpointInterval = setInterval(() => {
    try {
      sqlite.pragma('wal_checkpoint(PASSIVE)')
    } catch {
      // Ignore checkpoint errors.
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
