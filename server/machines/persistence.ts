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
  recordTicketErrorOccurrence,
  resolveLatestTicketErrorOccurrence,
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
  const timestamp = new Date().toISOString()
  broadcaster.broadcast(ticketRef, 'log', {
    ticketId: ticketRef,
    phase,
    type: 'info',
    content,
    timestamp,
    source: 'system',
    ...(data ? { data } : {}),
  })
  appendLogEvent(ticketRef, 'info', phase, content, data ? { ...data, timestamp } : { timestamp }, 'system', phase)
}

function emitAppErrorLog(
  ticketRef: string,
  phase: string,
  content: string,
  data?: Record<string, unknown>,
) {
  const timestamp = new Date().toISOString()
  broadcaster.broadcast(ticketRef, 'log', {
    ticketId: ticketRef,
    phase,
    type: 'error',
    content,
    timestamp,
    source: 'error',
    ...(data ? { data } : {}),
  })
  appendLogEvent(ticketRef, 'error', phase, content, data ? { ...data, timestamp } : { timestamp }, 'error', phase)
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
        `[SYS] Actor active in ${currentState}.`,
        { state: currentState },
      )
    }

    if (actor.getSnapshot().status === 'done') {
      activeActors.delete(ticketRef)
    }
  })
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
    lockedMainImplementerVariant: ticket.localTicket.lockedMainImplementerVariant ?? null,
    lockedCouncilMembers: ticket.localTicket.lockedCouncilMembers ? JSON.parse(ticket.localTicket.lockedCouncilMembers) as string[] : null,
    lockedCouncilMemberVariants: ticket.localTicket.lockedCouncilMemberVariants ? JSON.parse(ticket.localTicket.lockedCouncilMemberVariants) as Record<string, string> : null,
    lockedInterviewQuestions: ticket.localTicket.lockedInterviewQuestions ?? null,
    lockedCoverageFollowUpBudgetPercent: ticket.localTicket.lockedCoverageFollowUpBudgetPercent ?? null,
    lockedMaxCoveragePasses: ticket.localTicket.lockedMaxCoveragePasses ?? null,
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

function persistSnapshot(
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
  const errorCodes = Array.isArray(currentSnapshot.context.errorCodes)
    ? currentSnapshot.context.errorCodes.filter((code): code is string => typeof code === 'string' && code.trim().length > 0)
    : []
  const transitionAt = new Date().toISOString()

  const updated = patchTicket(resolvedTicketRef, {
    xstateSnapshot: JSON.stringify(snapshot),
    status: stateValue,
    errorMessage,
  })

  if (!updated) return

  if (previousStatus !== stateValue) {
    const payload = {
      ticketId: ticketRef,
      from: previousStatus ?? 'unknown',
      to: stateValue,
    }
    broadcaster.broadcast(resolvedTicketRef, 'state_change', payload)
    appendLogEvent(
      resolvedTicketRef,
      'state_change',
      stateValue,
      `[SYS] Transition: ${payload.from} -> ${payload.to}`,
      { ...payload, timestamp: new Date().toISOString() },
      'system',
      stateValue,
      { audience: 'all', kind: 'milestone', op: 'append', streaming: false },
    )

    if (stateValue === 'BLOCKED_ERROR') {
      const blockedMessage = errorMessage ?? 'Unknown error'
      recordTicketErrorOccurrence(resolvedTicketRef, {
        blockedFromStatus: payload.from,
        errorMessage,
        errorCodes,
        occurredAt: transitionAt,
      })
      emitAppErrorLog(
        resolvedTicketRef,
        stateValue,
        `[SYS] Blocked in ${payload.from}: ${blockedMessage}`,
        {
          message: blockedMessage,
          blockedFrom: payload.from,
          blockedTo: payload.to,
          errorCodes,
        },
      )
    } else if (previousStatus === 'BLOCKED_ERROR') {
      resolveLatestTicketErrorOccurrence(resolvedTicketRef, {
        resolutionStatus: stateValue === 'CANCELED' ? 'CANCELED' : 'RETRIED',
        resumedToStatus: stateValue === 'CANCELED' ? null : stateValue,
        resolvedAt: transitionAt,
      })
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
    lockedMainImplementerVariant?: string | null
    lockedCouncilMembers?: string[] | null
    lockedCouncilMemberVariants?: Record<string, string> | null
    lockedInterviewQuestions?: number | null
    lockedCoverageFollowUpBudgetPercent?: number | null
    lockedMaxCoveragePasses?: number | null
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
      lockedMainImplementerVariant: input.lockedMainImplementerVariant ?? null,
      lockedCouncilMembers: input.lockedCouncilMembers ?? null,
      lockedCouncilMemberVariants: input.lockedCouncilMemberVariants ?? null,
      lockedInterviewQuestions: input.lockedInterviewQuestions ?? null,
      lockedCoverageFollowUpBudgetPercent: input.lockedCoverageFollowUpBudgetPercent ?? null,
      lockedMaxCoveragePasses: input.lockedMaxCoveragePasses ?? null,
    },
  })

  attachPersistenceSubscription(resolvedTicketRef, actor)

  actor.start()
  activeActors.set(resolvedTicketRef, actor)
  attachWorkflowRunner(resolvedTicketRef, actor, (event) => actor.send(event))
  return actor
}

function hydrateTicketActor(
  ticketRef: string | number,
  snapshot: unknown,
  input: {
    ticketId: string
    projectId: number
    externalId: string
    title: string
    maxIterations?: number
    lockedMainImplementer?: string | null
    lockedMainImplementerVariant?: string | null
    lockedCouncilMembers?: string[] | null
    lockedCouncilMemberVariants?: Record<string, string> | null
    lockedInterviewQuestions?: number | null
    lockedCoverageFollowUpBudgetPercent?: number | null
    lockedMaxCoveragePasses?: number | null
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
      lockedMainImplementerVariant: input.lockedMainImplementerVariant ?? null,
      lockedCouncilMembers: input.lockedCouncilMembers ?? null,
      lockedCouncilMemberVariants: input.lockedCouncilMemberVariants ?? null,
      lockedInterviewQuestions: input.lockedInterviewQuestions ?? null,
      lockedCoverageFollowUpBudgetPercent: input.lockedCoverageFollowUpBudgetPercent ?? null,
      lockedMaxCoveragePasses: input.lockedMaxCoveragePasses ?? null,
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
        lockedMainImplementerVariant: ticket.lockedMainImplementerVariant ?? null,
        lockedCouncilMembers: ticket.lockedCouncilMembers.length > 0 ? ticket.lockedCouncilMembers : null,
        lockedCouncilMemberVariants: ticket.lockedCouncilMemberVariants ?? null,
        lockedInterviewQuestions: ticket.lockedInterviewQuestions ?? null,
        lockedCoverageFollowUpBudgetPercent: ticket.lockedCoverageFollowUpBudgetPercent ?? null,
        lockedMaxCoveragePasses: ticket.lockedMaxCoveragePasses ?? null,
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
