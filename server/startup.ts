import { eq } from 'drizzle-orm'
import { initializeDatabase } from './db/init'
import { startWalCheckpoint } from './db/index'
import { createIndexes } from './db/indexes'
import { hydrateAllTickets } from './machines/persistence'
import { getOpenCodeAdapter } from './opencode/factory'
import { SessionManager } from './opencode/sessionManager'
import { opencodeSessions } from './db/schema'
import { getProjectContextById, listProjects } from './storage/projects'
import { findTicketRefByLocalId, getTicketPaths, listTickets } from './storage/tickets'
import {
  formatStartupStorageSummary,
  getStartupStateDebugLine,
  initializeStartupState,
} from './startupState'
import { fixTrailingLineCorruption, recoverOrphanTmpFiles } from './io/recovery'
import { rebuildTicketRuntimeProjections } from './storage/ticketRuntimeProjection'

function recoverTicketRuntimeArtifacts() {
  let recoveredTmpFiles = 0
  let repairedExecutionLogs = 0

  for (const ticket of listTickets()) {
    const paths = getTicketPaths(ticket.id)
    if (!paths) continue

    recoveredTmpFiles += recoverOrphanTmpFiles(paths.ticketDir).length
    if (fixTrailingLineCorruption(paths.executionLogPath)) {
      repairedExecutionLogs += 1
    }
  }

  const rebuiltProjections = rebuildTicketRuntimeProjections()
  return {
    recoveredTmpFiles,
    repairedExecutionLogs,
    rebuiltProjections,
  }
}

export function startupSequence() {
  console.log('[startup] Step 1: Initialize database')
  initializeDatabase()

  console.log('[startup] Step 1b: Create indexes')
  createIndexes()

  const startupStatus = initializeStartupState()
  console.log(`[startup] ${formatStartupStorageSummary(startupStatus.storage)}`)
  if (process.env.LOOPTROOP_DEV_VERBOSE === '1') {
    console.log(`[startup] ${getStartupStateDebugLine()}`)
  }

  console.log('[startup] Step 2: Recover ticket runtime artifacts')
  const recovery = recoverTicketRuntimeArtifacts()
  console.log(`[startup] Recovered ${recovery.recoveredTmpFiles} orphan temp files, repaired ${recovery.repairedExecutionLogs} execution logs, rebuilt ${recovery.rebuiltProjections} state projections`)

  console.log('[startup] Step 3: Start WAL checkpoint timer')
  startWalCheckpoint()

  console.log('[startup] Step 4: OpenCode health check')
  const adapter = getOpenCodeAdapter()
  adapter.checkHealth().then(health => {
    if (health.available) {
      console.log(`[startup] OpenCode is reachable (version: ${health.version ?? 'unknown'})`)
    } else {
      console.warn(`[startup] OpenCode is NOT reachable: ${health.error ?? 'unknown error'}. Start it with \`opencode serve\`.`)
    }
  }).catch(err => {
    console.warn(`[startup] OpenCode health check failed: ${err instanceof Error ? err.message : String(err)}`)
  })

  console.log('[startup] Step 5: Hydrate XState actors from attached project databases')
  const hydrated = hydrateAllTickets()
  console.log(`[startup] Hydrated ${hydrated} ticket actors`)

  console.log('[startup] Step 6: Reconnecting OpenCode sessions for attached projects')
  const attachedProjects = listProjects()
  if (attachedProjects.length === 0) {
    console.log('[startup] No attached projects to reconnect')
    console.log('[startup] Startup complete')
    return
  }

  adapter.listSessions().then(async () => {
    const sessionManager = new SessionManager(adapter)
    let reconnected = 0
    let abandoned = 0

    for (const project of attachedProjects) {
      const context = getProjectContextById(project.id)
      if (!context) continue
      const activeDbSessions = context.projectDb
        .select()
        .from(opencodeSessions)
        .where(eq(opencodeSessions.state, 'active'))
        .all()

      for (const session of activeDbSessions) {
        const ticketRef = session.ticketId != null ? findTicketRefByLocalId(session.ticketId) : undefined
        const recovered = ticketRef
          ? await sessionManager.validateAndReconnect(ticketRef, session.phase, {
              ...(session.phaseAttempt != null ? { phaseAttempt: session.phaseAttempt } : {}),
              memberId: session.memberId,
              beadId: session.beadId,
              ...(session.iteration != null ? { iteration: session.iteration } : {}),
              step: session.step,
            })
          : null

        if (recovered && recovered.id === session.sessionId) {
          reconnected++
          continue
        }

        context.projectDb.update(opencodeSessions)
          .set({ state: 'abandoned', updatedAt: new Date().toISOString() })
          .where(eq(opencodeSessions.id, session.id))
          .run()
        abandoned++
      }
    }

    console.log(`[startup] Reconnected ${reconnected} OpenCode sessions, cleaned up ${abandoned} stale entries`)
  }).catch((err: unknown) => {
    console.warn(`[startup] OpenCode session reconnection failed: ${err instanceof Error ? err.message : String(err)}`)
  }).finally(() => {
    console.log('[startup] Startup complete')
  })
}
