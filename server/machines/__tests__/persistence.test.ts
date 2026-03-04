import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { db } from '../../db/index'
import { tickets, projects, phaseArtifacts, opencodeSessions } from '../../db/schema'
import { initializeDatabase } from '../../db/init'
import { eq } from 'drizzle-orm'
import {
  createTicketActor,
  hydrateTicketActor,
  sendTicketEvent,
  getTicketState,
  getActor,
  getAllActors,
  stopAllActors,
  hydrateAllTickets,
} from '../persistence'

let projectId: number

beforeAll(() => {
  initializeDatabase()
})

beforeEach(() => {
  stopAllActors()
  db.delete(opencodeSessions).run()
  db.delete(phaseArtifacts).run()
  db.delete(tickets).run()
  db.delete(projects).run()

  const project = db.insert(projects).values({
    name: 'Persist Project',
    shortname: 'PST',
    folderPath: '/tmp/persist',
  }).returning().get()
  projectId = project.id
})

afterEach(() => {
  stopAllActors()
})

function insertTicket(overrides: Partial<{ title: string; status: string; xstateSnapshot: string }> = {}) {
  const counter = db.select().from(tickets).all().length + 1
  return db.insert(tickets).values({
    externalId: `PST-${counter}`,
    projectId,
    title: overrides.title ?? 'Test Ticket',
    status: overrides.status ?? 'DRAFT',
    xstateSnapshot: overrides.xstateSnapshot ?? null,
  }).returning().get()
}

