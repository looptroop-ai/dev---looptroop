import { createActor } from 'xstate'
import { db } from '../db/index'
import { tickets } from '../db/schema'
import { eq, not, inArray } from 'drizzle-orm'
import { ticketMachine } from './ticketMachine'
import { TERMINAL_STATES } from './types'
import { attachWorkflowRunner } from '../workflow/runner'

// Active actors map
const activeActors = new Map<number, ReturnType<typeof createActor<typeof ticketMachine>>>()

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
  const snapshot = actor.getPersistedSnapshot()
  const currentSnapshot = actor.getSnapshot()
  const stateValue = typeof currentSnapshot.value === 'string' ? currentSnapshot.value : JSON.stringify(currentSnapshot.value)

  db.update(tickets)
    .set({
      xstateSnapshot: JSON.stringify(snapshot),
      status: stateValue,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(tickets.id, ticketId))
    .run()
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

  // Subscribe to transitions to auto-persist
  actor.subscribe(() => {
    persistSnapshot(ticketId, actor)

    // Remove actor if terminal
    if (actor.getSnapshot().status === 'done') {
      activeActors.delete(ticketId)
    }
  })

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

  actor.subscribe(() => {
    persistSnapshot(ticketId, actor)
    if (actor.getSnapshot().status === 'done') {
      activeActors.delete(ticketId)
    }
  })

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
