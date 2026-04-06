import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { existsSync, readFileSync } from 'node:fs'
import { initializeDatabase } from '../../db/init'
import { sqlite } from '../../db/index'
import { clearProjectDatabaseCache } from '../../db/project'
import { broadcaster } from '../../sse/broadcaster'
import { attachProject } from '../../storage/projects'
import { createTicket, getTicketByRef, getTicketPaths } from '../../storage/tickets'
import { createFixtureRepoManager } from '../../test/fixtureRepo'

vi.mock('../../machines/persistence', async () => {
  const storage = await import('../../storage/tickets')

  return {
    createTicketActor: vi.fn(),
    ensureActorForTicket: vi.fn(() => ({ id: 'mock-actor' })),
    sendTicketEvent: vi.fn((ticketRef: string | number, event: { type: string; message?: string | null }) => {
      const resolvedTicketRef = String(ticketRef)
      if (event.type === 'START') {
        storage.patchTicket(resolvedTicketRef, { status: 'SCANNING_RELEVANT_FILES' })
      }
      if (event.type === 'INIT_FAILED') {
        storage.patchTicket(resolvedTicketRef, {
          status: 'BLOCKED_ERROR',
          errorMessage: event.message ?? null,
        })
      }
      return { value: event.type }
    }),
    getTicketState: vi.fn((ticketRef: string | number) => {
      const ticket = storage.getTicketByRef(String(ticketRef))
      if (!ticket) return null
      return {
        state: ticket.status,
        context: {},
        status: 'active',
      }
    }),
    stopActor: vi.fn(() => true),
  }
})

vi.mock('../../opencode/modelValidation', () => ({
  validateModelSelection: vi.fn(),
}))

vi.mock('../../ticket/initialize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ticket/initialize')>()
  return {
    ...actual,
    initializeTicket: vi.fn(actual.initializeTicket),
  }
})

import { validateModelSelection } from '../../opencode/modelValidation'
import { TicketInitializationError, initializeTicket } from '../../ticket/initialize'
import { ticketRouter } from '../tickets'

const repoManager = createFixtureRepoManager({
  templatePrefix: 'looptroop-ticket-route-start-',
  files: {
    'README.md': '# LoopTroop Ticket Route Start Test\n',
  },
})

interface PersistedLogEvent {
  phase?: string
  type?: string
  message?: string
  content?: string
}

function setupStartTicketApp() {
  const repoDir = repoManager.createRepo()
  const project = attachProject({
    folderPath: repoDir,
    name: 'LoopTroop',
    shortname: 'LOOP',
  })
  const ticket = createTicket({
    projectId: project.id,
    title: 'Start route',
    description: 'Verify start logging.',
  })

  const app = new Hono()
  app.route('/api', ticketRouter)

  return { app, ticket }
}

function readPersistedLogEvents(ticketId: string): PersistedLogEvent[] {
  const paths = getTicketPaths(ticketId)
  if (!paths || !existsSync(paths.executionLogPath)) return []

  const raw = readFileSync(paths.executionLogPath, 'utf-8').trim()
  if (!raw) return []

  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as PersistedLogEvent)
}

function getDraftLogMessages(ticketId: string): string[] {
  return readPersistedLogEvents(ticketId)
    .filter((entry) => entry.phase === 'DRAFT')
    .map((entry) => String(entry.message ?? entry.content ?? ''))
}

