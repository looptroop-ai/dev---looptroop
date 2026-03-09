import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { db as appDb } from '../../db/index'
import { clearProjectDatabaseCache } from '../../db/project'
import { attachedProjects, profiles } from '../../db/schema'
import { initializeDatabase } from '../../db/init'
import { attachProject } from '../../storage/projects'
import { createTicket, getTicketContext } from '../../storage/tickets'
import {
  createTicketActor,
  getActor,
  getAllActors,
  getTicketState,
  hydrateAllTickets,
  hydrateTicketActor,
  sendTicketEvent,
  stopAllActors,
} from '../persistence'

vi.mock('../../workflow/runner', () => ({
  attachWorkflowRunner: () => {},
}))

let projectId: number
const repoDirs: string[] = []

function createGitRepo(prefix: string): string {
  const repoDir = fs.mkdtempSync(path.join(tmpdir(), prefix))
  execFileSync('git', ['-C', repoDir, 'init'], { stdio: 'pipe' })
  execFileSync('git', ['-C', repoDir, 'config', 'user.email', 'test@example.com'], { stdio: 'pipe' })
  execFileSync('git', ['-C', repoDir, 'config', 'user.name', 'LoopTroop Tests'], { stdio: 'pipe' })
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# Fixture\n')
  execFileSync('git', ['-C', repoDir, 'add', 'README.md'], { stdio: 'pipe' })
  execFileSync('git', ['-C', repoDir, 'commit', '-m', 'init'], { stdio: 'pipe' })
  execFileSync('git', ['-C', repoDir, 'branch', '-M', 'main'], { stdio: 'pipe' })
  repoDirs.push(repoDir)
  return repoDir
}

beforeAll(() => {
  initializeDatabase()
})

beforeEach(() => {
  stopAllActors()
  clearProjectDatabaseCache()
  appDb.delete(attachedProjects).run()
  appDb.delete(profiles).run()

  const repoDir = createGitRepo('looptroop-persist-')
  const project = attachProject({
    folderPath: repoDir,
    name: 'Persist Project',
    shortname: 'PST',
  })
  projectId = project.id
})

