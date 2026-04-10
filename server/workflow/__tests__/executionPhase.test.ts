import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Bead } from '../../phases/beads/types'
import { createInitializedTestTicket, createTestRepoManager, makeTicketContextFromTicket, resetTestDb } from '../../test/factories'
import { getLatestPhaseArtifact } from '../../storage/tickets'
import { readTicketBeads, recoverFailedCodingBead, writeTicketBeads } from '../phases/beadsPhase'
import { phaseIntermediate, phaseResults } from '../phases/state'

const {
  executeBeadMock,
  recordBeadStartCommitMock,
  commitBeadChangesMock,
  resetToBeadStartMock,
  captureBeadDiffMock,
  assembleBeadContextMock,
  isMockOpenCodeModeMock,
  broadcastMock,
} = vi.hoisted(() => ({
  executeBeadMock: vi.fn(),
  recordBeadStartCommitMock: vi.fn(),
  commitBeadChangesMock: vi.fn(),
  resetToBeadStartMock: vi.fn(),
  captureBeadDiffMock: vi.fn(),
  assembleBeadContextMock: vi.fn(),
  isMockOpenCodeModeMock: vi.fn(),
  broadcastMock: vi.fn(),
}))

vi.mock('../../opencode/factory', () => ({
  getOpenCodeAdapter: () => ({}),
  isMockOpenCodeMode: isMockOpenCodeModeMock,
}))

vi.mock('../../phases/execution/executor', () => ({
  executeBead: executeBeadMock,
}))

vi.mock('../../phases/execution/gitOps', () => ({
  recordBeadStartCommit: recordBeadStartCommitMock,
  commitBeadChanges: commitBeadChangesMock,
  resetToBeadStart: resetToBeadStartMock,
  captureBeadDiff: captureBeadDiffMock,
}))

vi.mock('../phases/state', async () => {
  const actual = await vi.importActual<typeof import('../phases/state')>('../phases/state')
  return {
    ...actual,
    adapter: {
      assembleBeadContext: assembleBeadContextMock,
    },
  }
})

vi.mock('../../sse/broadcaster', () => ({
  broadcaster: {
    broadcast: broadcastMock,
  },
  SSEBroadcaster: class {},
}))

import { handleCoding } from '../phases/executionPhase'

const repoManager = createTestRepoManager('execution-phase-')

function makePendingBead(id: string, priority: number, extra: Partial<Bead> = {}): Bead {
  return {
    id,
    title: `Bead ${id}`,
    description: `Test bead ${id}`,
    status: 'pending',
    priority,
    prdRefs: [],
    acceptanceCriteria: [],
    tests: [],
    testCommands: [],
    contextGuidance: { patterns: [], anti_patterns: [] },
    issueType: 'task',
    externalRef: 'TEST-1',
    labels: [],
    dependencies: { blocked_by: [], blocks: [] },
    targetFiles: [],
    notes: '',
    iteration: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '',
    startedAt: '',
    beadStartCommit: null,
    ...extra,
  }
}

function makeDoneBead(id: string, priority: number): Bead {
  return makePendingBead(id, priority, {
    status: 'done',
    completedAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    iteration: 1,
  })
}

