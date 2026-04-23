import {
  ensureInstallIfNeeded,
  getMissingBins,
  readDailyMaintenanceState,
  recordDailyMaintenanceSuccess,
  syncDirectDependencies,
  writeDailyMaintenanceState,
} from './dev-maintenance'

const verbose = process.env.LOOPTROOP_DEV_VERBOSE === '1'
const install = ensureInstallIfNeeded({ verbose })
if (install.errors.length > 0) {
  for (const error of install.errors) {
    console.error(`[deps:sync] ${error}`)
  }
  process.exit(1)
}

const report = syncDirectDependencies({ verbose, skip: process.env.LOOPTROOP_DEV_SKIP_DEPS === '1' })
if (report.skipped) {
  console.log('[deps:sync] Skipped direct dependency sync because LOOPTROOP_DEV_SKIP_DEPS=1.')
  process.exit(0)
}

if (report.errors.length > 0) {
  for (const error of report.errors) {
    console.error(`[deps:sync] ${error}`)
  }
  process.exit(1)
}

if (report.alreadyCurrent) {
  console.log('[deps:sync] All direct dependencies are already on the latest stable releases.')
} else {
  console.log(
    `[deps:sync] Updated ${report.updatedDependencies.length} runtime and ` +
    `${report.updatedDevDependencies.length} dev dependencies to latest stable.`,
  )
}

const missingBins = getMissingBins()
if (missingBins.length > 0) {
  console.error(`[deps:sync] Missing local dev binaries after sync: ${missingBins.join(', ')}`)
  process.exit(1)
}

const maintenanceState = readDailyMaintenanceState()
recordDailyMaintenanceSuccess(maintenanceState, 'dependencySync')
writeDailyMaintenanceState(maintenanceState)
