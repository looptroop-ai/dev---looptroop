import { createActor } from 'xstate'
import { ticketMachine } from './ticketMachine'
import { TERMINAL_STATES } from './types'
import { PROFILE_DEFAULTS } from '../db/defaults'
import { attachWorkflowRunner } from '../workflow/runner'
import { broadcaster } from '../sse/broadcaster'
import { appendLogEvent } from '../log/executionLog'
import {
  findTicketRefByLocalId,
  getTicketContext,
  listNonTerminalTickets,
  patchTicket,
} from '../storage/tickets'

const activeActors = new Map<string, ReturnType<typeof createActor<typeof ticketMachine>>>()

function resolveTicketRef(ticketRef: string | number): string {
  if (typeof ticketRef === 'string' && ticketRef.includes(':')) return ticketRef
  const numericId = typeof ticketRef === 'number' ? ticketRef : Number(ticketRef)
  if (!Number.isNaN(numericId)) {
    const resolved = findTicketRefByLocalId(numericId)
    if (resolved) return resolved
  }
  return String(ticketRef)
}

function getStateValue(actor: ReturnType<typeof createActor<typeof ticketMachine>>): string {
  const snapshot = actor.getSnapshot()
  return typeof snapshot.value === 'string' ? snapshot.value : JSON.stringify(snapshot.value)
}

function emitAppSystemLog(
  ticketRef: string,
  phase: string,
  content: string,
  data?: Record<string, unknown>,
) {
  broadcaster.broadcast(ticketRef, 'log', {
    ticketId: ticketRef,
    phase,
    type: 'info',
    content,
    source: 'system',
    ...(data ? { data } : {}),
  })
  appendLogEvent(ticketRef, 'info', phase, content, data, 'system', phase)
}

function emitAppErrorLog(
  ticketRef: string,
  phase: string,
  content: string,
  data?: Record<string, unknown>,
) {
  broadcaster.broadcast(ticketRef, 'log', {
    ticketId: ticketRef,
    phase,
    type: 'error',
    content,
    source: 'error',
    ...(data ? { data } : {}),
  })
  appendLogEvent(ticketRef, 'error', phase, content, data, 'error', phase)
}

function attachPersistenceSubscription(
  ticketRef: string,
  actor: ReturnType<typeof createActor<typeof ticketMachine>>,
) {
  let isFirstEmission = true

  actor.subscribe(() => {
    persistSnapshot(ticketRef, actor)

    const currentState = getStateValue(actor)
    if (isFirstEmission) {
      isFirstEmission = false
      emitAppSystemLog(
        ticketRef,
        currentState,
        `[APP] Actor active in ${currentState}.`,
        { state: currentState },
      )
    }

    if (actor.getSnapshot().status === 'done') {
      activeActors.delete(ticketRef)
    }
  })
}

export function getActor(ticketRef: string | number) {
  return activeActors.get(resolveTicketRef(ticketRef))
}

export function getAllActors() {
  return activeActors as Map<string | number, ReturnType<typeof createActor<typeof ticketMachine>>>
}

export function ensureActorForTicket(ticketRef: string | number) {
  const resolvedTicketRef = resolveTicketRef(ticketRef)
  const existing = activeActors.get(resolvedTicketRef)
  if (existing) return existing

  const ticket = getTicketContext(resolvedTicketRef)
  if (!ticket) throw new Error(`Ticket ${resolvedTicketRef} not found`)
  if (TERMINAL_STATES.includes(ticket.localTicket.status as (typeof TERMINAL_STATES)[number])) {
    throw new Error(`Ticket ${resolvedTicketRef} is terminal (${ticket.localTicket.status})`)
  }

  const input = {
    ticketId: resolvedTicketRef,
    projectId: ticket.projectId,
    externalId: ticket.externalId,
    title: ticket.localTicket.title,
    lockedMainImplementer: ticket.localTicket.lockedMainImplementer ?? null,
    lockedCouncilMembers: ticket.localTicket.lockedCouncilMembers ? JSON.parse(ticket.localTicket.lockedCouncilMembers) as string[] : null,
  }

  if (ticket.localTicket.xstateSnapshot) {
    try {
      const snapshot = JSON.parse(ticket.localTicket.xstateSnapshot)
      return hydrateTicketActor(resolvedTicketRef, snapshot, input)
    } catch {
      // Fall back to fresh actor creation if snapshot is invalid.
    }
  }

  return createTicketActor(resolvedTicketRef, input)
}

