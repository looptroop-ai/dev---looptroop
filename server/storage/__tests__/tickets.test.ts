import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from '../../db/init'
import { sqlite } from '../../db/index'
import { clearProjectDatabaseCache } from '../../db/project'
import { readTicketMeta } from '../../ticket/metadata'
import { createFixtureRepoManager } from '../../test/fixtureRepo'
import { attachProject } from '../projects'
import { createTicket, getTicketByRef, lockTicketStartConfiguration, patchTicket } from '../tickets'

const repoManager = createFixtureRepoManager({
  templatePrefix: 'looptroop-ticket-lock-',
  files: {
    'README.md': '# LoopTroop Ticket Lock Test\n',
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
    repoManager.cleanup()
  })

  it('persists the started model selection into ticket metadata and blocks later model changes', () => {
    const repoDir = repoManager.createRepo()
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