afterEach(() => {
  stopAllActors()
  clearProjectDatabaseCache()
  for (const dir of repoDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function insertTicket(overrides: Partial<{ title: string }> = {}) {
  return createTicket({
    projectId,
    title: overrides.title ?? 'Test Ticket',
  })
}

describe('persistence', () => {
  describe('createTicketActor', () => {
    it('should create an actor and persist snapshot to the project-local SQLite DB', () => {
      const ticket = insertTicket()
      const actor = createTicketActor(ticket.id, {
        ticketId: ticket.id,
        projectId,
        externalId: ticket.externalId,
        title: ticket.title,
      })

      expect(actor.getSnapshot().value).toBe('DRAFT')
      expect(getActor(ticket.id)).toBe(actor)

      const ticketContext = getTicketContext(ticket.id)!
      expect(ticketContext.localTicket.xstateSnapshot).toBeDefined()
      expect(ticketContext.localTicket.status).toBe('DRAFT')

      const snapshot = JSON.parse(ticketContext.localTicket.xstateSnapshot!)
      expect(snapshot.value).toBe('DRAFT')
    })

    it('should auto-persist on state transitions', () => {
      const ticket = insertTicket()
      createTicketActor(ticket.id, {
        ticketId: ticket.id,
        projectId,
        externalId: ticket.externalId,
        title: ticket.title,
      })

      sendTicketEvent(ticket.id, { type: 'START' })

      const ticketContext = getTicketContext(ticket.id)!
      expect(ticketContext.localTicket.status).toBe('COUNCIL_DELIBERATING')

      const snapshot = JSON.parse(ticketContext.localTicket.xstateSnapshot!)
      expect(snapshot.value).toBe('COUNCIL_DELIBERATING')
    })
  })

  describe('hydrateTicketActor', () => {
    it('should hydrate an actor from a persisted snapshot', () => {
      const ticket = insertTicket()
      const originalActor = createTicketActor(ticket.id, {
        ticketId: ticket.id,
        projectId,
        externalId: ticket.externalId,
        title: ticket.title,
      })

      originalActor.send({ type: 'START' })
      originalActor.send({ type: 'QUESTIONS_READY', result: {} })
      expect(originalActor.getSnapshot().value).toBe('COUNCIL_VOTING_INTERVIEW')

      const savedSnapshot = JSON.parse(getTicketContext(ticket.id)!.localTicket.xstateSnapshot!)

      originalActor.stop()
      getAllActors().delete(ticket.id)

      const hydrated = hydrateTicketActor(ticket.id, savedSnapshot, {
        ticketId: ticket.id,
        projectId,
        externalId: ticket.externalId,
        title: ticket.title,
      })

      expect(hydrated.getSnapshot().value).toBe('COUNCIL_VOTING_INTERVIEW')
      expect(hydrated.getSnapshot().context.ticketId).toBe(ticket.id)
    })

    it('should continue accepting events after hydration', () => {
      const ticket = insertTicket()
      const originalActor = createTicketActor(ticket.id, {
        ticketId: ticket.id,
        projectId,
        externalId: ticket.externalId,
        title: ticket.title,
      })

      originalActor.send({ type: 'START' })
      const savedSnapshot = JSON.parse(getTicketContext(ticket.id)!.localTicket.xstateSnapshot!)

      originalActor.stop()
      getAllActors().delete(ticket.id)

      hydrateTicketActor(ticket.id, savedSnapshot, {
        ticketId: ticket.id,
        projectId,
        externalId: ticket.externalId,
        title: ticket.title,
      })

      sendTicketEvent(ticket.id, { type: 'QUESTIONS_READY', result: {} })

      const state = getTicketState(ticket.id)
      expect(state).not.toBeNull()
      expect(state!.state).toBe('COUNCIL_VOTING_INTERVIEW')
      expect(getTicketContext(ticket.id)!.localTicket.status).toBe('COUNCIL_VOTING_INTERVIEW')
    })
  })

  describe('sendTicketEvent', () => {
    it('should send events and persist state changes', () => {
      const ticket = insertTicket()
      createTicketActor(ticket.id, {
        ticketId: ticket.id,
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

      const ticketContext = getTicketContext(ticket.id)!
      expect(ticketContext.localTicket.status).toBe('BLOCKED_ERROR')
      expect(ticketContext.localTicket.errorMessage).toBe('test error')
    })

    it('should clear persisted error message after retry', () => {
      const ticket = insertTicket()
      createTicketActor(ticket.id, {
        ticketId: ticket.id,
        projectId,
        externalId: ticket.externalId,
        title: ticket.title,
      })

      sendTicketEvent(ticket.id, { type: 'START' })
      sendTicketEvent(ticket.id, { type: 'QUESTIONS_READY', result: {} })
      sendTicketEvent(ticket.id, { type: 'ERROR', message: 'retryable failure' })

      expect(getTicketContext(ticket.id)!.localTicket.status).toBe('BLOCKED_ERROR')
      expect(getTicketContext(ticket.id)!.localTicket.errorMessage).toBe('retryable failure')

      sendTicketEvent(ticket.id, { type: 'RETRY' })

      expect(getTicketContext(ticket.id)!.localTicket.status).toBe('COUNCIL_VOTING_INTERVIEW')
      expect(getTicketContext(ticket.id)!.localTicket.errorMessage).toBeNull()
    })

    it('should throw for non-existent actor', () => {
      expect(() => sendTicketEvent('missing:ticket', { type: 'START' })).toThrow('No active actor for ticket missing:ticket')
    })
  })

  describe('getTicketState', () => {
    it('should return null for non-existent actor', () => {
      expect(getTicketState('missing:ticket')).toBeNull()
    })

    it('should return state info for active actor', () => {
      const ticket = insertTicket()
      createTicketActor(ticket.id, {
        ticketId: ticket.id,
        projectId,
        externalId: ticket.externalId,
        title: ticket.title,
      })

      const state = getTicketState(ticket.id)
      expect(state).not.toBeNull()
      expect(state!.state).toBe('DRAFT')
      expect(state!.status).toBe('active')
      expect(state!.context.ticketId).toBe(ticket.id)
    })
  })

  describe('terminal state cleanup', () => {
    it('should remove actor from map when reaching CANCELED', () => {
      const ticket = insertTicket()
      createTicketActor(ticket.id, {
        ticketId: ticket.id,
        projectId,
        externalId: ticket.externalId,
        title: ticket.title,
      })

      expect(getActor(ticket.id)).toBeDefined()
      sendTicketEvent(ticket.id, { type: 'CANCEL' })

      expect(getActor(ticket.id)).toBeUndefined()
      expect(getTicketContext(ticket.id)!.localTicket.status).toBe('CANCELED')
    })
  })

  describe('snapshot serialization round-trip', () => {
    it('should serialize and deserialize snapshot correctly', () => {
      const ticket = insertTicket()
      const actor = createTicketActor(ticket.id, {
        ticketId: ticket.id,
        projectId,
        externalId: ticket.externalId,
        title: ticket.title,
      })

      actor.send({ type: 'START' })
      actor.send({ type: 'QUESTIONS_READY', result: {} })
      actor.send({ type: 'WINNER_SELECTED', winner: 'plan-a' })

      const serialized = getTicketContext(ticket.id)!.localTicket.xstateSnapshot!
      const deserialized = JSON.parse(serialized)

      expect(deserialized.value).toBe('COMPILING_INTERVIEW')
      expect(deserialized.context).toBeDefined()
      expect(deserialized.context.ticketId).toBe(ticket.id)
      expect(JSON.parse(JSON.stringify(deserialized))).toEqual(deserialized)
    })
  })

  describe('hydrateAllTickets', () => {
    it('should hydrate non-terminal tickets on startup', () => {
      const ticket = insertTicket()
      const actor = createTicketActor(ticket.id, {
        ticketId: ticket.id,
        projectId,
        externalId: ticket.externalId,
        title: ticket.title,
      })
      actor.send({ type: 'START' })

      expect(getTicketContext(ticket.id)!.localTicket.status).toBe('COUNCIL_DELIBERATING')

      stopAllActors()
      expect(getAllActors().size).toBe(0)

      const hydrated = hydrateAllTickets()
      expect(hydrated).toBe(1)
      expect(getAllActors().size).toBe(1)

      const state = getTicketState(ticket.id)
      expect(state!.state).toBe('COUNCIL_DELIBERATING')
    })

    it('should not hydrate terminal tickets', () => {
      const ticket = insertTicket()
      const actor = createTicketActor(ticket.id, {
        ticketId: ticket.id,
        projectId,
        externalId: ticket.externalId,
        title: ticket.title,
      })
      actor.send({ type: 'CANCEL' })

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
        ticketId: ticket1.id,
        projectId,
        externalId: ticket1.externalId,
        title: ticket1.title,
      })
      createTicketActor(ticket2.id, {
        ticketId: ticket2.id,
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