export function persistSnapshot(
  ticketRef: string | number,
  actor: ReturnType<typeof createActor<typeof ticketMachine>>,
) {
  const resolvedTicketRef = resolveTicketRef(ticketRef)
  const existing = getTicketContext(resolvedTicketRef)
  if (!existing) return

  const snapshot = actor.getPersistedSnapshot()
  const currentSnapshot = actor.getSnapshot()
  const stateValue = typeof currentSnapshot.value === 'string' ? currentSnapshot.value : JSON.stringify(currentSnapshot.value)
  const previousStatus = existing.localTicket.status
  const errorMessage = typeof currentSnapshot.context.error === 'string' && currentSnapshot.context.error.trim().length > 0
    ? currentSnapshot.context.error
    : null

  patchTicket(resolvedTicketRef, {
    xstateSnapshot: JSON.stringify(snapshot),
    status: stateValue,
    errorMessage,
  })

  if (previousStatus !== stateValue) {
    const payload = {
      ticketId: ticketRef,
      from: previousStatus ?? 'unknown',
      to: stateValue,
    }
    broadcaster.broadcast(resolvedTicketRef, 'state_change', payload)
    emitAppSystemLog(
      resolvedTicketRef,
      stateValue,
      `[APP] Status transition: ${payload.from} -> ${payload.to}`,
      payload,
    )

    if (stateValue === 'BLOCKED_ERROR' && errorMessage) {
      emitAppErrorLog(
        resolvedTicketRef,
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

export function createTicketActor(
  ticketRef: string | number,
  input: {
    ticketId: string
    projectId: number
    externalId: string
    title: string
    maxIterations?: number
    lockedMainImplementer?: string | null
    lockedCouncilMembers?: string[] | null
  },
) {
  const resolvedTicketRef = resolveTicketRef(ticketRef)
  const actor = createActor(ticketMachine, {
    input: {
      ticketId: input.ticketId,
      projectId: input.projectId,
      externalId: input.externalId,
      title: input.title,
      maxIterations: input.maxIterations ?? PROFILE_DEFAULTS.maxIterations,
      lockedMainImplementer: input.lockedMainImplementer ?? null,
      lockedCouncilMembers: input.lockedCouncilMembers ?? null,
    },
  })

  attachPersistenceSubscription(resolvedTicketRef, actor)

  actor.start()
  activeActors.set(resolvedTicketRef, actor)
  attachWorkflowRunner(resolvedTicketRef, actor, (event) => actor.send(event))
  return actor
}

export function hydrateTicketActor(
  ticketRef: string | number,
  snapshot: unknown,
  input: {
    ticketId: string
    projectId: number
    externalId: string
    title: string
    maxIterations?: number
    lockedMainImplementer?: string | null
    lockedCouncilMembers?: string[] | null
  },
) {
  const resolvedTicketRef = resolveTicketRef(ticketRef)
  const actor = createActor(ticketMachine, {
    snapshot: snapshot as Parameters<typeof createActor<typeof ticketMachine>>[1] extends { snapshot?: infer S } ? S : never,
    input: {
      ticketId: input.ticketId,
      projectId: input.projectId,
      externalId: input.externalId,
      title: input.title,
      maxIterations: input.maxIterations ?? PROFILE_DEFAULTS.maxIterations,
      lockedMainImplementer: input.lockedMainImplementer ?? null,
      lockedCouncilMembers: input.lockedCouncilMembers ?? null,
    },
  })

  attachPersistenceSubscription(resolvedTicketRef, actor)

  actor.start()
  activeActors.set(resolvedTicketRef, actor)
  attachWorkflowRunner(resolvedTicketRef, actor, (event) => actor.send(event))
  return actor
}

export function hydrateAllTickets() {
  const nonTerminalTickets = listNonTerminalTickets()

  let hydrated = 0
  for (const ticket of nonTerminalTickets) {
    if (!ticket.xstateSnapshot) continue
    try {
      const snapshot = JSON.parse(ticket.xstateSnapshot)
      hydrateTicketActor(ticket.id, snapshot, {
        ticketId: ticket.id,
        projectId: ticket.projectId,
        externalId: ticket.externalId,
        title: ticket.title,
        lockedMainImplementer: ticket.lockedMainImplementer ?? null,
        lockedCouncilMembers: ticket.lockedCouncilMembers ? JSON.parse(ticket.lockedCouncilMembers) as string[] : null,
      })
      hydrated++
    } catch (err) {
      console.error(`[persistence] Failed to hydrate ticket ${ticket.externalId}:`, err)
    }
  }

  console.log(`[persistence] Hydrated ${hydrated}/${nonTerminalTickets.length} non-terminal tickets`)
  return hydrated
}

export function sendTicketEvent(
  ticketRef: string | number,
  event: Parameters<ReturnType<typeof createActor<typeof ticketMachine>>['send']>[0],
) {
  const resolvedTicketRef = resolveTicketRef(ticketRef)
  const actor = activeActors.get(resolvedTicketRef)
  if (!actor) {
    throw new Error(`No active actor for ticket ${resolvedTicketRef}`)
  }
  actor.send(event)
  return actor.getSnapshot()
}

export function getTicketState(ticketRef: string | number) {
  const actor = activeActors.get(resolveTicketRef(ticketRef))
  if (!actor) return null
  const snapshot = actor.getSnapshot()
  return {
    state: typeof snapshot.value === 'string' ? snapshot.value : String(snapshot.value),
    context: snapshot.context,
    status: snapshot.status,
  }
}

export function stopActor(ticketRef: string | number) {
  const resolvedTicketRef = resolveTicketRef(ticketRef)
  const actor = activeActors.get(resolvedTicketRef)
  if (!actor) return false

  try {
    actor.stop()
  } catch {
    // ignore stop errors
  }
  activeActors.delete(resolvedTicketRef)
  return true
}

export function stopAllActors() {
  for (const [id, actor] of activeActors) {
    try {
      actor.stop()
    } catch {
      // ignore stop errors
    }
    activeActors.delete(id)
  }
}
