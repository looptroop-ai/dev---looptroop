import { describe, it, expect } from 'vitest'
import { createActor } from 'xstate'
import { ticketMachine } from '../ticketMachine'
import { ALL_STATES, STATUS_TO_PHASE, TERMINAL_STATES } from '../types'

const defaultInput = {
  ticketId: 'test-1',
  projectId: 1,
  externalId: 'ext-1',
  title: 'Test Ticket',
}

function startActor(input: Partial<typeof defaultInput> = {}) {
  const actor = createActor(ticketMachine, {
    input: { ...defaultInput, ...input },
  })
  actor.start()
  return actor
}

describe('ticketMachine', () => {
  describe('state completeness', () => {
    it('should have all 26 states (25 unique + BLOCKED_ERROR)', () => {
      expect(ALL_STATES).toHaveLength(26)
    })

    it('should define all states in the machine', () => {
      const machineStates = Object.keys(
        ticketMachine.config.states as Record<string, unknown>,
      )
      for (const state of ALL_STATES) {
        expect(machineStates).toContain(state)
      }
    })

    it('should map every state to a Kanban phase', () => {
      for (const state of ALL_STATES) {
        expect(STATUS_TO_PHASE[state]).toBeDefined()
      }
    })

    it('should have exactly 2 terminal states', () => {
      expect(TERMINAL_STATES).toEqual(['COMPLETED', 'CANCELED'])
    })
  })

  describe('initial state', () => {
    it('should start in DRAFT state', () => {
      const actor = startActor()
      expect(actor.getSnapshot().value).toBe('DRAFT')
      actor.stop()
    })

    it('should initialize context from input', () => {
      const actor = startActor()
      const ctx = actor.getSnapshot().context
      expect(ctx.ticketId).toBe('test-1')
      expect(ctx.projectId).toBe(1)
      expect(ctx.status).toBe('DRAFT')
      expect(ctx.previousStatus).toBe('DRAFT')
      expect(ctx.error).toBeNull()
      expect(ctx.iterationCount).toBe(0)
      expect(ctx.maxIterations).toBe(5)
      actor.stop()
    })
  })

  describe('happy path — full workflow', () => {
    it('should traverse the entire happy path from DRAFT to COMPLETED', () => {
      const actor = startActor()

      // DRAFT -> COUNCIL_DELIBERATING
      actor.send({ type: 'START' })
      expect(actor.getSnapshot().value).toBe('COUNCIL_DELIBERATING')

      // -> COUNCIL_VOTING_INTERVIEW
      actor.send({ type: 'QUESTIONS_READY', result: {} })
      expect(actor.getSnapshot().value).toBe('COUNCIL_VOTING_INTERVIEW')

      // -> COMPILING_INTERVIEW
      actor.send({ type: 'WINNER_SELECTED', winner: 'plan-a' })
      expect(actor.getSnapshot().value).toBe('COMPILING_INTERVIEW')

      // -> WAITING_INTERVIEW_ANSWERS
      actor.send({ type: 'READY' })
      expect(actor.getSnapshot().value).toBe('WAITING_INTERVIEW_ANSWERS')

      // -> VERIFYING_INTERVIEW_COVERAGE
      actor.send({ type: 'ANSWER_SUBMITTED', answers: { q1: 'a1' } })
      expect(actor.getSnapshot().value).toBe('VERIFYING_INTERVIEW_COVERAGE')

      // -> WAITING_INTERVIEW_APPROVAL
      actor.send({ type: 'COVERAGE_CLEAN' })
      expect(actor.getSnapshot().value).toBe('WAITING_INTERVIEW_APPROVAL')

      // -> DRAFTING_PRD
      actor.send({ type: 'APPROVE' })
      expect(actor.getSnapshot().value).toBe('DRAFTING_PRD')

      // -> COUNCIL_VOTING_PRD
      actor.send({ type: 'DRAFTS_READY' })
      expect(actor.getSnapshot().value).toBe('COUNCIL_VOTING_PRD')

      // -> REFINING_PRD
      actor.send({ type: 'WINNER_SELECTED', winner: 'prd-v1' })
      expect(actor.getSnapshot().value).toBe('REFINING_PRD')

      // -> VERIFYING_PRD_COVERAGE
      actor.send({ type: 'REFINED' })
      expect(actor.getSnapshot().value).toBe('VERIFYING_PRD_COVERAGE')

      // -> WAITING_PRD_APPROVAL
      actor.send({ type: 'COVERAGE_CLEAN' })
      expect(actor.getSnapshot().value).toBe('WAITING_PRD_APPROVAL')

      // -> DRAFTING_BEADS
      actor.send({ type: 'APPROVE' })
      expect(actor.getSnapshot().value).toBe('DRAFTING_BEADS')

      // -> COUNCIL_VOTING_BEADS
      actor.send({ type: 'DRAFTS_READY' })
      expect(actor.getSnapshot().value).toBe('COUNCIL_VOTING_BEADS')

      // -> REFINING_BEADS
      actor.send({ type: 'WINNER_SELECTED', winner: 'beads-v1' })
      expect(actor.getSnapshot().value).toBe('REFINING_BEADS')

      // -> VERIFYING_BEADS_COVERAGE
      actor.send({ type: 'REFINED' })
      expect(actor.getSnapshot().value).toBe('VERIFYING_BEADS_COVERAGE')

      // -> WAITING_BEADS_APPROVAL
      actor.send({ type: 'COVERAGE_CLEAN' })
      expect(actor.getSnapshot().value).toBe('WAITING_BEADS_APPROVAL')

      // -> PRE_FLIGHT_CHECK
      actor.send({ type: 'APPROVE' })
      expect(actor.getSnapshot().value).toBe('PRE_FLIGHT_CHECK')

      // -> CODING
      actor.send({ type: 'CHECKS_PASSED' })
      expect(actor.getSnapshot().value).toBe('CODING')

      // -> RUNNING_FINAL_TEST (via ALL_BEADS_DONE)
      actor.send({ type: 'ALL_BEADS_DONE' })
      expect(actor.getSnapshot().value).toBe('RUNNING_FINAL_TEST')

      // -> INTEGRATION
      actor.send({ type: 'TESTS_PASSED' })
      expect(actor.getSnapshot().value).toBe('INTEGRATING_CHANGES')

      // -> WAITING_MANUAL_VERIFICATION
      actor.send({ type: 'INTEGRATION_DONE' })
      expect(actor.getSnapshot().value).toBe('WAITING_MANUAL_VERIFICATION')

      // -> CLEANUP
      actor.send({ type: 'VERIFY_COMPLETE' })
      expect(actor.getSnapshot().value).toBe('CLEANING_ENV')

      // -> COMPLETED
      actor.send({ type: 'CLEANUP_DONE' })
      expect(actor.getSnapshot().value).toBe('COMPLETED')
      expect(actor.getSnapshot().status).toBe('done')

      actor.stop()
    })
  })

  describe('CANCEL from any non-terminal state', () => {
    const nonTerminalStatesWithPaths: Array<{
      state: string
      events: Array<{ type: string; [key: string]: unknown }>
    }> = [
      { state: 'DRAFT', events: [] },
      { state: 'COUNCIL_DELIBERATING', events: [{ type: 'START' }] },
      {
        state: 'COUNCIL_VOTING_INTERVIEW',
        events: [
          { type: 'START' },
          { type: 'QUESTIONS_READY', result: {} },
        ],
      },
      {
        state: 'COMPILING_INTERVIEW',
        events: [
          { type: 'START' },
          { type: 'QUESTIONS_READY', result: {} },
          { type: 'WINNER_SELECTED', winner: 'a' },
        ],
      },
    ]

    for (const { state, events } of nonTerminalStatesWithPaths) {
      it(`should transition to CANCELED from ${state}`, () => {
        const actor = startActor()
        for (const event of events) {
          actor.send(event as Parameters<typeof actor.send>[0])
        }
        expect(actor.getSnapshot().value).toBe(state)
        actor.send({ type: 'CANCEL' })
        expect(actor.getSnapshot().value).toBe('CANCELED')
        expect(actor.getSnapshot().status).toBe('done')
        actor.stop()
      })
    }
  })

  describe('error handling and retry', () => {
    it('should transition to BLOCKED_ERROR on ERROR event', () => {
      const actor = startActor()
      actor.send({ type: 'START' })
      expect(actor.getSnapshot().value).toBe('COUNCIL_DELIBERATING')

      actor.send({ type: 'ERROR', message: 'LLM timeout', codes: ['E001'] })
      expect(actor.getSnapshot().value).toBe('BLOCKED_ERROR')

      const ctx = actor.getSnapshot().context
      expect(ctx.error).toBe('LLM timeout')
      expect(ctx.errorCodes).toEqual(['E001'])
      actor.stop()
    })

    it('should RETRY back to previous state from BLOCKED_ERROR', () => {
      const actor = startActor()
      actor.send({ type: 'START' })
      actor.send({ type: 'QUESTIONS_READY', result: {} })
      expect(actor.getSnapshot().value).toBe('COUNCIL_VOTING_INTERVIEW')

      actor.send({ type: 'ERROR', message: 'fail' })
      expect(actor.getSnapshot().value).toBe('BLOCKED_ERROR')
      expect(actor.getSnapshot().context.previousStatus).toBe(
        'COUNCIL_VOTING_INTERVIEW',
      )

      actor.send({ type: 'RETRY' })
      expect(actor.getSnapshot().value).toBe('COUNCIL_VOTING_INTERVIEW')
      expect(actor.getSnapshot().context.error).toBeNull()
      actor.stop()
    })

    it('should handle CHECKS_FAILED -> BLOCKED_ERROR -> RETRY', () => {
      const actor = startActor()
      // Navigate to PRE_FLIGHT_CHECK
      actor.send({ type: 'START' })
      actor.send({ type: 'QUESTIONS_READY', result: {} })
      actor.send({ type: 'WINNER_SELECTED', winner: 'a' })
      actor.send({ type: 'READY' })
      actor.send({ type: 'ANSWER_SUBMITTED', answers: {} })
      actor.send({ type: 'COVERAGE_CLEAN' })
      actor.send({ type: 'APPROVE' })
      actor.send({ type: 'DRAFTS_READY' })
      actor.send({ type: 'WINNER_SELECTED', winner: 'a' })
      actor.send({ type: 'REFINED' })
      actor.send({ type: 'COVERAGE_CLEAN' })
      actor.send({ type: 'APPROVE' })
      actor.send({ type: 'DRAFTS_READY' })
      actor.send({ type: 'WINNER_SELECTED', winner: 'a' })
      actor.send({ type: 'REFINED' })
      actor.send({ type: 'COVERAGE_CLEAN' })
      actor.send({ type: 'APPROVE' })
      expect(actor.getSnapshot().value).toBe('PRE_FLIGHT_CHECK')

      actor.send({ type: 'CHECKS_FAILED', errors: ['missing dep'] })
      expect(actor.getSnapshot().value).toBe('BLOCKED_ERROR')

      actor.send({ type: 'RETRY' })
      expect(actor.getSnapshot().value).toBe('PRE_FLIGHT_CHECK')
      actor.stop()
    })
  })

  describe('coverage verification loops', () => {
    it('should loop back to WAITING_INTERVIEW_ANSWERS on GAPS_FOUND', () => {
      const actor = startActor()
      actor.send({ type: 'START' })
      actor.send({ type: 'QUESTIONS_READY', result: {} })
      actor.send({ type: 'WINNER_SELECTED', winner: 'a' })
      actor.send({ type: 'READY' })
      actor.send({ type: 'ANSWER_SUBMITTED', answers: {} })
      expect(actor.getSnapshot().value).toBe('VERIFYING_INTERVIEW_COVERAGE')

      actor.send({ type: 'GAPS_FOUND' })
      expect(actor.getSnapshot().value).toBe('WAITING_INTERVIEW_ANSWERS')
      actor.stop()
    })

    it('should loop back to REFINING_PRD on PRD GAPS_FOUND', () => {
      const actor = startActor()
      actor.send({ type: 'START' })
      actor.send({ type: 'QUESTIONS_READY', result: {} })
      actor.send({ type: 'WINNER_SELECTED', winner: 'a' })
      actor.send({ type: 'READY' })
      actor.send({ type: 'ANSWER_SUBMITTED', answers: {} })
      actor.send({ type: 'COVERAGE_CLEAN' })
      actor.send({ type: 'APPROVE' })
      actor.send({ type: 'DRAFTS_READY' })
      actor.send({ type: 'WINNER_SELECTED', winner: 'a' })
      actor.send({ type: 'REFINED' })
      expect(actor.getSnapshot().value).toBe('VERIFYING_PRD_COVERAGE')

      actor.send({ type: 'GAPS_FOUND' })
      expect(actor.getSnapshot().value).toBe('REFINING_PRD')
      actor.stop()
    })

    it('should reject interview approval back to COUNCIL_DELIBERATING', () => {
      const actor = startActor()
      actor.send({ type: 'START' })
      actor.send({ type: 'QUESTIONS_READY', result: {} })
      actor.send({ type: 'WINNER_SELECTED', winner: 'a' })
      actor.send({ type: 'READY' })
      actor.send({ type: 'ANSWER_SUBMITTED', answers: {} })
      actor.send({ type: 'COVERAGE_CLEAN' })
      expect(actor.getSnapshot().value).toBe('WAITING_INTERVIEW_APPROVAL')

      actor.send({ type: 'REJECT' })
      expect(actor.getSnapshot().value).toBe('COUNCIL_DELIBERATING')
      actor.stop()
    })
  })

  describe('coding phase — bead tracking', () => {
    function navigateToCoding() {
      const actor = startActor()
      const events: Array<{ type: string; [key: string]: unknown }> = [
        { type: 'START' },
        { type: 'QUESTIONS_READY', result: {} },
        { type: 'WINNER_SELECTED', winner: 'a' },
        { type: 'READY' },
        { type: 'ANSWER_SUBMITTED', answers: {} },
        { type: 'COVERAGE_CLEAN' },
        { type: 'APPROVE' },
        { type: 'DRAFTS_READY' },
        { type: 'WINNER_SELECTED', winner: 'a' },
        { type: 'REFINED' },
        { type: 'COVERAGE_CLEAN' },
        { type: 'APPROVE' },
        { type: 'DRAFTS_READY' },
        { type: 'WINNER_SELECTED', winner: 'a' },
        { type: 'REFINED' },
        { type: 'COVERAGE_CLEAN' },
        { type: 'APPROVE' },
        { type: 'CHECKS_PASSED' },
      ]
      for (const event of events) {
        actor.send(event as Parameters<typeof actor.send>[0])
      }
      return actor
    }

    it('should stay in CODING on BEAD_COMPLETE when beads remain', () => {
      const actor = navigateToCoding()
      expect(actor.getSnapshot().value).toBe('CODING')

      actor.send({ type: 'BEAD_COMPLETE' })
      expect(actor.getSnapshot().value).toBe('CODING')
      expect(actor.getSnapshot().context.iterationCount).toBe(1)
      actor.stop()
    })

    it('should move to RUNNING_FINAL_TEST on ALL_BEADS_DONE', () => {
      const actor = navigateToCoding()
      actor.send({ type: 'ALL_BEADS_DONE' })
      expect(actor.getSnapshot().value).toBe('RUNNING_FINAL_TEST')
      actor.stop()
    })
  })

  describe('invalid transitions', () => {
    it('should not change state on invalid event in DRAFT', () => {
      const actor = startActor()
      actor.send({ type: 'APPROVE' })
      expect(actor.getSnapshot().value).toBe('DRAFT')
      actor.stop()
    })

    it('should not accept events in terminal COMPLETED state', () => {
      const actor = startActor()
      // Quick path to COMPLETED
      actor.send({ type: 'START' })
      actor.send({ type: 'QUESTIONS_READY', result: {} })
      actor.send({ type: 'WINNER_SELECTED', winner: 'a' })
      actor.send({ type: 'READY' })
      actor.send({ type: 'ANSWER_SUBMITTED', answers: {} })
      actor.send({ type: 'COVERAGE_CLEAN' })
      actor.send({ type: 'APPROVE' })
      actor.send({ type: 'DRAFTS_READY' })
      actor.send({ type: 'WINNER_SELECTED', winner: 'a' })
      actor.send({ type: 'REFINED' })
      actor.send({ type: 'COVERAGE_CLEAN' })
      actor.send({ type: 'APPROVE' })
      actor.send({ type: 'DRAFTS_READY' })
      actor.send({ type: 'WINNER_SELECTED', winner: 'a' })
      actor.send({ type: 'REFINED' })
      actor.send({ type: 'COVERAGE_CLEAN' })
      actor.send({ type: 'APPROVE' })
      actor.send({ type: 'CHECKS_PASSED' })
      actor.send({ type: 'ALL_BEADS_DONE' })
      actor.send({ type: 'TESTS_PASSED' })
      actor.send({ type: 'INTEGRATION_DONE' })
      actor.send({ type: 'VERIFY_COMPLETE' })
      actor.send({ type: 'CLEANUP_DONE' })
      expect(actor.getSnapshot().value).toBe('COMPLETED')
      expect(actor.getSnapshot().status).toBe('done')
      actor.stop()
    })
  })

  describe('context updates', () => {
    it('should track status and previousStatus through transitions', () => {
      const actor = startActor()
      actor.send({ type: 'START' })
      const ctx = actor.getSnapshot().context
      expect(ctx.status).toBe('COUNCIL_DELIBERATING')
      expect(ctx.previousStatus).toBe('DRAFT')
      actor.stop()
    })

    it('should record error info on ERROR event', () => {
      const actor = startActor()
      actor.send({ type: 'START' })
      actor.send({
        type: 'ERROR',
        message: 'something broke',
        codes: ['E100', 'E200'],
      })
      const ctx = actor.getSnapshot().context
      expect(ctx.error).toBe('something broke')
      expect(ctx.errorCodes).toEqual(['E100', 'E200'])
      actor.stop()
    })

    it('should clear error on RETRY', () => {
      const actor = startActor()
      actor.send({ type: 'START' })
      actor.send({ type: 'ERROR', message: 'fail' })
      expect(actor.getSnapshot().context.error).toBe('fail')

      actor.send({ type: 'RETRY' })
      expect(actor.getSnapshot().context.error).toBeNull()
      expect(actor.getSnapshot().context.errorCodes).toEqual([])
      actor.stop()
    })
  })

  describe('snapshot serialization', () => {
    it('should round-trip persisted snapshot', () => {
      const actor = startActor()
      actor.send({ type: 'START' })
      actor.send({ type: 'QUESTIONS_READY', result: {} })

      const snapshot = actor.getPersistedSnapshot()
      expect(snapshot).toBeDefined()

      // Serialize and deserialize
      const serialized = JSON.stringify(snapshot)
      const deserialized = JSON.parse(serialized)

      // Create new actor from persisted snapshot
      const restored = createActor(ticketMachine, {
        snapshot: deserialized,
        input: {},
      })
      restored.start()

      expect(restored.getSnapshot().value).toBe('COUNCIL_VOTING_INTERVIEW')
      expect(restored.getSnapshot().context.ticketId).toBe('test-1')

      actor.stop()
      restored.stop()
    })
  })

  describe('Kanban phase mapping', () => {
    it('should map DRAFT to todo phase', () => {
      expect(STATUS_TO_PHASE['DRAFT']).toBe('todo')
    })

    it('should map active states to in_progress phase', () => {
      const inProgressStates = [
        'COUNCIL_DELIBERATING',
        'COMPILING_INTERVIEW',
        'CODING',
        'CLEANING_ENV',
      ]
      for (const state of inProgressStates) {
        expect(STATUS_TO_PHASE[state]).toBe('in_progress')
      }
    })

    it('should map waiting states to needs_input phase', () => {
      const needsInputStates = [
        'WAITING_INTERVIEW_ANSWERS',
        'WAITING_PRD_APPROVAL',
        'BLOCKED_ERROR',
      ]
      for (const state of needsInputStates) {
        expect(STATUS_TO_PHASE[state]).toBe('needs_input')
      }
    })

    it('should map terminal states to done phase', () => {
      expect(STATUS_TO_PHASE['COMPLETED']).toBe('done')
      expect(STATUS_TO_PHASE['CANCELED']).toBe('done')
    })
  })
})
