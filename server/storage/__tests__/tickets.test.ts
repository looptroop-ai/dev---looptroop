import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from '../../db/init'
import { sqlite } from '../../db/index'
import { clearProjectDatabaseCache } from '../../db/project'
import { readTicketMeta } from '../../ticket/metadata'
import { createFixtureRepoManager } from '../../test/fixtureRepo'
import { attachProject } from '../projects'
import {
  createTicket,
  getTicketByRef,
  lockTicketStartConfiguration,
  patchTicket,
  recordTicketErrorOccurrence,
  resolveLatestTicketErrorOccurrence,
} from '../tickets'

const lockRepoManager = createFixtureRepoManager({
  templatePrefix: 'looptroop-ticket-lock-',
  files: {
    'README.md': '# LoopTroop Ticket Lock Test\n',
  },
})

const errorRepoManager = createFixtureRepoManager({
  templatePrefix: 'looptroop-ticket-error-',
  files: {
    'README.md': '# LoopTroop Ticket Error Test\n',
  },
})

describe('ticket start configuration locking', () => {
  beforeEach(() => {
    clearProjectDatabaseCache()
    initializeDatabase()
    sqlite.exec('DELETE FROM attached_projects; DELETE FROM profiles;')
  })

  afterAll(() => {
    clearProjectDatabaseCache()
    lockRepoManager.cleanup()
  })

  it('persists the started model selection into ticket metadata and blocks later model changes', () => {
    const repoDir = lockRepoManager.createRepo()
    const project = attachProject({
      folderPath: repoDir,
      name: 'LoopTroop',
      shortname: 'LOOP',
    })
    const ticket = createTicket({
      projectId: project.id,
      title: 'Freeze ticket council',
      description: 'Ticket models should lock when work starts.',
    })

    const startedAt = '2026-03-13T12:00:00.000Z'
    const lockedMainImplementer = 'openai/gpt-5-codex'
    const lockedCouncilMembers = ['openai/gpt-5-codex', 'openai/gpt-5-mini']

    const lockedTicket = lockTicketStartConfiguration(ticket.id, {
      branchName: ticket.externalId,
      startedAt,
      lockedMainImplementer,
      lockedCouncilMembers,
      lockedInterviewQuestions: 50,
      lockedCoverageFollowUpBudgetPercent: 20,
      lockedMaxCoveragePasses: 2,
    })

    expect(lockedTicket?.lockedMainImplementer).toBe(lockedMainImplementer)
    expect(lockedTicket?.lockedCouncilMembers).toEqual(lockedCouncilMembers)
    expect(lockedTicket?.lockedCoverageFollowUpBudgetPercent).toBe(20)
    expect(lockedTicket?.lockedMaxCoveragePasses).toBe(2)
    expect(lockedTicket?.startedAt).toBe(startedAt)

    const meta = readTicketMeta(repoDir, ticket.externalId)
    expect(meta.startedAt).toBe(startedAt)
    expect(meta.lockedMainImplementer).toBe(lockedMainImplementer)
    expect(meta.lockedCouncilMembers).toEqual(lockedCouncilMembers)

    const repeatedLock = lockTicketStartConfiguration(ticket.id, {
      branchName: ticket.externalId,
      startedAt: '2026-03-13T13:00:00.000Z',
      lockedMainImplementer,
      lockedCouncilMembers,
      lockedInterviewQuestions: 50,
      lockedCoverageFollowUpBudgetPercent: 20,
      lockedMaxCoveragePasses: 2,
    })

    expect(repeatedLock?.startedAt).toBe(startedAt)
    expect(readTicketMeta(repoDir, ticket.externalId).startedAt).toBe(startedAt)

    expect(() => patchTicket(ticket.id, {
      lockedMainImplementer: 'anthropic/claude-sonnet-4',
    })).toThrow(/immutable after start/i)

    expect(() => patchTicket(ticket.id, {
      lockedCouncilMembers: JSON.stringify(['openai/gpt-5-codex', 'anthropic/claude-sonnet-4']),
    })).toThrow(/immutable after start/i)

    const progressUpdate = patchTicket(ticket.id, {
      percentComplete: 25,
    })

    expect(progressUpdate?.percentComplete).toBe(25)
    expect(getTicketByRef(ticket.id)?.lockedCouncilMembers).toEqual(lockedCouncilMembers)
  })
})

