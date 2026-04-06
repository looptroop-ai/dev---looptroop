import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { initializeDatabase } from '../../db/init'
import { sqlite } from '../../db/index'
import { clearProjectDatabaseCache } from '../../db/project'
import { safeAtomicWrite } from '../../io/atomicWrite'
import { attachProject } from '../../storage/projects'
import {
  createTicket,
  getLatestPhaseArtifact,
  getTicketPaths,
  patchTicket,
  upsertLatestPhaseArtifact,
} from '../../storage/tickets'
import { createFixtureRepoManager } from '../../test/fixtureRepo'
import { initializeTicket } from '../../ticket/initialize'
import { buildInterviewDocumentYaml } from '../../structuredOutput'
import { buildYamlDocument } from '../../structuredOutput/yamlUtils'
import { ticketRouter } from '../tickets'
import { filesRouter } from '../files'
import { buildInterviewDocument, buildPrdDocument } from '../../test/factories'
import type { PrdDocument } from '../../structuredOutput/types'

vi.mock('../../machines/persistence', async () => {
  const storage = await import('../../storage/tickets')

  return {
    createTicketActor: vi.fn(),
    ensureActorForTicket: vi.fn(() => ({ id: 'mock-actor' })),
    sendTicketEvent: vi.fn((ticketRef: string | number, event: { type: string }) => {
      if (event.type === 'APPROVE') {
        storage.patchTicket(String(ticketRef), { status: 'DRAFTING_BEADS' })
      }
      return { value: event.type }
    }),
    getTicketState: vi.fn((ticketRef: string | number) => {
      const ticket = storage.getTicketByRef(String(ticketRef))
      if (!ticket) return null
      return { state: ticket.status, context: {}, status: 'active' }
    }),
    stopActor: vi.fn(() => true),
  }
})

const repoManager = createFixtureRepoManager({
  templatePrefix: 'looptroop-ticket-route-prd-approval-',
  files: {
    'README.md': '# LoopTroop PRD Approval Test\n',
  },
})

function setupPrdApprovalTicket() {
  const repoDir = repoManager.createRepo()
  const project = attachProject({
    folderPath: repoDir,
    name: 'LoopTroop',
    shortname: 'LOOP',
  })
  const ticket = createTicket({
    projectId: project.id,
    title: 'PRD approval',
    description: 'Verify the PRD approval routes.',
  })

  const init = initializeTicket({
    projectFolder: repoDir,
    externalId: ticket.externalId,
  })

  patchTicket(ticket.id, {
    status: 'WAITING_PRD_APPROVAL',
    branchName: init.branchName,
  })

  const paths = getTicketPaths(ticket.id)
  if (!paths) {
    throw new Error('Ticket workspace not initialized')
  }

  // Write approved interview.yaml (required for PRD normalization hash)
  const interviewDoc = buildInterviewDocument(ticket.externalId)
  const interviewRaw = buildInterviewDocumentYaml(interviewDoc)
  safeAtomicWrite(`${paths.ticketDir}/interview.yaml`, interviewRaw)

  // Build and write prd.yaml
  const interviewContentForHash = readFileSync(`${paths.ticketDir}/interview.yaml`, 'utf-8')
  const interviewHash = createHash('sha256').update(interviewContentForHash).digest('hex')
  const prdDoc = buildPrdDocument(ticket.externalId, interviewHash)
  const prdRaw = buildYamlDocument(prdDoc)
  safeAtomicWrite(`${paths.ticketDir}/prd.yaml`, prdRaw)

  const app = new Hono()
  app.route('/api', ticketRouter)
  app.route('/api', filesRouter)

  return { app, ticket, paths, prdRaw }
}

