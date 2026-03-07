import { createActor } from 'xstate'
import { db } from '../db/index'
import { tickets } from '../db/schema'
import { eq, not, inArray } from 'drizzle-orm'
import { ticketMachine } from './ticketMachine'
import { TERMINAL_STATES } from './types'
import { attachWorkflowRunner } from '../workflow/runner'
import { broadcaster } from '../sse/broadcaster'
import { appendLogEvent } from '../log/executionLog'

// Active actors map
const activeActors = new Map<number, ReturnType<typeof createActor<typeof ticketMachine>>>()

function getStateValue(actor: ReturnType<typeof createActor<typeof ticketMachine>>): string {
  const snapshot = actor.getSnapshot()
  return typeof snapshot.value === 'string' ? snapshot.value : JSON.stringify(snapshot.value)
}

function emitAppSystemLog(
  ticketId: number,
  externalId: string,
  phase: string,
  content: string,
  data?: Record<string, unknown>,
) {
  broadcaster.broadcast(String(ticketId), 'log', {
    ticketId: String(ticketId),
    phase,
    type: 'info',
    content,
    source: 'system',
    ...(data ? { data } : {}),
  })
  appendLogEvent(externalId, 'info', phase, content, data, 'system', phase)
}

function emitAppErrorLog(
  ticketId: number,
  externalId: string,
  phase: string,
  content: string,
  data?: Record<string, unknown>,
) {
  broadcaster.broadcast(String(ticketId), 'log', {
    ticketId: String(ticketId),
    phase,
    type: 'error',
    content,
    source: 'error',
    ...(data ? { data } : {}),
  })
  appendLogEvent(externalId, 'error', phase, content, data, 'error', phase)
}

function attachPersistenceSubscription(
  ticketId: number,
  externalId: string,
  actor: ReturnType<typeof createActor<typeof ticketMachine>>,
) {
  let isFirstEmission = true

  actor.subscribe(() => {
    persistSnapshot(ticketId, actor)

    const currentState = getStateValue(actor)
    if (isFirstEmission) {
      isFirstEmission = false
      emitAppSystemLog(
        ticketId,
        externalId,
        currentState,
        `[APP] Actor active in ${currentState}.`,
        { state: currentState },
      )
    }

    // Remove actor if terminal
    if (actor.getSnapshot().status === 'done') {
      activeActors.delete(ticketId)
    }
  })
}

export function getActor(ticketId: number) {
  return activeActors.get(ticketId)
}

export function getAllActors() {
  return activeActors
}

export function ensureActorForTicket(ticketId: number) {
  const existing = activeActors.get(ticketId)
  if (existing) return existing

  const ticket = db.select().from(tickets).where(eq(tickets.id, ticketId)).get()
  if (!ticket) throw new Error(`Ticket ${ticketId} not found`)
  if (TERMINAL_STATES.includes(ticket.status as (typeof TERMINAL_STATES)[number])) {
    throw new Error(`Ticket ${ticketId} is terminal (${ticket.status})`)
  }

  if (ticket.xstateSnapshot) {
    try {
      const snapshot = JSON.parse(ticket.xstateSnapshot)
      return hydrateTicketActor(ticket.id, snapshot, {
        ticketId: String(ticket.id),
        projectId: ticket.projectId,
        externalId: ticket.externalId,
        title: ticket.title,
        lockedMainImplementer: ticket.lockedMainImplementer ?? null,
        lockedCouncilMembers: ticket.lockedCouncilMembers ? JSON.parse(ticket.lockedCouncilMembers) : null,
      })
    } catch {
      // Fall back to fresh actor creation if snapshot is invalid.
    }
  }

  return createTicketActor(ticket.id, {
    ticketId: String(ticket.id),
    projectId: ticket.projectId,
    externalId: ticket.externalId,
    title: ticket.title,
    lockedMainImplementer: ticket.lockedMainImplementer ?? null,
    lockedCouncilMembers: ticket.lockedCouncilMembers ? JSON.parse(ticket.lockedCouncilMembers) : null,
  })
}

