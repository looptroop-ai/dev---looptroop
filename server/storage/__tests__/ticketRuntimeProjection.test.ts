import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import yaml from 'js-yaml'
import type { Bead } from '../../phases/beads/types'
import { TEST } from '../../test/factories'
import { createInitializedTestTicket, createTestRepoManager, resetTestDb } from '../../test/integration'
import { patchTicket, getTicketPaths } from '../tickets'
import { syncTicketRuntimeProjection } from '../ticketRuntimeProjection'
import { writeTicketBeads } from '../../workflow/phases/beadsPhase'

const repoManager = createTestRepoManager('ticket-runtime-projection-')

function makeBead(overrides: Partial<Bead> = {}): Bead {
  return {
    id: 'bead-1',
    title: 'Projection bead',
    description: 'Verify projection output',
    status: 'pending',
    priority: 1,
    prdRefs: [],
    acceptanceCriteria: [],
    tests: [],
    testCommands: [],
    contextGuidance: { patterns: [], anti_patterns: [] },
    issueType: 'task',
    externalRef: TEST.externalId,
    labels: [],
    dependencies: { blocked_by: [], blocks: [] },
    targetFiles: [],
    notes: '',
    iteration: 0,
    createdAt: TEST.timestamp,
    updatedAt: TEST.timestamp,
    completedAt: '',
    startedAt: '',
    beadStartCommit: null,
    ...overrides,
  }
}

describe('ticket runtime projection', () => {
  beforeEach(() => {
    resetTestDb()
  })

  afterAll(() => {
    resetTestDb()
    repoManager.cleanup()
  })

  it('writes a rebuildable state.yaml projection from authoritative ticket and bead state', () => {
    const { ticket } = createInitializedTestTicket(repoManager, {
      title: 'Projection state',
    })
    patchTicket(ticket.id, {
      status: 'CODING',
      currentBead: 1,
      totalBeads: 1,
      percentComplete: 0,
    })
    writeTicketBeads(ticket.id, [
      makeBead({
        status: 'in_progress',
        iteration: 2,
        notes: 'retry with refreshed context',
      }),
    ])

    syncTicketRuntimeProjection(ticket.id)

    const paths = getTicketPaths(ticket.id)
    if (!paths) throw new Error('Ticket paths were not initialized')
    const statePath = `${paths.ticketDir}/runtime/state.yaml`
    const state = yaml.load(readFileSync(statePath, 'utf8')) as {
      ticket: { status: string }
      runtime: { activeBeadId: string | null; activeBeadIteration: number | null }
      beads: Array<{ id: string; notes: string }>
    }

    expect(state.ticket.status).toBe('CODING')
    expect(state.runtime.activeBeadId).toBe('bead-1')
    expect(state.runtime.activeBeadIteration).toBe(2)
    expect(state.beads[0]?.notes).toBe('retry with refreshed context')
  })

  it('removes state.yaml for terminal tickets', () => {
    const { ticket } = createInitializedTestTicket(repoManager, {
      title: 'Terminal projection',
    })
    syncTicketRuntimeProjection(ticket.id)

    const paths = getTicketPaths(ticket.id)
    if (!paths) throw new Error('Ticket paths were not initialized')
    const statePath = `${paths.ticketDir}/runtime/state.yaml`
    expect(existsSync(statePath)).toBe(true)

    patchTicket(ticket.id, { status: 'CANCELED' })
    syncTicketRuntimeProjection(ticket.id)

    expect(existsSync(statePath)).toBe(false)
  })
})