describe('ticketRouter PRD approval routes', () => {
  beforeEach(() => {
    clearProjectDatabaseCache()
    initializeDatabase()
    sqlite.exec('DELETE FROM attached_projects; DELETE FROM profiles;')
  })

  afterAll(() => {
    clearProjectDatabaseCache()
    repoManager.cleanup()
  })

  it('approves the PRD, stamps approval metadata, and advances the ticket', async () => {
    const { app, ticket, paths } = setupPrdApprovalTicket()

    const response = await app.request(`/api/tickets/${ticket.id}/approve-prd`, {
      method: 'POST',
    })

    expect(response.status).toBe(200)
    const payload = await response.json() as { status?: string; message?: string }
    expect(payload.message).toBe('PRD approved')
    expect(payload.status).toBe('DRAFTING_BEADS')

    const savedRaw = readFileSync(`${paths.ticketDir}/prd.yaml`, 'utf-8')
    expect(savedRaw).toContain('status: approved')
    expect(savedRaw).toContain('approved_by: user')
    expect(savedRaw).toMatch(/approved_at: .+/)
  })

  it('validates raw PRD YAML, canonicalizes it, and forces draft status on save', async () => {
    const { app, ticket, paths } = setupPrdApprovalTicket()

    const response = await app.request(`/api/files/${ticket.id}/prd`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: [
          'schema_version: 1',
          'ticket_id: WRONG-ID',
          'artifact: prd',
          'status: approved',
          'source_interview:',
          '  content_sha256: 0000000000000000000000000000000000000000000000000000000000000000',
          'product:',
          '  problem_statement: Import pipeline needs resilience.',
          '  target_users:',
          '    - Backend engineers',
          'scope:',
          '  in_scope:',
          '    - Retry logic',
          '  out_of_scope:',
          '    - Bulk reprocessing UI',
          'technical_requirements:',
          '  architecture_constraints:',
          '    - Must integrate with existing queue',
          '  data_model: []',
          '  api_contracts: []',
          '  security_constraints: []',
          '  performance_constraints: []',
          '  reliability_constraints: []',
          '  error_handling_rules: []',
          '  tooling_assumptions: []',
          'epics:',
          '  - id: E01',
          '    title: Retry infrastructure',
          '    objective: Build retry mechanism.',
          '    implementation_steps:',
          '      - Add retry queue',
          '    user_stories:',
          '      - id: E01-S01',
          '        title: Retry a failed import',
          '        acceptance_criteria:',
          '          - Import is retried',
          '        implementation_steps:',
          '          - Create retry handler',
          '        verification:',
          '          required_commands:',
          '            - npm test',
          'risks:',
          '  - Queue saturation',
          'approval:',
          '  approved_by: user',
          '  approved_at: 2026-03-20T10:10:00.000Z',
        ].join('\n'),
      }),
    })

    expect(response.status).toBe(200)
    const payload = await response.json() as { success: boolean; content: string }
    expect(payload.success).toBe(true)

    const savedRaw = readFileSync(`${paths.ticketDir}/prd.yaml`, 'utf-8')
    expect(savedRaw).toContain(`ticket_id: ${ticket.externalId}`)
    expect(savedRaw).toContain('status: draft')
    expect(savedRaw).not.toContain('WRONG-ID')

    // Approval fields are cleared on draft save
    expect(savedRaw).toContain("approved_by: ''")
    expect(savedRaw).toContain("approved_at: ''")
  })

  it('accepts structured PRD saves, canonicalizes them, and clears approval metadata', async () => {
    const { app, ticket, paths } = setupPrdApprovalTicket()

    const structuredDocument: PrdDocument = {
      ...buildPrdDocument(ticket.externalId, '0000000000000000000000000000000000000000000000000000000000000000'),
      ticket_id: 'WRONG-ID',
      status: 'approved',
      approval: {
        approved_by: 'user',
        approved_at: '2026-03-20T10:10:00.000Z',
      },
    }

    const response = await app.request(`/api/files/${ticket.id}/prd`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document: structuredDocument,
      }),
    })

    expect(response.status).toBe(200)
    const payload = await response.json() as { success: boolean; content: string }
    expect(payload.success).toBe(true)
    expect(payload.content).toContain(`ticket_id: ${ticket.externalId}`)
    expect(payload.content).toContain('status: draft')
    expect(payload.content).toContain("approved_by: ''")
    expect(payload.content).toContain("approved_at: ''")

    const savedRaw = readFileSync(`${paths.ticketDir}/prd.yaml`, 'utf-8')
    expect(savedRaw).toContain(`ticket_id: ${ticket.externalId}`)
    expect(savedRaw).toContain('status: draft')
    expect(savedRaw).toContain("approved_by: ''")
    expect(savedRaw).toContain("approved_at: ''")
  })

  it('rejects invalid raw PRD YAML without overwriting the current artifact', async () => {
    const { app, ticket, prdRaw, paths } = setupPrdApprovalTicket()

    const response = await app.request(`/api/files/${ticket.id}/prd`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'artifact: prd\nepics: [',
      }),
    })

    expect(response.status).toBe(400)
    const savedRaw = readFileSync(`${paths.ticketDir}/prd.yaml`, 'utf-8')
    expect(savedRaw).toBe(prdRaw)
  })

  it('rejects invalid structured PRD documents without overwriting the current artifact', async () => {
    const { app, ticket, prdRaw, paths } = setupPrdApprovalTicket()

    const response = await app.request(`/api/files/${ticket.id}/prd`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document: {},
      }),
    })

    expect(response.status).toBe(400)
    const savedRaw = readFileSync(`${paths.ticketDir}/prd.yaml`, 'utf-8')
    expect(savedRaw).toBe(prdRaw)
  })

  it('clears downstream beads artifacts when PRD is edited', async () => {
    const { app, ticket, paths } = setupPrdApprovalTicket()

    // Create beads/ directory and a beads artifact in the DB
    const beadsDir = resolve(paths.ticketDir, 'beads')
    mkdirSync(beadsDir, { recursive: true })
    writeFileSync(resolve(beadsDir, 'bead-001.yaml'), 'artifact: bead\n')
    upsertLatestPhaseArtifact(ticket.id, 'beads', 'DRAFTING_BEADS', 'artifact: beads\n')
    upsertLatestPhaseArtifact(ticket.id, 'ui_state:approval_beads', 'UI_STATE', '{"data":{}}')

    const response = await app.request(`/api/files/${ticket.id}/prd`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: [
          'schema_version: 1',
          'artifact: prd',
          'status: draft',
          'source_interview:',
          '  content_sha256: placeholder',
          'product:',
          '  problem_statement: Updated problem statement for retry pipeline.',
          '  target_users:',
          '    - Backend engineers',
          'scope:',
          '  in_scope:',
          '    - Updated retry logic',
          '  out_of_scope:',
          '    - Bulk reprocessing UI',
          'technical_requirements:',
          '  architecture_constraints:',
          '    - Must integrate with existing queue',
          '  data_model: []',
          '  api_contracts: []',
          '  security_constraints: []',
          '  performance_constraints: []',
          '  reliability_constraints: []',
          '  error_handling_rules: []',
          '  tooling_assumptions: []',
          'epics:',
          '  - id: E01',
          '    title: Retry infrastructure',
          '    objective: Build retry mechanism.',
          '    implementation_steps:',
          '      - Add retry queue',
          '    user_stories:',
          '      - id: E01-S01',
          '        title: Retry a failed import',
          '        acceptance_criteria:',
          '          - Import is retried',
          '        implementation_steps:',
          '          - Create retry handler',
          '        verification:',
          '          required_commands:',
          '            - npm test',
          'risks:',
          '  - Queue saturation',
          'approval:',
          "  approved_by: ''",
          "  approved_at: ''",
        ].join('\n'),
      }),
    })

    expect(response.status).toBe(200)
    expect(existsSync(beadsDir)).toBe(false)
    expect(getLatestPhaseArtifact(ticket.id, 'beads', 'DRAFTING_BEADS')).toBeUndefined()
    expect(getLatestPhaseArtifact(ticket.id, 'ui_state:approval_beads', 'UI_STATE')).toBeUndefined()
  })

  it('stamps PRD approval metadata through the generic approve route', async () => {
    const { app, ticket, paths } = setupPrdApprovalTicket()

    const response = await app.request(`/api/tickets/${ticket.id}/approve`, {
      method: 'POST',
    })

    expect(response.status).toBe(200)
    const payload = await response.json() as { message?: string; status?: string }
    expect(payload.message).toBe('PRD approved')
    expect(payload.status).toBe('DRAFTING_BEADS')

    const savedRaw = readFileSync(`${paths.ticketDir}/prd.yaml`, 'utf-8')
    expect(savedRaw).toContain('status: approved')
    expect(savedRaw).toContain('approved_by: user')
    expect(savedRaw).toMatch(/approved_at: .+/)
  })

  it('rejects approval when ticket is not in WAITING_PRD_APPROVAL status', async () => {
    const { app, ticket } = setupPrdApprovalTicket()

    patchTicket(ticket.id, { status: 'DRAFTING_PRD' })

    const response = await app.request(`/api/tickets/${ticket.id}/approve-prd`, {
      method: 'POST',
    })

    expect(response.status).toBe(409)
    const payload = await response.json() as { error: string }
    expect(payload.error).toContain('not waiting for PRD approval')
  })
})