describe('handleCoding', () => {
  beforeEach(() => {
    resetTestDb()
    phaseIntermediate.clear()
    phaseResults.clear()
    executeBeadMock.mockReset()
    recordBeadStartCommitMock.mockReset()
    commitBeadChangesMock.mockReset()
    resetToBeadStartMock.mockReset()
    captureBeadDiffMock.mockReset()
    assembleBeadContextMock.mockReset()
    isMockOpenCodeModeMock.mockReset()
    broadcastMock.mockReset()

    // Deterministic defaults
    isMockOpenCodeModeMock.mockReturnValue(false)
    recordBeadStartCommitMock.mockReturnValue('abc123')
    commitBeadChangesMock.mockReturnValue({ committed: true, pushed: false })
    captureBeadDiffMock.mockReturnValue('diff --git a/file.ts b/file.ts')
    assembleBeadContextMock.mockResolvedValue([])
  })

  afterAll(() => {
    resetTestDb()
    repoManager.cleanup()
  })

  it('sends ALL_BEADS_DONE immediately when all beads are already done', async () => {
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'All beads done shortcut',
    })
    writeTicketBeads(ticket.id, [
      makeDoneBead('bead-1', 1),
      makeDoneBead('bead-2', 2),
    ])
    const sendEvent = vi.fn()

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    expect(sendEvent).toHaveBeenCalledWith({ type: 'ALL_BEADS_DONE' })
    expect(executeBeadMock).not.toHaveBeenCalled()
  })

  it('sends ERROR event and returns when mock mode is active', async () => {
    isMockOpenCodeModeMock.mockReturnValue(true)
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Mock mode unsupported',
    })
    writeTicketBeads(ticket.id, [makePendingBead('bead-1', 1)])
    const sendEvent = vi.fn()

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    expect(sendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ERROR', codes: ['MOCK_EXECUTION_UNSUPPORTED'] }),
    )
    expect(executeBeadMock).not.toHaveBeenCalled()
  })

  it('sends BEAD_COMPLETE when one bead succeeds with more beads still pending', async () => {
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Bead success with more pending',
    })
    writeTicketBeads(ticket.id, [
      makePendingBead('bead-1', 1),
      makePendingBead('bead-2', 2),
    ])
    const sendEvent = vi.fn()

    executeBeadMock.mockResolvedValueOnce({
      success: true,
      beadId: 'bead-1',
      iteration: 1,
      output: 'done',
      errors: [],
    })

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    expect(sendEvent).toHaveBeenCalledWith({ type: 'BEAD_COMPLETE' })
    expect(sendEvent).not.toHaveBeenCalledWith({ type: 'ALL_BEADS_DONE' })

    // Verify the lowest-priority bead was executed first
    const executedBead = executeBeadMock.mock.calls[0]![1] as Bead
    expect(executedBead.id).toBe('bead-1')
  })

  it('sends ALL_BEADS_DONE when the last pending bead succeeds', async () => {
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Last bead success',
    })
    writeTicketBeads(ticket.id, [makePendingBead('bead-1', 1)])
    const sendEvent = vi.fn()

    executeBeadMock.mockResolvedValueOnce({
      success: true,
      beadId: 'bead-1',
      iteration: 1,
      output: 'done',
      errors: [],
    })

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    expect(sendEvent).toHaveBeenCalledWith({ type: 'ALL_BEADS_DONE' })
    expect(sendEvent).not.toHaveBeenCalledWith({ type: 'BEAD_COMPLETE' })

    const finalBeads = readTicketBeads(ticket.id)
    expect(finalBeads.find((b) => b.id === 'bead-1')?.status).toBe('done')
  })

  it('sends BEAD_ERROR and does not commit when executeBead fails', async () => {
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Bead execution failure',
    })
    writeTicketBeads(ticket.id, [makePendingBead('bead-1', 1)])
    const sendEvent = vi.fn()

    executeBeadMock.mockResolvedValueOnce({
      success: false,
      beadId: 'bead-1',
      iteration: 2,
      output: '',
      errors: ['typecheck failed'],
    })

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    expect(sendEvent).toHaveBeenCalledWith({ type: 'BEAD_ERROR' })
    expect(sendEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'BEAD_COMPLETE' }))
    expect(sendEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ALL_BEADS_DONE' }))
    expect(commitBeadChangesMock).not.toHaveBeenCalled()
    expect(captureBeadDiffMock).not.toHaveBeenCalled()
    expect(broadcastMock).not.toHaveBeenCalledWith(
      expect.anything(),
      'bead_complete',
      expect.anything(),
    )

    const finalBeads = readTicketBeads(ticket.id)
    expect(finalBeads.find((b) => b.id === 'bead-1')?.status).toBe('error')
  })

  it('invokes resetToBeadStart and persists notes through the fresh-reload when onContextWipe fires', async () => {
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Notes updated triggers reset',
    })
    writeTicketBeads(ticket.id, [makePendingBead('bead-1', 1)])
    const sendEvent = vi.fn()

    executeBeadMock.mockImplementationOnce(async (
      _adapter: unknown,
      _bead: unknown,
      _contextParts: unknown,
      _worktreePath: unknown,
      _maxIterations: unknown,
      _perIterationTimeoutMs: unknown,
      _signal: unknown,
      callbacks: {
        ticketId: string
        model: string
        onContextWipe: (entry: { beadId: string; notes: string; iteration: number }) => Promise<void>
      },
    ) => {
      // Simulate context wipe persistence before executeBead returns.
      await callbacks.onContextWipe({
        beadId: 'bead-1',
        notes: 'context wiped — retrying with notes',
        iteration: 1,
      })
      return {
        success: true,
        beadId: 'bead-1',
        iteration: 1,
        output: 'done',
        errors: [],
      }
    })

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    expect(resetToBeadStartMock).toHaveBeenCalledWith(expect.any(String), 'abc123')

    // The fresh-reload in handleCoding must not wipe callback-persisted notes.
    const finalBeads = readTicketBeads(ticket.id)
    const executedBead = finalBeads.find((b) => b.id === 'bead-1')
    expect(executedBead?.notes).toBe('context wiped — retrying with notes')
    expect(executedBead?.status).toBe('done')
  })

  it('preserves retry notes and iteration when resetToBeadStart fails during context wipe', async () => {
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Reset failure preserves retry metadata',
    })
    writeTicketBeads(ticket.id, [makePendingBead('bead-1', 1, { iteration: 1 })])
    const sendEvent = vi.fn()

    resetToBeadStartMock.mockImplementation(() => {
      throw new Error('spawnSync git ENOBUFS')
    })

    executeBeadMock.mockImplementationOnce(async (
      _adapter: unknown,
      _bead: unknown,
      _contextParts: unknown,
      _worktreePath: unknown,
      _maxIterations: unknown,
      _perIterationTimeoutMs: unknown,
      _signal: unknown,
      callbacks: {
        onSessionCreated?: (sessionId: string, iteration: number) => void
        onContextWipe: (entry: { beadId: string; notes: string; iteration: number }) => Promise<void>
      },
    ) => {
      callbacks.onSessionCreated?.('session-2', 2)
      await expect(callbacks.onContextWipe({
        beadId: 'bead-1',
        notes: 'retry note after timeout',
        iteration: 2,
      })).rejects.toThrow('spawnSync git ENOBUFS')
      throw new Error('spawnSync git ENOBUFS')
    })

    await expect(
      handleCoding(ticket.id, context, sendEvent, new AbortController().signal),
    ).rejects.toThrow('spawnSync git ENOBUFS')

    const finalBeads = readTicketBeads(ticket.id)
    const executedBead = finalBeads.find((b) => b.id === 'bead-1')
    expect(executedBead?.status).toBe('error')
    expect(executedBead?.iteration).toBe(2)
    expect(executedBead?.notes).toBe('retry note after timeout')

    const recoveredBead = recoverFailedCodingBead(ticket.id)
    expect(recoveredBead?.id).toBe('bead-1')
    expect(recoveredBead?.status).toBe('pending')
    expect(recoveredBead?.iteration).toBe(2)
    expect(recoveredBead?.notes).toBe('retry note after timeout')
  })

  // --- Throw paths ---

  it('throws when there are no beads', async () => {
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'No beads throw',
    })
    // Beads file is empty (no writeTicketBeads call)
    const sendEvent = vi.fn()

    await expect(
      handleCoding(ticket.id, context, sendEvent, new AbortController().signal),
    ).rejects.toThrow('No beads available for execution')
    expect(executeBeadMock).not.toHaveBeenCalled()
  })

  it('throws when no runnable bead exists due to unresolved dependencies', async () => {
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Blocked bead throw',
    })
    // bead-2 is blocked by bead-1 which is not done (not even present)
    writeTicketBeads(ticket.id, [
      makePendingBead('bead-2', 1, {
        dependencies: { blocked_by: ['bead-1'], blocks: [] },
      }),
    ])
    const sendEvent = vi.fn()

    await expect(
      handleCoding(ticket.id, context, sendEvent, new AbortController().signal),
    ).rejects.toThrow('No runnable bead found; unresolved dependencies remain')
    expect(executeBeadMock).not.toHaveBeenCalled()
  })

  it('throws when lockedMainImplementer is missing', async () => {
    const { ticket } = createInitializedTestTicket(repoManager, {
      title: 'Missing implementer throw',
    })
    const context = makeTicketContextFromTicket(ticket, { lockedMainImplementer: null })
    writeTicketBeads(ticket.id, [makePendingBead('bead-1', 1)])
    const sendEvent = vi.fn()

    await expect(
      handleCoding(ticket.id, context, sendEvent, new AbortController().signal),
    ).rejects.toThrow('No locked main implementer is configured for coding')
    expect(executeBeadMock).not.toHaveBeenCalled()
  })

  // --- Artifact assertions ---

  it('inserts bead_execution artifact on success and bead_diff when beadStartCommit is available', async () => {
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Success artifacts',
    })
    writeTicketBeads(ticket.id, [makePendingBead('bead-1', 1)])
    const sendEvent = vi.fn()

    executeBeadMock.mockResolvedValueOnce({
      success: true,
      beadId: 'bead-1',
      iteration: 1,
      output: 'done',
      errors: [],
    })

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    const execArtifact = getLatestPhaseArtifact(ticket.id, 'bead_execution:bead-1', 'CODING')
    expect(execArtifact).toBeDefined()
    const execPayload = JSON.parse(execArtifact!.content) as { success: boolean; beadId: string }
    expect(execPayload.success).toBe(true)
    expect(execPayload.beadId).toBe('bead-1')

    const diffArtifact = getLatestPhaseArtifact(ticket.id, 'bead_diff:bead-1', 'CODING')
    expect(diffArtifact).toBeDefined()
    expect(diffArtifact!.content).toBe('diff --git a/file.ts b/file.ts')
  })

  it('inserts bead_execution artifact on failure but does not insert bead_diff', async () => {
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Failure artifacts',
    })
    writeTicketBeads(ticket.id, [makePendingBead('bead-1', 1)])
    const sendEvent = vi.fn()

    executeBeadMock.mockResolvedValueOnce({
      success: false,
      beadId: 'bead-1',
      iteration: 1,
      output: '',
      errors: ['lint failed'],
    })

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    const execArtifact = getLatestPhaseArtifact(ticket.id, 'bead_execution:bead-1', 'CODING')
    expect(execArtifact).toBeDefined()
    const execPayload = JSON.parse(execArtifact!.content) as { success: boolean }
    expect(execPayload.success).toBe(false)

    const diffArtifact = getLatestPhaseArtifact(ticket.id, 'bead_diff:bead-1', 'CODING')
    expect(diffArtifact).toBeUndefined()
  })

  // --- recordBeadStartCommit failure branch ---

  it('proceeds with execution when recordBeadStartCommit throws', async () => {
    recordBeadStartCommitMock.mockImplementation(() => {
      throw new Error('git rev-parse failed')
    })
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'recordBeadStartCommit throws',
    })
    writeTicketBeads(ticket.id, [makePendingBead('bead-1', 1)])
    const sendEvent = vi.fn()

    executeBeadMock.mockResolvedValueOnce({
      success: true,
      beadId: 'bead-1',
      iteration: 1,
      output: 'done',
      errors: [],
    })

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    expect(sendEvent).toHaveBeenCalledWith({ type: 'ALL_BEADS_DONE' })
    // With no beadStartCommit recorded, the success path should still avoid reset attempts.
    expect(resetToBeadStartMock).not.toHaveBeenCalled()
    // bead_diff requires beadStartCommit, so it should not be inserted
    const diffArtifact = getLatestPhaseArtifact(ticket.id, 'bead_diff:bead-1', 'CODING')
    expect(diffArtifact).toBeUndefined()
  })

  // --- Git error recovery ---

  it('marks bead done and sends completion event even when commitBeadChanges throws', async () => {
    commitBeadChangesMock.mockImplementation(() => {
      throw new Error('git commit failed')
    })
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'commitBeadChanges throws',
    })
    writeTicketBeads(ticket.id, [makePendingBead('bead-1', 1)])
    const sendEvent = vi.fn()

    executeBeadMock.mockResolvedValueOnce({
      success: true,
      beadId: 'bead-1',
      iteration: 1,
      output: 'done',
      errors: [],
    })

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    expect(sendEvent).toHaveBeenCalledWith({ type: 'ALL_BEADS_DONE' })
    const finalBeads = readTicketBeads(ticket.id)
    expect(finalBeads.find((b) => b.id === 'bead-1')?.status).toBe('done')
  })

  it('requeues the latest failed bead for retry without clearing notes or iteration', () => {
    const { ticket } = createInitializedTestTicket(repoManager, {
      title: 'Retry failed coding bead',
    })
    writeTicketBeads(ticket.id, [
      makePendingBead('bead-1', 1, {
        status: 'error',
        iteration: 2,
        notes: 'retry guidance',
        beadStartCommit: 'abc123',
      }),
      makePendingBead('bead-2', 2, {
        dependencies: { blocked_by: ['bead-1'], blocks: [] },
      }),
    ])

    const recoveredBead = recoverFailedCodingBead(ticket.id)

    expect(recoveredBead?.id).toBe('bead-1')
    expect(recoveredBead?.status).toBe('pending')
    expect(recoveredBead?.iteration).toBe(2)
    expect(recoveredBead?.notes).toBe('retry guidance')
    expect(recoveredBead?.beadStartCommit).toBe('abc123')
  })

  it('requeues the latest in-progress bead when coding blocked before status flipped to error', () => {
    const { ticket } = createInitializedTestTicket(repoManager, {
      title: 'Retry blocked in-progress coding bead',
    })
    writeTicketBeads(ticket.id, [
      makePendingBead('bead-1', 1, {
        status: 'in_progress',
        iteration: 2,
        notes: 'retry guidance',
        beadStartCommit: 'abc123',
      }),
    ])

    const recoveredBead = recoverFailedCodingBead(ticket.id)

    expect(recoveredBead?.id).toBe('bead-1')
    expect(recoveredBead?.status).toBe('pending')
    expect(recoveredBead?.iteration).toBe(2)
    expect(recoveredBead?.notes).toBe('retry guidance')
    expect(recoveredBead?.beadStartCommit).toBe('abc123')
  })
})
