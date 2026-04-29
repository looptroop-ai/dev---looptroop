import { createActor } from 'xstate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ticketMachine } from '../../machines/ticketMachine'
import { attachWorkflowRunner } from '../runner'
import { phaseIntermediate, runningPhases, ticketAbortControllers } from '../phases'
import { TEST } from '../../test/factories'

const {
  handleCodingMock,
  handleFinalTestMock,
  handlePrdRefineMock,
  handleMockExecutionUnsupportedMock,
  emitPhaseLogMock,
  isMockOpenCodeModeMock,
} = vi.hoisted(() => ({
  handleCodingMock: vi.fn(),
  handleFinalTestMock: vi.fn(),
  handlePrdRefineMock: vi.fn(),
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
    handlePrdRefine: handlePrdRefineMock,
    handleMockExecutionUnsupported: handleMockExecutionUnsupportedMock,
    emitPhaseLog: emitPhaseLogMock,
  }
})

describe('attachWorkflowRunner', () => {
  function createRefiningPrdActor() {
    return createActor(ticketMachine, {
      snapshot: {
        status: 'active',
        value: 'REFINING_PRD',
        historyValue: {},
        context: {
          ticketId: TEST.ticketId,
          projectId: TEST.projectId,
          externalId: TEST.externalId,
          title: 'Runner PRD refinement test',
          status: 'REFINING_PRD',
          lockedMainImplementer: TEST.implementer,
          lockedMainImplementerVariant: null,
          lockedCouncilMembers: [...TEST.councilMembers],
          lockedCouncilMemberVariants: null,
          lockedInterviewQuestions: null,
          lockedCoverageFollowUpBudgetPercent: null,
          lockedMaxCoveragePasses: null,
          lockedMaxPrdCoveragePasses: null,
          lockedMaxBeadsCoveragePasses: null,
          previousStatus: 'COUNCIL_VOTING_PRD',
          error: null,
          errorCodes: [],
          beadProgress: { total: 0, completed: 0, current: null },
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
        title: 'Runner PRD refinement test',
        maxIterations: 5,
        lockedMainImplementer: TEST.implementer,
        lockedCouncilMembers: [...TEST.councilMembers],
      },
    })
  }

  afterEach(() => {
    runningPhases.clear()
    for (const controller of ticketAbortControllers.values()) {
      controller.abort()
    }
    ticketAbortControllers.clear()
    handleCodingMock.mockReset()
    handleFinalTestMock.mockReset()
    handlePrdRefineMock.mockReset()
    handleMockExecutionUnsupportedMock.mockReset()
    emitPhaseLogMock.mockReset()
    isMockOpenCodeModeMock.mockReset()
    phaseIntermediate.clear()
  })

  it('does not block an active PRD refinement when the phase rejects after abort', async () => {
    isMockOpenCodeModeMock.mockReturnValue(false)
    phaseIntermediate.set(`${TEST.ticketId}:prd`, {} as never)
    handlePrdRefineMock.mockImplementation(async (
      _ticketId,
      _context,
      _sendEvent,
      signal: AbortSignal,
    ) => {
      await new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'))
        }, { once: true })
      })
    })

    const actor = createRefiningPrdActor()
    const sentEvents: unknown[] = []
    actor.start()
    attachWorkflowRunner(TEST.ticketId, actor, (event) => {
      sentEvents.push(event)
      actor.send(event)
    })

    await vi.waitFor(() => {
      expect(handlePrdRefineMock).toHaveBeenCalledTimes(1)
    })

    ticketAbortControllers.get(TEST.ticketId)?.abort()

    await vi.waitFor(() => {
      expect(runningPhases.has(`${TEST.ticketId}:REFINING_PRD`)).toBe(false)
    })

    expect(actor.getSnapshot().value).toBe('REFINING_PRD')
    expect(sentEvents).not.toContainEqual(expect.objectContaining({ type: 'ERROR' }))
    expect(emitPhaseLogMock).not.toHaveBeenCalled()
  })

  it('blocks an active PRD refinement when it fails without cancellation', async () => {
    isMockOpenCodeModeMock.mockReturnValue(false)
    phaseIntermediate.set(`${TEST.ticketId}:prd`, {} as never)
    handlePrdRefineMock.mockRejectedValue(new Error('Refinement failed'))

    const actor = createRefiningPrdActor()
    actor.start()
    attachWorkflowRunner(TEST.ticketId, actor, (event) => actor.send(event))

    await vi.waitFor(() => {
      expect(actor.getSnapshot().value).toBe('BLOCKED_ERROR')
    })

    expect(actor.getSnapshot().context.error).toBe('Refinement failed')
    expect(emitPhaseLogMock).toHaveBeenCalledWith(
      TEST.ticketId,
      TEST.externalId,
      'REFINING_PRD',
      'error',
      'Refinement failed',
    )
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
