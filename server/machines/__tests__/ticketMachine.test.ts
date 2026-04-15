import { describe, expect, it } from 'vitest'
import { createActor } from 'xstate'
import { ticketMachine } from '../ticketMachine'

describe('ticketMachine execution setup flow', () => {
  it('routes approval through pre-flight, setup-plan approval, and execution setup before coding', () => {
    const actor = createActor(ticketMachine, {
      input: {
        ticketId: '1:T-1',
        projectId: 1,
        externalId: 'T-1',
        title: 'Execution setup flow',
        maxIterations: 5,
        lockedMainImplementer: 'model-a',
        lockedCouncilMembers: ['model-a', 'model-b'],
      },
    })

    actor.start()
    actor.send({ type: 'START', lockedMainImplementer: 'model-a', lockedCouncilMembers: ['model-a', 'model-b'] })
    actor.send({ type: 'RELEVANT_FILES_READY' })
    actor.send({ type: 'QUESTIONS_READY', result: {} })
    actor.send({ type: 'WINNER_SELECTED', winner: 'model-a' })
    actor.send({ type: 'READY' })
    actor.send({ type: 'INTERVIEW_COMPLETE' })
    actor.send({ type: 'COVERAGE_CLEAN' })
    actor.send({ type: 'APPROVE' })
    actor.send({ type: 'DRAFTS_READY' })
    actor.send({ type: 'WINNER_SELECTED', winner: 'model-a' })
    actor.send({ type: 'REFINED' })
    actor.send({ type: 'COVERAGE_CLEAN' })
    actor.send({ type: 'APPROVE' })
    actor.send({ type: 'DRAFTS_READY' })
    actor.send({ type: 'WINNER_SELECTED', winner: 'model-a' })
    actor.send({ type: 'REFINED' })
    actor.send({ type: 'COVERAGE_CLEAN' })
    actor.send({ type: 'APPROVE' })

    expect(actor.getSnapshot().value).toBe('PRE_FLIGHT_CHECK')

    actor.send({ type: 'CHECKS_PASSED' })
    expect(actor.getSnapshot().value).toBe('WAITING_EXECUTION_SETUP_APPROVAL')

    actor.send({ type: 'EXECUTION_SETUP_PLAN_READY' })
    expect(actor.getSnapshot().value).toBe('WAITING_EXECUTION_SETUP_APPROVAL')

    actor.send({ type: 'APPROVE_EXECUTION_SETUP_PLAN' })
    expect(actor.getSnapshot().value).toBe('PREPARING_EXECUTION_ENV')

    actor.send({ type: 'EXECUTION_SETUP_READY' })
    expect(actor.getSnapshot().value).toBe('CODING')
  })

  it('retries back into PREPARING_EXECUTION_ENV from blocked error', () => {
    const actor = createActor(ticketMachine, {
      snapshot: {
        status: 'active',
        value: 'BLOCKED_ERROR',
        historyValue: {},
        context: {
          ticketId: '1:T-1',
          projectId: 1,
          externalId: 'T-1',
          title: 'Execution setup retry',
          status: 'BLOCKED_ERROR',
          lockedMainImplementer: 'model-a',
          lockedMainImplementerVariant: null,
          lockedCouncilMembers: ['model-a', 'model-b'],
          lockedCouncilMemberVariants: null,
          lockedInterviewQuestions: null,
          lockedCoverageFollowUpBudgetPercent: null,
          lockedMaxCoveragePasses: null,
          previousStatus: 'PREPARING_EXECUTION_ENV',
          error: 'Execution setup failed',
          errorCodes: ['EXECUTION_SETUP_FAILED'],
          beadProgress: { total: 2, completed: 0, current: null },
          iterationCount: 0,
          maxIterations: 5,
          councilResults: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        children: {},
      } as unknown as never,
      input: {
        ticketId: '1:T-1',
        projectId: 1,
        externalId: 'T-1',
        title: 'Execution setup retry',
        maxIterations: 5,
        lockedMainImplementer: 'model-a',
        lockedCouncilMembers: ['model-a', 'model-b'],
      },
    })

    actor.start()
    actor.send({ type: 'RETRY' })

    expect(actor.getSnapshot().value).toBe('PREPARING_EXECUTION_ENV')
    expect(actor.getSnapshot().context.error).toBeNull()
  })

  it('retries back into setup-plan approval from blocked error', () => {
    const actor = createActor(ticketMachine, {
      snapshot: {
        status: 'active',
        value: 'BLOCKED_ERROR',
        historyValue: {},
        context: {
          ticketId: '1:T-1',
          projectId: 1,
          externalId: 'T-1',
          title: 'Execution setup plan retry',
          status: 'BLOCKED_ERROR',
          lockedMainImplementer: 'model-a',
          lockedMainImplementerVariant: null,
          lockedCouncilMembers: ['model-a', 'model-b'],
          lockedCouncilMemberVariants: null,
          lockedInterviewQuestions: null,
          lockedCoverageFollowUpBudgetPercent: null,
          lockedMaxCoveragePasses: null,
          previousStatus: 'WAITING_EXECUTION_SETUP_APPROVAL',
          error: 'Execution setup plan failed',
          errorCodes: ['EXECUTION_SETUP_PLAN_FAILED'],
          beadProgress: { total: 2, completed: 0, current: null },
          iterationCount: 0,
          maxIterations: 5,
          councilResults: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        children: {},
      } as unknown as never,
      input: {
        ticketId: '1:T-1',
        projectId: 1,
        externalId: 'T-1',
        title: 'Execution setup plan retry',
        maxIterations: 5,
        lockedMainImplementer: 'model-a',
        lockedCouncilMembers: ['model-a', 'model-b'],
      },
    })

    actor.start()
    actor.send({ type: 'RETRY' })

    expect(actor.getSnapshot().value).toBe('WAITING_EXECUTION_SETUP_APPROVAL')
    expect(actor.getSnapshot().context.error).toBeNull()
  })
})