describe('ticket error occurrences', () => {
  beforeEach(() => {
    clearProjectDatabaseCache()
    initializeDatabase()
    sqlite.exec('DELETE FROM attached_projects; DELETE FROM profiles;')
  })

  afterAll(() => {
    clearProjectDatabaseCache()
    errorRepoManager.cleanup()
  })

  it('records repeated block/retry cycles as append-only occurrences and exposes them on the public ticket', () => {
    const repoDir = errorRepoManager.createRepo()
    const project = attachProject({
      folderPath: repoDir,
      name: 'LoopTroop',
      shortname: 'LOOP',
    })
    const ticket = createTicket({
      projectId: project.id,
      title: 'Track repeated errors',
      description: 'Repeated block/retry cycles should keep historical incidents.',
    })

    const firstErrorAt = '2026-03-13T12:00:00.000Z'
    const firstBlocked = recordTicketErrorOccurrence(ticket.id, {
      blockedFromStatus: 'CODING',
      errorMessage: 'First blocking failure',
      errorCodes: ['FIRST_FAIL'],
      occurredAt: firstErrorAt,
    })
    expect(firstBlocked?.occurrenceNumber).toBe(1)

    patchTicket(ticket.id, {
      status: 'BLOCKED_ERROR',
      errorMessage: 'First blocking failure',
      xstateSnapshot: JSON.stringify({ context: { previousStatus: 'CODING' } }),
    })

    let publicTicket = getTicketByRef(ticket.id)
    expect(publicTicket?.status).toBe('BLOCKED_ERROR')
    expect(publicTicket?.previousStatus).toBe('CODING')
    expect(publicTicket?.reviewCutoffStatus).toBe('CODING')
    expect(publicTicket?.errorOccurrences).toHaveLength(1)
    expect(publicTicket?.activeErrorOccurrenceId).toBe(firstBlocked?.id)
    expect(publicTicket?.hasPastErrors).toBe(false)
    expect(publicTicket?.errorOccurrences[0]).toMatchObject({
      occurrenceNumber: 1,
      blockedFromStatus: 'CODING',
      errorMessage: 'First blocking failure',
      errorCodes: ['FIRST_FAIL'],
      occurredAt: firstErrorAt,
      resolvedAt: null,
      resolutionStatus: null,
      resumedToStatus: null,
    })

    resolveLatestTicketErrorOccurrence(ticket.id, {
      resolutionStatus: 'RETRIED',
      resumedToStatus: 'CODING',
      resolvedAt: '2026-03-13T12:05:00.000Z',
    })

    patchTicket(ticket.id, {
      status: 'CODING',
      errorMessage: null,
      xstateSnapshot: JSON.stringify({ context: { previousStatus: 'BLOCKED_ERROR' } }),
    })

    const secondErrorAt = '2026-03-13T12:10:00.000Z'
    const secondBlocked = recordTicketErrorOccurrence(ticket.id, {
      blockedFromStatus: 'REFINING_PRD',
      errorMessage: 'Second blocking failure',
      errorCodes: ['SECOND_FAIL'],
      occurredAt: secondErrorAt,
    })
    expect(secondBlocked?.occurrenceNumber).toBe(2)

    patchTicket(ticket.id, {
      status: 'BLOCKED_ERROR',
      errorMessage: 'Second blocking failure',
      xstateSnapshot: JSON.stringify({ context: { previousStatus: 'REFINING_PRD' } }),
    })

    publicTicket = getTicketByRef(ticket.id)
    expect(publicTicket?.errorOccurrences).toHaveLength(2)
    expect(publicTicket?.activeErrorOccurrenceId).toBe(secondBlocked?.id)
    expect(publicTicket?.hasPastErrors).toBe(true)
    expect(publicTicket?.errorOccurrences.map((occurrence) => occurrence.occurrenceNumber)).toEqual([1, 2])
    expect(publicTicket?.errorOccurrences[0]).toMatchObject({
      resolutionStatus: 'RETRIED',
      resumedToStatus: 'CODING',
      resolvedAt: '2026-03-13T12:05:00.000Z',
    })
    expect(publicTicket?.errorOccurrences[1]).toMatchObject({
      occurrenceNumber: 2,
      blockedFromStatus: 'REFINING_PRD',
      errorMessage: 'Second blocking failure',
      errorCodes: ['SECOND_FAIL'],
      resolvedAt: null,
      resolutionStatus: null,
      resumedToStatus: null,
    })

    resolveLatestTicketErrorOccurrence(ticket.id, {
      resolutionStatus: 'CANCELED',
      resumedToStatus: null,
      resolvedAt: '2026-03-13T12:12:00.000Z',
    })

    patchTicket(ticket.id, {
      status: 'CANCELED',
      errorMessage: null,
      xstateSnapshot: JSON.stringify({ context: { previousStatus: 'BLOCKED_ERROR' } }),
    })

    publicTicket = getTicketByRef(ticket.id)
    expect(publicTicket?.status).toBe('CANCELED')
    expect(publicTicket?.reviewCutoffStatus).toBe('REFINING_PRD')
    expect(publicTicket?.errorOccurrences[1]).toMatchObject({
      resolvedAt: '2026-03-13T12:12:00.000Z',
      resolutionStatus: 'CANCELED',
      resumedToStatus: null,
    })
  })
})