// Save XState snapshot to SQLite
export function persistSnapshot(ticketId: number, actor: ReturnType<typeof createActor<typeof ticketMachine>>) {
  const existing = db.select().from(tickets).where(eq(tickets.id, ticketId)).get()
  const snapshot = actor.getPersistedSnapshot()
  const currentSnapshot = actor.getSnapshot()
  const stateValue = typeof currentSnapshot.value === 'string' ? currentSnapshot.value : JSON.stringify(currentSnapshot.value)
  const previousStatus = existing?.status
  const errorMessage = typeof currentSnapshot.context.error === 'string' && currentSnapshot.context.error.trim().length > 0
    ? currentSnapshot.context.error
    : null

  db.update(tickets)
    .set({
      xstateSnapshot: JSON.stringify(snapshot),
      status: stateValue,
      errorMessage,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(tickets.id, ticketId))
    .run()

  if (existing?.externalId && previousStatus !== stateValue) {
    const payload = {
      ticketId: String(ticketId),
      from: previousStatus ?? 'unknown',
      to: stateValue,
    }
    broadcaster.broadcast(String(ticketId), 'state_change', payload)
    emitAppSystemLog(
      ticketId,
      existing.externalId,
      stateValue,
      `[APP] Status transition: ${payload.from} -> ${payload.to}`,
      payload,
    )

    if (stateValue === 'BLOCKED_ERROR' && errorMessage) {
      emitAppErrorLog(
        ticketId,
        existing.externalId,
        stateValue,
        `[APP] Blocked in ${payload.from}: ${errorMessage}`,
        {
          message: errorMessage,
          blockedFrom: payload.from,
          blockedTo: payload.to,
        },
      )
    }
  }
}

// Create and start a new actor for a ticket
export function createTicketActor(ticketId: number, input: { ticketId: string; projectId: number; externalId: string; title: string; maxIterations?: number; lockedMainImplementer?: string | null; lockedCouncilMembers?: string[] | null }) {
  const actor = createActor(ticketMachine, {
    input: {
      ticketId: input.ticketId,
      projectId: input.projectId,
      externalId: input.externalId,
      title: input.title,
      maxIterations: input.maxIterations ?? 5,
      lockedMainImplementer: input.lockedMainImplementer ?? null,
      lockedCouncilMembers: input.lockedCouncilMembers ?? null,
    },
  })

  // Subscribe to transitions for persistence + guaranteed app SYS logging.
  attachPersistenceSubscription(ticketId, input.externalId, actor)

  actor.start()
  activeActors.set(ticketId, actor)
  attachWorkflowRunner(ticketId, actor, (event) => actor.send(event))
  return actor
}

// Hydrate actor from SQLite snapshot
export function hydrateTicketActor(ticketId: number, snapshot: unknown, input: { ticketId: string; projectId: number; externalId: string; title: string; maxIterations?: number; lockedMainImplementer?: string | null; lockedCouncilMembers?: string[] | null }) {
  const actor = createActor(ticketMachine, {
    snapshot: snapshot as Parameters<typeof createActor<typeof ticketMachine>>[1] extends { snapshot?: infer S } ? S : never,
    input: {
      ticketId: input.ticketId,
      projectId: input.projectId,
      externalId: input.externalId,
      title: input.title,
      maxIterations: input.maxIterations ?? 5,
      lockedMainImplementer: input.lockedMainImplementer ?? null,
      lockedCouncilMembers: input.lockedCouncilMembers ?? null,
    },
  })

  attachPersistenceSubscription(ticketId, input.externalId, actor)

  actor.start()
  activeActors.set(ticketId, actor)
  attachWorkflowRunner(ticketId, actor, (event) => actor.send(event))
  return actor
}

// Hydrate all non-terminal tickets on startup
export function hydrateAllTickets() {
  const terminalStatuses = [...TERMINAL_STATES] as string[]
  const nonTerminalTickets = db.select().from(tickets)
    .where(not(inArray(tickets.status, terminalStatuses)))
    .all()

  let hydrated = 0
  for (const ticket of nonTerminalTickets) {
    if (ticket.xstateSnapshot) {
      try {
        const snapshot = JSON.parse(ticket.xstateSnapshot)
        hydrateTicketActor(ticket.id, snapshot, {
          ticketId: String(ticket.id),
          projectId: ticket.projectId,
          externalId: ticket.externalId,
          title: ticket.title,
          lockedMainImplementer: ticket.lockedMainImplementer ?? null,
          lockedCouncilMembers: ticket.lockedCouncilMembers ? JSON.parse(ticket.lockedCouncilMembers) : null,
        })
        hydrated++
      } catch (err) {
        console.error(`[persistence] Failed to hydrate ticket ${ticket.externalId}:`, err)
      }
    }
  }

  console.log(`[persistence] Hydrated ${hydrated}/${nonTerminalTickets.length} non-terminal tickets`)
  return hydrated
}

// Send event to a ticket's actor
export function sendTicketEvent(ticketId: number, event: Parameters<ReturnType<typeof createActor<typeof ticketMachine>>['send']>[0]) {
  const actor = activeActors.get(ticketId)
  if (!actor) {
    throw new Error(`No active actor for ticket ${ticketId}`)
  }
  actor.send(event)
  return actor.getSnapshot()
}

// Get current state of a ticket's actor
export function getTicketState(ticketId: number) {
  const actor = activeActors.get(ticketId)
  if (!actor) return null
  const snapshot = actor.getSnapshot()
  return {
    state: typeof snapshot.value === 'string' ? snapshot.value : String(snapshot.value),
    context: snapshot.context,
    status: snapshot.status,
  }
}

// Clean up all actors (for shutdown)
export function stopAllActors() {
  for (const [id, actor] of activeActors) {
    try {
      actor.stop()
    } catch { /* ignore stop errors */ }
    activeActors.delete(id)
  }
}
