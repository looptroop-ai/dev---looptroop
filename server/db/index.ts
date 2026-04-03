import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { dirname, isAbsolute, resolve } from 'path'
import { homedir, tmpdir } from 'os'
import { existsSync, mkdirSync } from 'fs'
import { isMainThread, threadId } from 'worker_threads'
import * as schema from './schema'
import { SQLITE_BUSY_TIMEOUT_MS } from '../lib/constants'

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

type AppStorageConfigSource = 'default' | 'LOOPTROOP_CONFIG_DIR' | 'LOOPTROOP_APP_DB_PATH'

interface AppStorageBootFacts {
  configDir: string
  dbPath: string
  source: AppStorageConfigSource
  dbExistedBeforeBoot: boolean
}

function resolveAppStorageBootFacts(): AppStorageBootFacts {
  const configDir = resolveAppConfigDir()
  const configuredDbPath = process.env.LOOPTROOP_APP_DB_PATH?.trim()
  const dbPath = configuredDbPath
    ? (isAbsolute(configuredDbPath) ? configuredDbPath : resolve(process.cwd(), configuredDbPath))
    : resolve(configDir, 'app.sqlite')
  const source: AppStorageConfigSource = configuredDbPath
    ? 'LOOPTROOP_APP_DB_PATH'
    : process.env.LOOPTROOP_CONFIG_DIR?.trim()
      ? 'LOOPTROOP_CONFIG_DIR'
      : 'default'

  return {
    configDir,
    dbPath,
    source,
    dbExistedBeforeBoot: existsSync(dbPath),
  }
}

const APP_STORAGE_BOOT_FACTS = resolveAppStorageBootFacts()
const APP_CONFIG_DIR = APP_STORAGE_BOOT_FACTS.configDir
const DB_PATH = APP_STORAGE_BOOT_FACTS.dbPath

mkdirSync(APP_CONFIG_DIR, { recursive: true })
mkdirSync(dirname(DB_PATH), { recursive: true })

const sqlite = new Database(DB_PATH)
sqlite.pragma('journal_mode=WAL')
sqlite.pragma('locking_mode=NORMAL')
sqlite.pragma('synchronous=NORMAL')
sqlite.pragma(`busy_timeout=${SQLITE_BUSY_TIMEOUT_MS}`)
sqlite.pragma('wal_autocheckpoint=1000')

export const db = drizzle(sqlite, { schema })
export {
  sqlite,
  DB_PATH as APP_DB_PATH,
  APP_CONFIG_DIR,
  APP_STORAGE_BOOT_FACTS,
  type AppStorageBootFacts,
  type AppStorageConfigSource,
}

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
