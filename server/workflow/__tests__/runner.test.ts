import { createActor } from 'xstate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ticketMachine } from '../../machines/ticketMachine'
import { attachWorkflowRunner } from '../runner'
import { runningPhases, ticketAbortControllers } from '../phases'
import { TEST } from '../../test/factories'

const {
  handleCodingMock,
  handleFinalTestMock,
  emitPhaseLogMock,
  isMockOpenCodeModeMock,
} = vi.hoisted(() => ({
  handleCodingMock: vi.fn(),
  handleFinalTestMock: vi.fn(),
  emitPhaseLogMock: vi.fn(),
  isMockOpenCodeModeMock: vi.fn(),
}))

vi.mock('../../opencode/factory', async () => {
  const actual = await vi.importActual<typeof import('../../opencode/factory')>('../../opencode/factory')
  return {
    ...actual,
    isMockOpenCodeMode: isMockOpenCodeModeMock,
  }
})

vi.mock('../phases', async () => {
  const actual = await vi.importActual<typeof import('../phases')>('../phases')
  return {
    ...actual,
    handleCoding: handleCodingMock,
    handleFinalTest: handleFinalTestMock,
    emitPhaseLog: emitPhaseLogMock,
  }
})

describe('attachWorkflowRunner', () => {
  afterEach(() => {
    runningPhases.clear()
    for (const controller of ticketAbortControllers.values()) {
      controller.abort()
    }
    ticketAbortControllers.clear()
    handleCodingMock.mockReset()
    handleFinalTestMock.mockReset()
    emitPhaseLogMock.mockReset()
    isMockOpenCodeModeMock.mockReset()
  })

  it('continues CODING after a bead-complete self-transition', async () => {
    isMockOpenCodeModeMock.mockReturnValue(false)

    handleCodingMock
      .mockImplementationOnce(async (_ticketId, _context, sendEvent) => {
        sendEvent({ type: 'BEAD_COMPLETE' })
      })
      .mockImplementationOnce(async (_ticketId, _context, sendEvent) => {
        sendEvent({ type: 'ALL_BEADS_DONE' })
      })

    handleFinalTestMock.mockResolvedValue(undefined)

    const actor = createActor(ticketMachine, {
      snapshot: {
        status: 'active',
        value: 'CODING',
        historyValue: {},
        context: {
          ticketId: TEST.ticketId,
          projectId: TEST.projectId,
          externalId: TEST.externalId,
          title: 'Runner test',
          status: 'CODING',
          lockedMainImplementer: TEST.implementer,
          lockedMainImplementerVariant: null,
          lockedCouncilMembers: [...TEST.councilMembers],
          lockedCouncilMemberVariants: null,
          lockedInterviewQuestions: null,
          lockedCoverageFollowUpBudgetPercent: null,
          lockedMaxCoveragePasses: null,
          previousStatus: 'PRE_FLIGHT_CHECK',
          error: null,
          errorCodes: [],
          beadProgress: { total: 5, completed: 1, current: 'bead-2' },
          iterationCount: 1,
          maxIterations: 5,
          councilResults: null,
          createdAt: TEST.timestamp,
          updatedAt: TEST.timestamp,
        },
        children: {},
      } as unknown as never,
      input: {
        ticketId: TEST.ticketId,
        projectId: TEST.projectId,
        externalId: TEST.externalId,
        title: 'Runner test',
        maxIterations: 5,
        lockedMainImplementer: TEST.implementer,
        lockedCouncilMembers: [...TEST.councilMembers],
      },
    })

    actor.start()
    attachWorkflowRunner(TEST.ticketId, actor, (event) => actor.send(event))
    actor.send({ type: 'BEAD_COMPLETE' })

    await vi.waitFor(() => {
      expect(handleCodingMock).toHaveBeenCalledTimes(2)
    })

    expect(actor.getSnapshot().value).toBe('RUNNING_FINAL_TEST')
    expect(handleFinalTestMock).toHaveBeenCalledTimes(1)
  })
})
