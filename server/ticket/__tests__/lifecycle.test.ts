import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, rmSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { db } from '../../db/index'
import { projects, tickets, phaseArtifacts, opencodeSessions } from '../../db/schema'
import { initializeDatabase } from '../../db/init'
import { createTicket } from '../create'
import { initializeTicket } from '../initialize'

const WORKTREE_ROOT = resolve(process.cwd(), '.looptroop/worktrees')

describe('Ticket Lifecycle', () => {
  beforeEach(() => {
    initializeDatabase()
    // Clean up test data
    db.delete(opencodeSessions).run()
    db.delete(phaseArtifacts).run()
    db.delete(tickets).run()
    db.delete(projects).run()
    // Create test project
    db.insert(projects).values({
      name: 'Test Project',
      shortname: 'TEST',
      folderPath: '/tmp/test-project',
    }).run()
  })

  afterEach(() => {
    try {
      rmSync(WORKTREE_ROOT, { recursive: true, force: true })
    } catch { /* cleanup best-effort */ }
  })

  it('creates a ticket with auto-generated external ID', () => {
    const project = db.select().from(projects).limit(1).get()!
    const ticket = createTicket({ projectId: project.id, title: 'Test Ticket' })

    expect(ticket.externalId).toBe('TEST-1')
    expect(ticket.status).toBe('DRAFT')
    expect(ticket.title).toBe('Test Ticket')
  })

  it('increments ticket counter on project', () => {
    const project = db.select().from(projects).limit(1).get()!
    createTicket({ projectId: project.id, title: 'First' })
    createTicket({ projectId: project.id, title: 'Second' })

    const updated = db.select().from(projects).limit(1).get()!
    expect(updated.ticketCounter).toBe(2)
  })

  it('creates ticket.meta.json on ticket creation', () => {
    const project = db.select().from(projects).limit(1).get()!
    const ticket = createTicket({ projectId: project.id, title: 'Test' })

    const metaPath = resolve(WORKTREE_ROOT, ticket.externalId, '.ticket', 'meta', 'ticket.meta.json')
    expect(existsSync(metaPath)).toBe(true)

    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
    expect(meta.externalId).toBe('TEST-1')
  })

  it('initializes ticket directory structure', () => {
    const project = db.select().from(projects).limit(1).get()!
    const ticket = createTicket({ projectId: project.id, title: 'Test' })

    const result = initializeTicket({
      externalId: ticket.externalId,
      projectFolder: '/tmp/test-project',
    })

    expect(result.success).toBe(true)
    expect(result.created).toBe(true)

    const ticketDir = resolve(WORKTREE_ROOT, ticket.externalId, '.ticket')
    expect(existsSync(resolve(ticketDir, 'runtime'))).toBe(true)
    expect(existsSync(resolve(ticketDir, 'approvals'))).toBe(true)
    expect(existsSync(resolve(ticketDir, '.gitignore'))).toBe(true)
    expect(existsSync(resolve(ticketDir, 'codebase-map.yaml'))).toBe(true)
    expect(existsSync(resolve(ticketDir, 'initialized'))).toBe(true)
  })

  it('initialization is idempotent', () => {
    const project = db.select().from(projects).limit(1).get()!
    const ticket = createTicket({ projectId: project.id, title: 'Test' })

    const result1 = initializeTicket({ externalId: ticket.externalId, projectFolder: '/tmp/test' })
    const result2 = initializeTicket({ externalId: ticket.externalId, projectFolder: '/tmp/test' })

    expect(result1.success).toBe(true)
    expect(result2.success).toBe(true)
    expect(result1.created).toBe(true)
    expect(result2.created).toBe(false)
  })

  it('rejects ticket creation for non-existent project', () => {
    expect(() => createTicket({ projectId: 9999, title: 'Bad' })).toThrow('Project not found')
  })
})
