import { createActor } from 'xstate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ticketMachine } from '../../machines/ticketMachine'
import { attachWorkflowRunner } from '../runner'
import { runningPhases, ticketAbortControllers } from '../phases'
import { TEST } from '../../test/factories'

const {
  handleCodingMock,
  handleFinalTestMock,
  handleMockExecutionUnsupportedMock,
  emitPhaseLogMock,
  isMockOpenCodeModeMock,
} = vi.hoisted(() => ({
  handleCodingMock: vi.fn(),
  handleFinalTestMock: vi.fn(),
  handleMockExecutionUnsupportedMock: vi.fn(),
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
    handleMockExecutionUnsupported: handleMockExecutionUnsupportedMock,
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
    handleMockExecutionUnsupportedMock.mockReset()
    emitPhaseLogMock.mockReset()
    isMockOpenCodeModeMock.mockReset()
  })

  it('starts work for a restored active snapshot immediately after attachment', async () => {
    isMockOpenCodeModeMock.mockReturnValue(false)
    handleCodingMock.mockImplementation(async (_ticketId, _context, sendEvent) => {
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
          title: 'Runner restored coding test',
          status: 'CODING',
          lockedMainImplementer: TEST.implementer,
          lockedMainImplementerVariant: null,
          lockedCouncilMembers: [...TEST.councilMembers],
          lockedCouncilMemberVariants: null,
          lockedInterviewQuestions: null,
          lockedCoverageFollowUpBudgetPercent: null,
          lockedMaxCoveragePasses: null,
          lockedMaxPrdCoveragePasses: null,
          lockedMaxBeadsCoveragePasses: null,
          previousStatus: 'PREPARING_EXECUTION_ENV',
          error: null,
          errorCodes: [],
          beadProgress: { total: 2, completed: 0, current: 'bead-1' },
          iterationCount: 0,
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
        title: 'Runner restored coding test',
        maxIterations: 5,
        lockedMainImplementer: TEST.implementer,
        lockedCouncilMembers: [...TEST.councilMembers],
      },
    })

    actor.start()
    attachWorkflowRunner(TEST.ticketId, actor, (event) => actor.send(event))

    await vi.waitFor(() => {
      expect(handleCodingMock).toHaveBeenCalledTimes(1)
    })
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

  it('does not block CODING when completed beads exceed maxIterations', () => {
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
          iterationCount: 5,
          maxIterations: 1,
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
        maxIterations: 1,
        lockedMainImplementer: TEST.implementer,
        lockedCouncilMembers: [...TEST.councilMembers],
      },
    })

    actor.start()
    actor.send({ type: 'BEAD_COMPLETE' })

    expect(actor.getSnapshot().value).toBe('CODING')
    expect(actor.getSnapshot().context.error).toBeNull()
  })

  it('routes WAITING_EXECUTION_SETUP_APPROVAL through the mock execution guard in mock mode', async () => {
    isMockOpenCodeModeMock.mockReturnValue(true)

    const actor = createActor(ticketMachine, {
      snapshot: {
        status: 'active',
        value: 'PRE_FLIGHT_CHECK',
        historyValue: {},
        context: {
          ticketId: TEST.ticketId,
          projectId: TEST.projectId,
          externalId: TEST.externalId,
          title: 'Runner mock setup test',
          status: 'PRE_FLIGHT_CHECK',
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
          beadProgress: { total: 5, completed: 0, current: null },
          iterationCount: 0,
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
        title: 'Runner mock setup test',
        maxIterations: 5,
        lockedMainImplementer: TEST.implementer,
        lockedCouncilMembers: [...TEST.councilMembers],
      },
    })

    actor.start()
    attachWorkflowRunner(TEST.ticketId, actor, (event) => actor.send(event))
    actor.send({ type: 'CHECKS_PASSED' })

    await vi.waitFor(() => {
      expect(handleMockExecutionUnsupportedMock).toHaveBeenCalledWith(
        TEST.ticketId,
        expect.objectContaining({ status: 'WAITING_EXECUTION_SETUP_APPROVAL' }),
        'WAITING_EXECUTION_SETUP_APPROVAL',
        expect.any(Function),
      )
    })
  })

  it('routes PREPARING_EXECUTION_ENV through the mock execution guard in mock mode', async () => {
    isMockOpenCodeModeMock.mockReturnValue(true)

    const actor = createActor(ticketMachine, {
      snapshot: {
        status: 'active',
        value: 'WAITING_EXECUTION_SETUP_APPROVAL',
        historyValue: {},
        context: {
          ticketId: TEST.ticketId,
          projectId: TEST.projectId,
          externalId: TEST.externalId,
          title: 'Runner mock execution setup test',
          status: 'WAITING_EXECUTION_SETUP_APPROVAL',
          lockedMainImplementer: TEST.implementer,
          lockedMainImplementerVariant: null,
          lockedCouncilMembers: [...TEST.councilMembers],
          lockedCouncilMemberVariants: null,
          lockedInterviewQuestions: null,
          lockedCoverageFollowUpBudgetPercent: null,
          lockedMaxCoveragePasses: null,
          previousStatus: 'WAITING_EXECUTION_SETUP_APPROVAL',
          error: null,
          errorCodes: [],
          beadProgress: { total: 5, completed: 0, current: null },
          iterationCount: 0,
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
        title: 'Runner mock execution setup test',
        maxIterations: 5,
        lockedMainImplementer: TEST.implementer,
        lockedCouncilMembers: [...TEST.councilMembers],
      },
    })

    actor.start()
    attachWorkflowRunner(TEST.ticketId, actor, (event) => actor.send(event))
    actor.send({ type: 'APPROVE_EXECUTION_SETUP_PLAN' })

    await vi.waitFor(() => {
      expect(handleMockExecutionUnsupportedMock).toHaveBeenCalledWith(
        TEST.ticketId,
        expect.objectContaining({ status: 'PREPARING_EXECUTION_ENV' }),
        'PREPARING_EXECUTION_ENV',
        expect.any(Function),
      )
    })
  })
})