describe('persistence', () => {
  describe('createTicketActor', () => {
    it('should create an actor and persist snapshot to SQLite', () => {
      const ticket = insertTicket()
      const actor = createTicketActor(ticket.id, {
        ticketId: String(ticket.id),
        projectId,
        externalId: ticket.externalId,
        title: ticket.title,
      })

      expect(actor.getSnapshot().value).toBe('DRAFT')
      expect(getActor(ticket.id)).toBe(actor)

      // Verify snapshot was persisted to DB
      const dbTicket = db.select().from(tickets).where(eq(tickets.id, ticket.id)).get()
      expect(dbTicket).toBeDefined()
      expect(dbTicket!.xstateSnapshot).toBeDefined()
      expect(dbTicket!.status).toBe('DRAFT')

      const snapshot = JSON.parse(dbTicket!.xstateSnapshot!)
      expect(snapshot.value).toBe('DRAFT')
    })

    it('should auto-persist on state transitions', () => {
      const ticket = insertTicket()
      createTicketActor(ticket.id, {
        ticketId: String(ticket.id),
        projectId,
        externalId: ticket.externalId,
        title: ticket.title,
      })

      sendTicketEvent(ticket.id, { type: 'START' })

      const dbTicket = db.select().from(tickets).where(eq(tickets.id, ticket.id)).get()
      expect(dbTicket!.status).toBe('COUNCIL_DELIBERATING')

      const snapshot = JSON.parse(dbTicket!.xstateSnapshot!)
      expect(snapshot.value).toBe('COUNCIL_DELIBERATING')
    })
  })

  describe('hydrateTicketActor', () => {
    it('should hydrate an actor from a persisted snapshot', () => {
      // First create and advance an actor
      const ticket = insertTicket()
      const originalActor = createTicketActor(ticket.id, {
        ticketId: String(ticket.id),
        projectId,
        externalId: ticket.externalId,
        title: ticket.title,
      })

      originalActor.send({ type: 'START' })
      originalActor.send({ type: 'QUESTIONS_READY', result: {} })
      expect(originalActor.getSnapshot().value).toBe('COUNCIL_VOTING_INTERVIEW')

      // Get the persisted snapshot from DB
      const dbTicket = db.select().from(tickets).where(eq(tickets.id, ticket.id)).get()
      const savedSnapshot = JSON.parse(dbTicket!.xstateSnapshot!)

      // Stop original actor
      originalActor.stop()
      getAllActors().delete(ticket.id)

      // Hydrate from snapshot
      const hydrated = hydrateTicketActor(ticket.id, savedSnapshot, {
        ticketId: String(ticket.id),
        projectId,
        externalId: ticket.externalId,
        title: ticket.title,
      })

      expect(hydrated.getSnapshot().value).toBe('COUNCIL_VOTING_INTERVIEW')
      expect(hydrated.getSnapshot().context.ticketId).toBe(String(ticket.id))
    })

    it('should continue accepting events after hydration', () => {
      const ticket = insertTicket()
      const originalActor = createTicketActor(ticket.id, {
        ticketId: String(ticket.id),
        projectId,
        externalId: ticket.externalId,
        title: ticket.title,
      })

      originalActor.send({ type: 'START' })
      const dbTicket = db.select().from(tickets).where(eq(tickets.id, ticket.id)).get()
      const savedSnapshot = JSON.parse(dbTicket!.xstateSnapshot!)

      originalActor.stop()
      getAllActors().delete(ticket.id)

      hydrateTicketActor(ticket.id, savedSnapshot, {
        ticketId: String(ticket.id),
        projectId,
        externalId: ticket.externalId,
        title: ticket.title,
      })

      // Send event to hydrated actor
      sendTicketEvent(ticket.id, { type: 'QUESTIONS_READY', result: {} })

      const state = getTicketState(ticket.id)
      expect(state).not.toBeNull()
      expect(state!.state).toBe('COUNCIL_VOTING_INTERVIEW')

      // Verify DB was updated
      const updatedTicket = db.select().from(tickets).where(eq(tickets.id, ticket.id)).get()
      expect(updatedTicket!.status).toBe('COUNCIL_VOTING_INTERVIEW')
    })
  })

  describe('sendTicketEvent', () => {
    it('should send events and persist state changes', () => {
      const ticket = insertTicket()
      createTicketActor(ticket.id, {
        ticketId: String(ticket.id),
        projectId,
        externalId: ticket.externalId,
        title: ticket.title,
      })

      sendTicketEvent(ticket.id, { type: 'START' })
      sendTicketEvent(ticket.id, { type: 'QUESTIONS_READY', result: {} })
      sendTicketEvent(ticket.id, { type: 'ERROR', message: 'test error' })

      const state = getTicketState(ticket.id)
      expect(state!.state).toBe('BLOCKED_ERROR')
      expect(state!.context.error).toBe('test error')

      const dbTicket = db.select().from(tickets).where(eq(tickets.id, ticket.id)).get()
      expect(dbTicket!.status).toBe('BLOCKED_ERROR')
    })

    it('should throw for non-existent actor', () => {
      expect(() => sendTicketEvent(99999, { type: 'START' })).toThrow('No active actor for ticket 99999')
    })
  })

  describe('getTicketState', () => {
    it('should return null for non-existent actor', () => {
      expect(getTicketState(99999)).toBeNull()
    })

    it('should return state info for active actor', () => {
      const ticket = insertTicket()
      createTicketActor(ticket.id, {
        ticketId: String(ticket.id),
        projectId,
        externalId: ticket.externalId,
        title: ticket.title,
      })

      const state = getTicketState(ticket.id)
      expect(state).not.toBeNull()
      expect(state!.state).toBe('DRAFT')
      expect(state!.status).toBe('active')
      expect(state!.context.ticketId).toBe(String(ticket.id))
    })
  })

  describe('terminal state cleanup', () => {
    it('should remove actor from map when reaching CANCELED', () => {
      const ticket = insertTicket()
      createTicketActor(ticket.id, {
        ticketId: String(ticket.id),
        projectId,
        externalId: ticket.externalId,
        title: ticket.title,
      })

      expect(getActor(ticket.id)).toBeDefined()
      sendTicketEvent(ticket.id, { type: 'CANCEL' })

      // Actor should be removed after reaching terminal state
      expect(getActor(ticket.id)).toBeUndefined()

      const dbTicket = db.select().from(tickets).where(eq(tickets.id, ticket.id)).get()
      expect(dbTicket!.status).toBe('CANCELED')
    })
  })

  describe('snapshot serialization round-trip', () => {
    it('should serialize and deserialize snapshot correctly', () => {
      const ticket = insertTicket()
      const actor = createTicketActor(ticket.id, {
        ticketId: String(ticket.id),
        projectId,
        externalId: ticket.externalId,
        title: ticket.title,
      })

      actor.send({ type: 'START' })
      actor.send({ type: 'QUESTIONS_READY', result: {} })
      actor.send({ type: 'WINNER_SELECTED', winner: 'plan-a' })

      // Get snapshot from DB
      const dbTicket = db.select().from(tickets).where(eq(tickets.id, ticket.id)).get()
      const serialized = dbTicket!.xstateSnapshot!
      const deserialized = JSON.parse(serialized)

      // Verify it's a valid snapshot
      expect(deserialized.value).toBe('COMPILING_INTERVIEW')
      expect(deserialized.context).toBeDefined()
      expect(deserialized.context.ticketId).toBe(String(ticket.id))

      // Re-serialize should produce equivalent JSON
      const reserialized = JSON.stringify(deserialized)
      expect(JSON.parse(reserialized)).toEqual(deserialized)
    })
  })

  describe('hydrateAllTickets', () => {
    it('should hydrate non-terminal tickets on startup', () => {
      // Create a ticket with a snapshot in non-terminal state
      const ticket = insertTicket()
      const actor = createTicketActor(ticket.id, {
        ticketId: String(ticket.id),
        projectId,
        externalId: ticket.externalId,
        title: ticket.title,
      })
      actor.send({ type: 'START' })

      // Verify it's in COUNCIL_DELIBERATING
      const dbTicket = db.select().from(tickets).where(eq(tickets.id, ticket.id)).get()
      expect(dbTicket!.status).toBe('COUNCIL_DELIBERATING')

      // Clear all actors (simulating restart)
      stopAllActors()
      expect(getAllActors().size).toBe(0)

      // Hydrate
      const hydrated = hydrateAllTickets()
      expect(hydrated).toBe(1)
      expect(getAllActors().size).toBe(1)

      const state = getTicketState(ticket.id)
      expect(state!.state).toBe('COUNCIL_DELIBERATING')
    })

    it('should not hydrate terminal tickets', () => {
      // Create and cancel a ticket
      const ticket = insertTicket()
      const actor = createTicketActor(ticket.id, {
        ticketId: String(ticket.id),
        projectId,
        externalId: ticket.externalId,
        title: ticket.title,
      })
      actor.send({ type: 'CANCEL' })

      // Actor is already removed due to terminal state
      stopAllActors()
      expect(getAllActors().size).toBe(0)

      const hydrated = hydrateAllTickets()
      expect(hydrated).toBe(0)
      expect(getAllActors().size).toBe(0)
    })
  })

  describe('stopAllActors', () => {
    it('should stop and remove all actors', () => {
      const ticket1 = insertTicket({ title: 'Ticket 1' })
      const ticket2 = insertTicket({ title: 'Ticket 2' })

      createTicketActor(ticket1.id, {
        ticketId: String(ticket1.id),
        projectId,
        externalId: ticket1.externalId,
        title: ticket1.title,
      })
      createTicketActor(ticket2.id, {
        ticketId: String(ticket2.id),
        projectId,
        externalId: ticket2.externalId,
        title: ticket2.title,
      })

      expect(getAllActors().size).toBe(2)
      stopAllActors()
      expect(getAllActors().size).toBe(0)
    })
  })
})
