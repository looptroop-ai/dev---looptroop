import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { appendLogEvent } from '../../log/executionLog'
import { patchTicket, getTicketPaths } from '../../storage/tickets'
import { TEST, makeTicketContextFromTicket } from '../../test/factories'
import { createInitializedTestTicket, createTestRepoManager, resetTestDb } from '../../test/integration'
import { hydrateAllTickets, stopActor } from '../persistence'

vi.mock('../../workflow/runner', () => ({
  attachWorkflowRunner: vi.fn(),
}))

const repoManager = createTestRepoManager('persistence-')

describe('hydrateAllTickets', () => {
  beforeEach(() => {
    resetTestDb()
    vi.clearAllMocks()
  })

  afterAll(() => {
    resetTestDb()
    repoManager.cleanup()
  })

  it('does not append active-state log noise when restoring a paused ticket', () => {
    const { ticket } = createInitializedTestTicket(repoManager, {
      title: 'Hydrated review pause',
    })

    appendLogEvent(
      ticket.id,
      'info',
      'WAITING_PR_REVIEW',
      '[SYS] Draft pull request ready.',
      { timestamp: TEST.timestamp },
      'system',
      'WAITING_PR_REVIEW',
    )

    const snapshot = {
      status: 'active',
      value: 'WAITING_PR_REVIEW',
      historyValue: {},
      context: makeTicketContextFromTicket(ticket, {
        status: 'WAITING_PR_REVIEW',
        previousStatus: 'CREATING_PULL_REQUEST',
      }),
      children: {},
    }

    patchTicket(ticket.id, {
      status: 'WAITING_PR_REVIEW',
      xstateSnapshot: JSON.stringify(snapshot),
    })

    const paths = getTicketPaths(ticket.id)
    if (!paths || !existsSync(paths.executionLogPath)) {
      throw new Error('Execution log path was not initialized')
    }

    const beforeHydration = readFileSync(paths.executionLogPath, 'utf8')

    try {
      expect(hydrateAllTickets()).toBe(1)
      expect(readFileSync(paths.executionLogPath, 'utf8')).toBe(beforeHydration)
    } finally {
      stopActor(ticket.id)
    }
  })
})
