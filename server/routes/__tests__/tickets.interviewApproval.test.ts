import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { existsSync, readFileSync } from 'node:fs'
import { initializeDatabase } from '../../db/init'
import { sqlite } from '../../db/index'
import { clearProjectDatabaseCache } from '../../db/project'
import { safeAtomicWrite } from '../../io/atomicWrite'
import { attachProject } from '../../storage/projects'
import {
  createTicket,
  createFreshPhaseAttempts,
  getLatestPhaseArtifact,
  getTicketByRef,
  getTicketPaths,
  INTERVIEW_EDIT_RESTART_PHASES,
  patchTicket,
  upsertLatestPhaseArtifact,
} from '../../storage/tickets'
import { createFixtureRepoManager } from '../../test/fixtureRepo'
import { initializeTicket } from '../../ticket/initialize'
import { buildInterviewDocumentYaml } from '../../structuredOutput'
import { ticketRouter } from '../tickets'
import { buildInterviewDocument } from '../../test/factories'
import type { InterviewDocument } from '@shared/interviewArtifact'

vi.mock('../../machines/persistence', async () => {
  const storage = await import('../../storage/tickets')

  return {
    createTicketActor: vi.fn(),
    ensureActorForTicket: vi.fn(() => ({ id: 'mock-actor' })),
    revertTicketToApprovalStatus: vi.fn((ticketRef: string | number, status: string) => {
      storage.patchTicket(String(ticketRef), { status })
      return { id: 'mock-actor', status }
    }),
    sendTicketEvent: vi.fn((ticketRef: string | number, event: { type: string }) => {
      if (event.type === 'APPROVE') {
        storage.patchTicket(String(ticketRef), { status: 'DRAFTING_PRD' })
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

const repoManager = createFixtureRepoManager({
  templatePrefix: 'looptroop-ticket-route-interview-approval-',
  files: {
    'README.md': '# LoopTroop Interview Approval Test\n',
  },
})

function setupApprovalTicket() {
  const repoDir = repoManager.createRepo()
  const project = attachProject({
    folderPath: repoDir,
    name: 'LoopTroop',
    shortname: 'LOOP',
  })
  const ticket = createTicket({
    projectId: project.id,
    title: 'Interview approval',
    description: 'Verify the interview approval routes.',
  })

  const init = initializeTicket({
    projectFolder: repoDir,
    externalId: ticket.externalId,
  })

  patchTicket(ticket.id, {
    status: 'WAITING_INTERVIEW_APPROVAL',
    branchName: init.branchName,
  })

  const paths = getTicketPaths(ticket.id)
  if (!paths) {
    throw new Error('Ticket workspace not initialized')
  }

  const document = buildInterviewDocument(ticket.externalId, 'draft')
  const raw = buildInterviewDocumentYaml(document)
  safeAtomicWrite(`${paths.ticketDir}/interview.yaml`, raw)

  const app = new Hono()
  app.route('/api', ticketRouter)

  return { app, ticket, paths, document, raw }
}

describe('ticketRouter interview approval routes', () => {
  beforeEach(() => {
    clearProjectDatabaseCache()
    initializeDatabase()
    sqlite.exec('DELETE FROM attached_projects; DELETE FROM profiles;')
  })

  afterAll(() => {
    clearProjectDatabaseCache()
    repoManager.cleanup()
  })

  it('saves answer-only edits, rewrites canonical YAML, and clears downstream planning artifacts', async () => {
    const { app, ticket, paths } = setupApprovalTicket()

    safeAtomicWrite(`${paths.ticketDir}/prd.yaml`, 'artifact: prd\n')
    upsertLatestPhaseArtifact(ticket.id, 'prd', 'WAITING_PRD_APPROVAL', 'artifact: prd\n')
    upsertLatestPhaseArtifact(ticket.id, 'ui_state:approval_prd', 'UI_STATE', '{"data":{"editMode":true}}')

    const response = await app.request(`/api/tickets/${ticket.id}/interview-answers`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questions: [
          {
            id: 'Q01',
            answer: {
              skipped: false,
              selected_option_ids: [],
              free_text: 'Protect the import pipeline and keep logs reversible.',
            },
          },
          {
            id: 'FINAL',
            answer: {
              skipped: false,
              selected_option_ids: [],
              free_text: 'Keep retries observable and reviewable.',
            },
          },
        ],
      }),
    })

    expect(response.status).toBe(200)
    const payload = await response.json() as {
      success: boolean
      document: InterviewDocument
      raw: string
    }

    expect(payload.success).toBe(true)
    expect(payload.document.status).toBe('draft')
    expect(payload.document.approval).toEqual({
      approved_by: '',
      approved_at: '',
    })
    expect(payload.document.summary.final_free_form_answer).toBe('Keep retries observable and reviewable.')

    const savedRaw = readFileSync(`${paths.ticketDir}/interview.yaml`, 'utf-8')
    expect(savedRaw).toContain('status: draft')
    expect(savedRaw).toContain('free_text: Keep retries observable and reviewable.')
    expect(existsSync(`${paths.ticketDir}/prd.yaml`)).toBe(false)
    expect(getLatestPhaseArtifact(ticket.id, 'prd', 'WAITING_PRD_APPROVAL')).toBeUndefined()
    expect(getLatestPhaseArtifact(ticket.id, 'ui_state:approval_prd', 'UI_STATE')).toBeUndefined()
  })

  it('archives approval and PRD attempts, clears stale PRD state, approves the edit, and starts PRD drafting', async () => {
    const { app, ticket, paths, raw } = setupApprovalTicket()
    upsertLatestPhaseArtifact(
      ticket.id,
      'approval_snapshot:interview',
      'WAITING_INTERVIEW_APPROVAL',
      JSON.stringify({ raw }),
    )
    patchTicket(ticket.id, { status: 'REFINING_PRD' })
    createFreshPhaseAttempts(ticket.id, INTERVIEW_EDIT_RESTART_PHASES)

    safeAtomicWrite(`${paths.ticketDir}/prd.yaml`, 'artifact: prd\n')
    upsertLatestPhaseArtifact(ticket.id, 'prd', 'WAITING_PRD_APPROVAL', 'artifact: prd\n')
    upsertLatestPhaseArtifact(ticket.id, 'ui_state:approval_prd', 'UI_STATE', '{"data":{"editMode":true}}')
    upsertLatestPhaseArtifact(
      ticket.id,
      'approval_snapshot:prd',
      'WAITING_PRD_APPROVAL',
      JSON.stringify({ raw: 'artifact: prd\nstatus: approved\n' }),
    )

    const response = await app.request(`/api/tickets/${ticket.id}/interview-answers`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questions: [
          {
            id: 'Q01',
            answer: {
              skipped: false,
              selected_option_ids: [],
              free_text: 'Restart PRD planning from corrected interview answers.',
            },
          },
        ],
      }),
    })

    expect(response.status).toBe(200)
    const payload = await response.json() as {
      success: boolean
      document: InterviewDocument
      status?: string
    }
    expect(payload.success).toBe(true)
    expect(payload.document.status).toBe('approved')
    expect(payload.document.approval.approved_by).toBe('user')
    expect(payload.document.approval.approved_at).toEqual(expect.any(String))
    expect(payload.status).toBe('DRAFTING_PRD')
    expect(payload.document.questions.find((question) => question.id === 'Q01')?.answer.free_text)
      .toBe('Restart PRD planning from corrected interview answers.')

    const savedRaw = readFileSync(`${paths.ticketDir}/interview.yaml`, 'utf-8')
    expect(savedRaw).toContain('status: approved')
    expect(savedRaw).toContain('free_text: Restart PRD planning from corrected interview answers.')
    expect(existsSync(`${paths.ticketDir}/prd.yaml`)).toBe(false)
    expect(getLatestPhaseArtifact(ticket.id, 'prd', 'WAITING_PRD_APPROVAL')).toBeUndefined()
    expect(getLatestPhaseArtifact(ticket.id, 'ui_state:approval_prd', 'UI_STATE')).toBeUndefined()

    const interviewAttemptsResponse = await app.request(`/api/tickets/${ticket.id}/phases/WAITING_INTERVIEW_APPROVAL/attempts`)
    expect(interviewAttemptsResponse.status).toBe(200)
    const interviewAttempts = await interviewAttemptsResponse.json() as Array<{ attemptNumber: number; state: string; archivedReason: string | null }>
    expect(interviewAttempts[0]).toMatchObject({ attemptNumber: 2, state: 'active' })
    expect(interviewAttempts[1]).toMatchObject({
      attemptNumber: 1,
      state: 'archived',
      archivedReason: 'interview_edit_restart',
    })

    const archivedInterviewArtifactsResponse = await app.request(`/api/tickets/${ticket.id}/artifacts?phase=WAITING_INTERVIEW_APPROVAL&phaseAttempt=1`)
    expect(archivedInterviewArtifactsResponse.status).toBe(200)
    const archivedInterviewArtifacts = await archivedInterviewArtifactsResponse.json() as Array<{ artifactType: string; phaseAttempt: number }>
    expect(archivedInterviewArtifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        artifactType: 'approval_snapshot:interview',
        phaseAttempt: 1,
      }),
    ]))

    const attemptsResponse = await app.request(`/api/tickets/${ticket.id}/phases/WAITING_PRD_APPROVAL/attempts`)
    expect(attemptsResponse.status).toBe(200)
    const attempts = await attemptsResponse.json() as Array<{ attemptNumber: number; state: string; archivedReason: string | null }>
    expect(attempts[0]).toMatchObject({ attemptNumber: 2, state: 'active' })
    expect(attempts[1]).toMatchObject({
      attemptNumber: 1,
      state: 'archived',
      archivedReason: 'interview_edit_restart',
    })

    const defaultArtifactsResponse = await app.request(`/api/tickets/${ticket.id}/artifacts?phase=WAITING_PRD_APPROVAL`)
    expect(defaultArtifactsResponse.status).toBe(200)
    const defaultArtifacts = await defaultArtifactsResponse.json() as Array<{ artifactType: string }>
    expect(defaultArtifacts).toEqual([])

    const archivedArtifactsResponse = await app.request(`/api/tickets/${ticket.id}/artifacts?phase=WAITING_PRD_APPROVAL&phaseAttempt=1`)
    expect(archivedArtifactsResponse.status).toBe(200)
    const archivedArtifacts = await archivedArtifactsResponse.json() as Array<{ artifactType: string; phaseAttempt: number }>
    expect(archivedArtifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        artifactType: 'approval_snapshot:prd',
        phaseAttempt: 1,
      }),
    ]))
  })

  it('does not archive attempts when a post-approval interview edit is invalid', async () => {
    const { app, ticket } = setupApprovalTicket()
    patchTicket(ticket.id, { status: 'REFINING_PRD' })
    createFreshPhaseAttempts(ticket.id, INTERVIEW_EDIT_RESTART_PHASES)

    const response = await app.request(`/api/tickets/${ticket.id}/interview`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'artifact: interview\nquestions: [',
      }),
    })

    expect(response.status).toBe(400)
    expect(getTicketByRef(ticket.id)?.status).toBe('REFINING_PRD')

    const attemptsResponse = await app.request(`/api/tickets/${ticket.id}/phases/WAITING_INTERVIEW_APPROVAL/attempts`)
    expect(attemptsResponse.status).toBe(200)
    const attempts = await attemptsResponse.json() as Array<{ attemptNumber: number; state: string; archivedReason: string | null }>
    expect(attempts).toEqual([
      expect.objectContaining({ attemptNumber: 1, state: 'active', archivedReason: null }),
    ])
  })

  it('rejects interview answer edits at pre-flight or later', async () => {
    const { app, ticket } = setupApprovalTicket()
    patchTicket(ticket.id, { status: 'PRE_FLIGHT_CHECK' })

    const response = await app.request(`/api/tickets/${ticket.id}/interview-answers`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questions: [
          {
            id: 'Q01',
            answer: {
              skipped: false,
              selected_option_ids: [],
              free_text: 'Too late to edit interview answers.',
            },
          },
        ],
      }),
    })

    expect(response.status).toBe(409)
  })

  it('rejects raw interview edits at pre-flight or later', async () => {
    const { app, ticket, raw } = setupApprovalTicket()
    patchTicket(ticket.id, { status: 'PRE_FLIGHT_CHECK' })

    const response = await app.request(`/api/tickets/${ticket.id}/interview`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: raw,
      }),
    })

    expect(response.status).toBe(409)
  })

  it('rejects invalid answer-only payloads', async () => {
    const { app, ticket, raw, paths } = setupApprovalTicket()

    const response = await app.request(`/api/tickets/${ticket.id}/interview-answers`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questions: [
          {
            id: 'Q01',
            answer: {
              skipped: false,
              selected_option_ids: 'yes',
              free_text: '',
            },
          },
        ],
      }),
    })

    expect(response.status).toBe(400)
    const savedRaw = readFileSync(`${paths.ticketDir}/interview.yaml`, 'utf-8')
    expect(savedRaw).toBe(raw)
  })

  it('validates raw interview YAML, canonicalizes it, and forces draft status', async () => {
    const { app, ticket, paths } = setupApprovalTicket()

    const response = await app.request(`/api/tickets/${ticket.id}/interview`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: [
          'schema_version: 1',
          'ticket_id: WRONG-ID',
          'artifact: interview_results',
          'status: approved',
          'generated_by:',
          '  winner_model: openai/gpt-5',
          '  generated_at: 2026-03-20T10:00:00.000Z',
          'questions:',
          '  - id: Q01',
          '    phase: foundation',
          '    prompt: What outcome matters most?',
          '    source: compiled',
          '    answer_type: yes_no',
          '    answer:',
          '      skipped: false',
          '      selected_option_ids: [yes]',
          '      free_text: ""',
          '  - id: FINAL',
          '    phase: assembly',
          '    prompt: Anything else the team should know?',
          '    source: final_free_form',
          '    answer_type: free_text',
          '    answer:',
          '      skipped: false',
          '      selected_option_ids: []',
          '      free_text: Keep retries observable from YAML.',
          'follow_up_rounds: []',
          'summary:',
          '  goals: [Protect imports]',
          '  constraints: [No duplicate records]',
          '  non_goals: [Bulk reprocessing]',
          '  final_free_form_answer: stale',
          'approval:',
          '  approved_by: user',
          '  approved_at: 2026-03-20T10:10:00.000Z',
        ].join('\n'),
      }),
    })

    expect(response.status).toBe(200)
    const payload = await response.json() as { document: InterviewDocument; raw: string }

    expect(payload.document.ticket_id).toBe(ticket.externalId)
    expect(payload.document.artifact).toBe('interview')
    expect(payload.document.status).toBe('draft')
    expect(payload.document.approval).toEqual({
      approved_by: '',
      approved_at: '',
    })
    expect(payload.document.questions[0]?.answer_type).toBe('single_choice')
    expect(payload.document.questions[0]?.options).toEqual([
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
    ])
    expect(payload.document.summary.final_free_form_answer).toBe('Keep retries observable from YAML.')

    const savedRaw = readFileSync(`${paths.ticketDir}/interview.yaml`, 'utf-8')
    expect(savedRaw).toContain(`ticket_id: ${ticket.externalId}`)
    expect(savedRaw).toContain('status: draft')
    expect(savedRaw).toContain('artifact: interview')
  })

  it('rejects invalid raw interview YAML without overwriting the current artifact', async () => {
    const { app, ticket, raw, paths } = setupApprovalTicket()

    const response = await app.request(`/api/tickets/${ticket.id}/interview`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'artifact: interview\nquestions: [',
      }),
    })

    expect(response.status).toBe(400)
    const savedRaw = readFileSync(`${paths.ticketDir}/interview.yaml`, 'utf-8')
    expect(savedRaw).toBe(raw)
  })

  it('approves the interview, stamps approval metadata, and advances the ticket', async () => {
    const { app, ticket, paths } = setupApprovalTicket()

    const response = await app.request(`/api/tickets/${ticket.id}/approve-interview`, {
      method: 'POST',
    })

    expect(response.status).toBe(200)
    const payload = await response.json() as { status?: string; message?: string }
    expect(payload.message).toBe('Interview approved')
    expect(payload.status).toBe('DRAFTING_PRD')

    const savedRaw = readFileSync(`${paths.ticketDir}/interview.yaml`, 'utf-8')
    expect(savedRaw).toContain('status: approved')
    expect(savedRaw).toContain('approved_by: user')
    expect(savedRaw).toMatch(/approved_at: .+/)
  })
})