describe('ticketRouter POST /tickets/:id/start', () => {
  beforeEach(() => {
    clearProjectDatabaseCache()
    initializeDatabase()
    sqlite.exec('DELETE FROM attached_projects; DELETE FROM profiles;')
    vi.restoreAllMocks()

    vi.mocked(validateModelSelection).mockResolvedValue({
      mainImplementer: 'openai/codex-mini-latest',
      councilMembers: [
        'openai/codex-mini-latest',
        'openai/gpt-5.3-codex',
        'anthropic/claude-sonnet-4',
      ],
    })
    vi.mocked(initializeTicket).mockClear()
  })

  afterAll(() => {
    clearProjectDatabaseCache()
    repoManager.cleanup()
  })

  it('persists and emits ordered DRAFT logs before the ticket leaves backlog', async () => {
    const { app, ticket } = setupStartTicketApp()
    const broadcastSpy = vi.spyOn(broadcaster, 'broadcast')

    const response = await app.request(`/api/tickets/${ticket.id}/start`, {
      method: 'POST',
    })

    expect(response.status).toBe(200)
    const payload = await response.json() as { status?: string; message?: string }
    expect(payload).toMatchObject({
      status: 'SCANNING_RELEVANT_FILES',
      message: 'Start action accepted',
    })
    expect(getTicketByRef(ticket.id)?.status).toBe('SCANNING_RELEVANT_FILES')

    expect(getDraftLogMessages(ticket.id)).toEqual([
      'Start requested.',
      'Validating model availability.',
      '✓ Model Availability: Main implementer openai/codex-mini-latest; council size 3.',
      'Initializing workspace and ticket directories.',
      `✓ Workspace Init: Ready on branch ${ticket.externalId} (new worktree and ticket directories created).`,
      'Locking start configuration.',
      '✓ Start Config: Configuration locked.',
      '✓ Workflow Dispatch: Start dispatched.',
    ])

    const emittedDraftLogs = broadcastSpy.mock.calls
      .filter(([, event, data]) => event === 'log' && data.phase === 'DRAFT')
      .map(([, , data]) => String(data.content ?? ''))

    expect(emittedDraftLogs).toEqual([
      'Start requested.',
      'Validating model availability.',
      '✓ Model Availability: Main implementer openai/codex-mini-latest; council size 3.',
      'Initializing workspace and ticket directories.',
      `✓ Workspace Init: Ready on branch ${ticket.externalId} (new worktree and ticket directories created).`,
      'Locking start configuration.',
      '✓ Start Config: Configuration locked.',
      '✓ Workflow Dispatch: Start dispatched.',
    ])

    broadcaster.clearTicket(ticket.id)
  })

  it('writes a DRAFT error log when model validation fails and leaves the ticket in DRAFT', async () => {
    const { app, ticket } = setupStartTicketApp()

    vi.mocked(validateModelSelection).mockRejectedValueOnce(
      new Error('No configured OpenCode models are available.'),
    )

    const response = await app.request(`/api/tickets/${ticket.id}/start`, {
      method: 'POST',
    })

    expect(response.status).toBe(400)
    const payload = await response.json() as { error?: string }
    expect(payload.error).toBe('No configured OpenCode models are available.')
    expect(getTicketByRef(ticket.id)?.status).toBe('DRAFT')

    expect(getDraftLogMessages(ticket.id)).toEqual([
      'Start requested.',
      'Validating model availability.',
      '✗ Model Availability: No configured OpenCode models are available.',
    ])

    broadcaster.clearTicket(ticket.id)
  })

  it('writes a DRAFT initialization error log before blocking the ticket', async () => {
    const { app, ticket } = setupStartTicketApp()

    vi.mocked(initializeTicket).mockImplementationOnce(() => {
      throw new TicketInitializationError('INIT_TEST', 'Worktree initialization exploded.')
    })

    const response = await app.request(`/api/tickets/${ticket.id}/start`, {
      method: 'POST',
    })

    expect(response.status).toBe(200)
    const payload = await response.json() as { status?: string; message?: string; details?: string }
    expect(payload).toMatchObject({
      status: 'BLOCKED_ERROR',
      message: 'Start blocked during initialization',
      details: 'Worktree initialization exploded.',
    })
    expect(getTicketByRef(ticket.id)?.status).toBe('BLOCKED_ERROR')

    expect(getDraftLogMessages(ticket.id)).toEqual([
      'Start requested.',
      'Validating model availability.',
      '✓ Model Availability: Main implementer openai/codex-mini-latest; council size 3.',
      'Initializing workspace and ticket directories.',
      '✗ Workspace Init: Worktree initialization exploded.',
    ])

    broadcaster.clearTicket(ticket.id)
  })
})
