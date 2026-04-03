import { eq } from 'drizzle-orm'
import { APP_STORAGE_BOOT_FACTS, db as appDb } from './db/index'
import { appMeta, profiles } from './db/schema'
import { listProjects } from './storage/projects'

export type StartupStorageKind = 'fresh' | 'empty_existing' | 'restored'

export interface StartupStorageStatus {
  kind: StartupStorageKind
  dbPath: string
  configDir: string
  source: typeof APP_STORAGE_BOOT_FACTS.source
  profileRestored: boolean
  restoredProjectCount: number
  restoredProjects: Array<{
    name: string
    shortname: string
    folderPath: string
  }>
}

export interface StartupStorageDebugStatus extends StartupStorageStatus {
  restoredProjectRoots: string[]
}

export interface StartupStatus {
  storage: StartupStorageStatus
  ui: {
    restoreNotice: {
      shouldShow: boolean
      dismissedAt: string | null
    }
  }
}

interface StartupClassificationInput {
  dbExistedBeforeBoot: boolean
  profileRestored: boolean
  restoredProjectCount: number
}

const RESTORE_NOTICE_DISMISSED_AT_KEY = 'startup.restore_notice.dismissed_at'

let storageSnapshot: StartupStorageDebugStatus | null = null
let restoreNoticeDismissedAt: string | null = null

export function classifyStartupStorageKind(input: StartupClassificationInput): StartupStorageKind {
  if (!input.dbExistedBeforeBoot) return 'fresh'
  if (input.profileRestored || input.restoredProjectCount > 0) return 'restored'
  return 'empty_existing'
}

export function formatStartupStorageSummary(storage: StartupStorageStatus): string {
  if (storage.kind === 'fresh') {
    return `State: created new local data store at ${storage.dbPath}`
  }

  if (storage.kind === 'empty_existing') {
    return `State: using existing local data store at ${storage.dbPath} with no saved profile or projects`
  }

  return (
    `State: restored existing local data from ${storage.dbPath}` +
    ` (profile=${storage.profileRestored ? 'yes' : 'no'}, projects=${storage.restoredProjectCount})`
  )
}

export function formatStartupStorageVerbose(
  storage: StartupStorageDebugStatus,
  dismissedAt: string | null,
): string {
  const restoredProjects = storage.restoredProjectRoots.length > 0
    ? storage.restoredProjectRoots.join(', ')
    : '(none)'

  return (
    `State detail: configDir=${storage.configDir}` +
    ` source=${storage.source}` +
    ` restoredProjects=${restoredProjects}` +
    ` restoreNoticeDismissed=${dismissedAt ? `yes@${dismissedAt}` : 'no'}`
  )
}

function readRestoreNoticeDismissedAt() {
  const record = appDb.select().from(appMeta).where(eq(appMeta.key, RESTORE_NOTICE_DISMISSED_AT_KEY)).get()
  return record?.value ?? null
}

function writeRestoreNoticeDismissedAt(timestamp: string) {
  const existing = appDb.select().from(appMeta).where(eq(appMeta.key, RESTORE_NOTICE_DISMISSED_AT_KEY)).get()

  if (existing) {
    appDb.update(appMeta)
      .set({
        value: timestamp,
        updatedAt: timestamp,
      })
      .where(eq(appMeta.key, RESTORE_NOTICE_DISMISSED_AT_KEY))
      .run()
    return
  }

  appDb.insert(appMeta)
    .values({
      key: RESTORE_NOTICE_DISMISSED_AT_KEY,
      value: timestamp,
      updatedAt: timestamp,
    })
    .run()
}

function buildStorageSnapshot(): StartupStorageDebugStatus {
  const restoredProjects = listProjects()
  const profileRestored = Boolean(appDb.select().from(profiles).limit(1).get())

  return {
    kind: classifyStartupStorageKind({
      dbExistedBeforeBoot: APP_STORAGE_BOOT_FACTS.dbExistedBeforeBoot,
      profileRestored,
      restoredProjectCount: restoredProjects.length,
    }),
    dbPath: APP_STORAGE_BOOT_FACTS.dbPath,
    configDir: APP_STORAGE_BOOT_FACTS.configDir,
    source: APP_STORAGE_BOOT_FACTS.source,
    profileRestored,
    restoredProjectCount: restoredProjects.length,
    restoredProjects: restoredProjects.map((project) => ({
      name: project.name,
      shortname: project.shortname,
      folderPath: project.folderPath,
    })),
    restoredProjectRoots: restoredProjects.map((project) => project.folderPath),
  }
}

function ensureInitialized() {
  if (storageSnapshot) return
  storageSnapshot = buildStorageSnapshot()
  restoreNoticeDismissedAt = readRestoreNoticeDismissedAt()
}

function toPublicStartupStatus(storage: StartupStorageDebugStatus, dismissedAt: string | null): StartupStatus {
  return {
    storage: {
      kind: storage.kind,
      dbPath: storage.dbPath,
      configDir: storage.configDir,
      source: storage.source,
      profileRestored: storage.profileRestored,
      restoredProjectCount: storage.restoredProjectCount,
      restoredProjects: storage.restoredProjects,
    },
    ui: {
      restoreNotice: {
        shouldShow: storage.kind === 'restored' && !dismissedAt,
        dismissedAt,
      },
    },
  }
}

export function initializeStartupState() {
  ensureInitialized()
  return getStartupStatus()
}

export function getStartupStatus(): StartupStatus {
  ensureInitialized()
  return toPublicStartupStatus(storageSnapshot!, restoreNoticeDismissedAt)
}

export function getStartupStateDebugLine() {
  ensureInitialized()
  return formatStartupStorageVerbose(storageSnapshot!, restoreNoticeDismissedAt)
}

export function dismissStartupRestoreNotice(timestamp = new Date().toISOString()) {
  ensureInitialized()

  if (!restoreNoticeDismissedAt) {
    writeRestoreNoticeDismissedAt(timestamp)
    restoreNoticeDismissedAt = timestamp
  }

  return {
    success: true as const,
    dismissedAt: restoreNoticeDismissedAt,
  }
}

export function resetStartupStateForTests() {
  storageSnapshot = null
  restoreNoticeDismissedAt = null
}
