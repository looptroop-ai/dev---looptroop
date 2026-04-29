import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { appendLogEvent } from '../../log/executionLog'
import { patchTicket, getTicketByRef, getTicketPaths } from '../../storage/tickets'
import { TEST, makeTicketContextFromTicket } from '../../test/factories'
import { createInitializedTestTicket, createTestRepoManager, resetTestDb } from '../../test/integration'
import { ensureActorForTicket, hydrateAllTickets, revertTicketToApprovalStatus, stopActor } from '../persistence'

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

  it('blocks a non-draft ticket instead of regressing to draft when its snapshot is corrupt', () => {
    const { ticket } = createInitializedTestTicket(repoManager, {
      title: 'Corrupt snapshot recovery',
    })

    patchTicket(ticket.id, {
      status: 'CODING',
      xstateSnapshot: '{not-json',
    })

    try {
      expect(hydrateAllTickets()).toBe(1)
      const recovered = getTicketByRef(ticket.id)
      expect(recovered?.status).toBe('BLOCKED_ERROR')
      expect(recovered?.previousStatus).toBe('CODING')
      expect(recovered?.errorMessage).toContain('workflow snapshot could not be restored safely')
      expect(recovered?.errorOccurrences.at(-1)?.errorCodes).toContain('SNAPSHOT_RECOVERY_FAILED')
    } finally {
      stopActor(ticket.id)
    }
  })

  it('reconstructs a missing active snapshot from the durable ticket status', () => {
    const { ticket } = createInitializedTestTicket(repoManager, {
      title: 'Missing snapshot recovery',
    })

    patchTicket(ticket.id, {
      status: 'WAITING_PR_REVIEW',
      xstateSnapshot: null,
    })

    try {
      expect(hydrateAllTickets()).toBe(1)
      const recovered = getTicketByRef(ticket.id)
      expect(recovered?.status).toBe('WAITING_PR_REVIEW')
      expect(recovered?.xstateSnapshot).toContain('WAITING_PR_REVIEW')
    } finally {
      stopActor(ticket.id)
    }
  })

  it('persists a planning edit rewind when reverting an active actor to approval', () => {
    const { ticket, paths } = createInitializedTestTicket(repoManager, {
      title: 'Persist planning edit rewind',
    })

    const snapshot = {
      status: 'active',
      value: 'REFINING_PRD',
      historyValue: {},
      context: makeTicketContextFromTicket(ticket, {
        status: 'REFINING_PRD',
        previousStatus: 'COUNCIL_VOTING_PRD',
      }),
      children: {},
    }

    patchTicket(ticket.id, {
      status: 'REFINING_PRD',
      xstateSnapshot: JSON.stringify(snapshot),
    })

    try {
      expect(ensureActorForTicket(ticket.id).getSnapshot().value).toBe('REFINING_PRD')

      const rewoundActor = revertTicketToApprovalStatus(ticket.id, 'WAITING_INTERVIEW_APPROVAL')
      expect(rewoundActor.getSnapshot().value).toBe('WAITING_INTERVIEW_APPROVAL')

      const rewound = getTicketByRef(ticket.id)
      expect(rewound?.status).toBe('WAITING_INTERVIEW_APPROVAL')
      expect(rewound?.xstateSnapshot).toContain('WAITING_INTERVIEW_APPROVAL')

      const persistedSnapshot = JSON.parse(rewound?.xstateSnapshot ?? '{}') as {
        value?: string
        context?: { status?: string; previousStatus?: string }
      }
      expect(persistedSnapshot.value).toBe('WAITING_INTERVIEW_APPROVAL')
      expect(persistedSnapshot.context?.status).toBe('WAITING_INTERVIEW_APPROVAL')
      expect(persistedSnapshot.context?.previousStatus).toBe('REFINING_PRD')
      expect(readFileSync(`${paths.ticketDir}/runtime/state.yaml`, 'utf8')).toContain('status: WAITING_INTERVIEW_APPROVAL')
    } finally {
      stopActor(ticket.id)
    }
  })
})
