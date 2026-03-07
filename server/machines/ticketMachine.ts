import { assign, setup } from 'xstate'
import type { TicketContext, TicketEvent } from './types'

export type TicketInput = Partial<TicketContext>

export const ticketMachine = setup({
  types: {
    context: {} as TicketContext,
    events: {} as TicketEvent,
    input: {} as TicketInput,
  },
  actions: {
    persistState: () => {},
    notifyFrontend: () => {},
    recordError: assign({
      error: ({ event }) => {
        if (event.type === 'ERROR') return event.message
        if (event.type === 'CHECKS_FAILED') return 'Pre-flight check failed'
        if (event.type === 'TESTS_FAILED') return 'Final test failed'
        if (event.type === 'BEAD_ERROR') return 'Bead execution failed'
        if (event.type === 'BEAD_COMPLETE') return 'Maximum iterations reached'
        return 'Unknown error'
      },
      errorCodes: ({ event }) => {
        if (event.type === 'ERROR') return event.codes ?? []
        if (event.type === 'CHECKS_FAILED') return event.errors
        return []
      },
    }),
    clearError: assign({
      error: () => null,
      errorCodes: () => [] as string[],
    }),
    updateStatus: assign({
      previousStatus: ({ context }) => context.status,
      status: (_, params: { status: string }) => params.status,
      updatedAt: () => new Date().toISOString(),
    }),
    incrementIteration: assign({
      iterationCount: ({ context }) => context.iterationCount + 1,
    }),
  },
  guards: {
    hasReachedMaxIterations: ({ context }) =>
      context.iterationCount >= context.maxIterations,
    allBeadsComplete: ({ context }) =>
      context.beadProgress.completed >= context.beadProgress.total &&
      context.beadProgress.total > 0,
  },
}).createMachine({
  id: 'ticket',
  initial: 'DRAFT',
  context: ({ input }) => ({
    ticketId: input.ticketId ?? '',
    projectId: input.projectId ?? 0,
    externalId: input.externalId ?? '',
    title: input.title ?? '',
    status: 'DRAFT',
    lockedMainImplementer: input.lockedMainImplementer ?? null,
    lockedCouncilMembers: input.lockedCouncilMembers ?? null,
    previousStatus: null,
    error: null,
    errorCodes: [],
    beadProgress: { total: 0, completed: 0, current: null },
    iterationCount: 0,
    maxIterations: input.maxIterations ?? 5,
    councilResults: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  states: {
    DRAFT: {
      entry: [
        { type: 'updateStatus', params: { status: 'DRAFT' } },
        'persistState',
        'notifyFrontend',
      ],
      on: {
        START: {
          target: 'COUNCIL_DELIBERATING',
          actions: assign({
            lockedMainImplementer: ({ event }) => event.lockedMainImplementer ?? null,
            lockedCouncilMembers: ({ event }) => event.lockedCouncilMembers ?? null,
          }),
        },
        CANCEL: { target: 'CANCELED' },
      },
    },
    COUNCIL_DELIBERATING: {
      entry: [
        { type: 'updateStatus', params: { status: 'COUNCIL_DELIBERATING' } },
        'persistState',
        'notifyFrontend',
      ],
      on: {
        QUESTIONS_READY: { target: 'COUNCIL_VOTING_INTERVIEW' },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    COUNCIL_VOTING_INTERVIEW: {
      entry: [
        {
          type: 'updateStatus',
          params: { status: 'COUNCIL_VOTING_INTERVIEW' },
        },
        'persistState',
        'notifyFrontend',
      ],
      on: {
        WINNER_SELECTED: { target: 'COMPILING_INTERVIEW' },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    COMPILING_INTERVIEW: {
      entry: [
        { type: 'updateStatus', params: { status: 'COMPILING_INTERVIEW' } },
        'persistState',
        'notifyFrontend',
      ],
      on: {
        READY: { target: 'WAITING_INTERVIEW_ANSWERS' },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    WAITING_INTERVIEW_ANSWERS: {
      entry: [
        {
          type: 'updateStatus',
          params: { status: 'WAITING_INTERVIEW_ANSWERS' },
        },
        'persistState',
        'notifyFrontend',
      ],
      on: {
        ANSWER_SUBMITTED: { target: 'VERIFYING_INTERVIEW_COVERAGE' },
        BATCH_ANSWERED: { target: 'WAITING_INTERVIEW_ANSWERS' },
        INTERVIEW_COMPLETE: { target: 'VERIFYING_INTERVIEW_COVERAGE' },
        SKIP: { target: 'VERIFYING_INTERVIEW_COVERAGE' },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    VERIFYING_INTERVIEW_COVERAGE: {
      entry: [
        {
          type: 'updateStatus',
          params: { status: 'VERIFYING_INTERVIEW_COVERAGE' },
        },
        'persistState',
        'notifyFrontend',
      ],
      on: {
        COVERAGE_CLEAN: { target: 'WAITING_INTERVIEW_APPROVAL' },
        GAPS_FOUND: { target: 'WAITING_INTERVIEW_ANSWERS' },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    WAITING_INTERVIEW_APPROVAL: {
      entry: [
        {
          type: 'updateStatus',
          params: { status: 'WAITING_INTERVIEW_APPROVAL' },
        },
        'persistState',
        'notifyFrontend',
      ],
      on: {
        APPROVE: { target: 'DRAFTING_PRD' },
        REJECT: { target: 'COUNCIL_DELIBERATING' },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    DRAFTING_PRD: {
      entry: [
        { type: 'updateStatus', params: { status: 'DRAFTING_PRD' } },
        'persistState',
        'notifyFrontend',
      ],
      on: {
        DRAFTS_READY: { target: 'COUNCIL_VOTING_PRD' },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    COUNCIL_VOTING_PRD: {
      entry: [
        { type: 'updateStatus', params: { status: 'COUNCIL_VOTING_PRD' } },
        'persistState',
        'notifyFrontend',
      ],
      on: {
        WINNER_SELECTED: { target: 'REFINING_PRD' },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    REFINING_PRD: {
      entry: [
        { type: 'updateStatus', params: { status: 'REFINING_PRD' } },
        'persistState',
        'notifyFrontend',
      ],
      on: {
        REFINED: { target: 'VERIFYING_PRD_COVERAGE' },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    VERIFYING_PRD_COVERAGE: {
      entry: [
        { type: 'updateStatus', params: { status: 'VERIFYING_PRD_COVERAGE' } },
        'persistState',
        'notifyFrontend',
      ],
      on: {
        COVERAGE_CLEAN: { target: 'WAITING_PRD_APPROVAL' },
        GAPS_FOUND: { target: 'REFINING_PRD' },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    WAITING_PRD_APPROVAL: {
      entry: [
        { type: 'updateStatus', params: { status: 'WAITING_PRD_APPROVAL' } },
        'persistState',
        'notifyFrontend',
      ],
      on: {
        APPROVE: { target: 'DRAFTING_BEADS' },
        REJECT: { target: 'DRAFTING_PRD' },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    DRAFTING_BEADS: {
      entry: [
        { type: 'updateStatus', params: { status: 'DRAFTING_BEADS' } },
        'persistState',
        'notifyFrontend',
      ],
      on: {
        DRAFTS_READY: { target: 'COUNCIL_VOTING_BEADS' },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    COUNCIL_VOTING_BEADS: {
      entry: [
        { type: 'updateStatus', params: { status: 'COUNCIL_VOTING_BEADS' } },
        'persistState',
        'notifyFrontend',
      ],
      on: {
        WINNER_SELECTED: { target: 'REFINING_BEADS' },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    REFINING_BEADS: {
      entry: [
        { type: 'updateStatus', params: { status: 'REFINING_BEADS' } },
        'persistState',
        'notifyFrontend',
      ],
      on: {
        REFINED: { target: 'VERIFYING_BEADS_COVERAGE' },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    VERIFYING_BEADS_COVERAGE: {
      entry: [
        {
          type: 'updateStatus',
          params: { status: 'VERIFYING_BEADS_COVERAGE' },
        },
        'persistState',
        'notifyFrontend',
      ],
      on: {
        COVERAGE_CLEAN: { target: 'WAITING_BEADS_APPROVAL' },
        GAPS_FOUND: { target: 'REFINING_BEADS' },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    WAITING_BEADS_APPROVAL: {
      entry: [
        { type: 'updateStatus', params: { status: 'WAITING_BEADS_APPROVAL' } },
        'persistState',
        'notifyFrontend',
      ],
      on: {
        APPROVE: { target: 'PRE_FLIGHT_CHECK' },
        REJECT: { target: 'DRAFTING_BEADS' },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    PRE_FLIGHT_CHECK: {
      entry: [
        { type: 'updateStatus', params: { status: 'PRE_FLIGHT_CHECK' } },
        'persistState',
        'notifyFrontend',
      ],
      on: {
        CHECKS_PASSED: { target: 'CODING' },
        CHECKS_FAILED: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    CODING: {
      entry: [
        { type: 'updateStatus', params: { status: 'CODING' } },
        'persistState',
        'notifyFrontend',
      ],
      on: {
        BEAD_COMPLETE: [
          { guard: 'allBeadsComplete', target: 'RUNNING_FINAL_TEST' },
          { guard: 'hasReachedMaxIterations', target: 'BLOCKED_ERROR', actions: ['recordError'] },
          { target: 'CODING', actions: ['incrementIteration'] },
        ],
        ALL_BEADS_DONE: { target: 'RUNNING_FINAL_TEST' },
        BEAD_ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    RUNNING_FINAL_TEST: {
      entry: [
        { type: 'updateStatus', params: { status: 'RUNNING_FINAL_TEST' } },
        'persistState',
        'notifyFrontend',
      ],
      on: {
        TESTS_PASSED: { target: 'INTEGRATING_CHANGES' },
        TESTS_FAILED: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    INTEGRATING_CHANGES: {
      entry: [
        { type: 'updateStatus', params: { status: 'INTEGRATING_CHANGES' } },
        'persistState',
        'notifyFrontend',
      ],
      on: {
        INTEGRATION_DONE: { target: 'WAITING_MANUAL_VERIFICATION' },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    WAITING_MANUAL_VERIFICATION: {
      entry: [
        {
          type: 'updateStatus',
          params: { status: 'WAITING_MANUAL_VERIFICATION' },
        },
        'persistState',
        'notifyFrontend',
      ],
      on: {
        VERIFY_COMPLETE: { target: 'CLEANING_ENV' },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    CLEANING_ENV: {
      entry: [
        { type: 'updateStatus', params: { status: 'CLEANING_ENV' } },
        'persistState',
        'notifyFrontend',
      ],
      on: {
        CLEANUP_DONE: { target: 'COMPLETED' },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    BLOCKED_ERROR: {
      entry: [
        { type: 'updateStatus', params: { status: 'BLOCKED_ERROR' } },
        'persistState',
        'notifyFrontend',
      ],
      on: {
        RETRY: [
          { guard: ({ context }) => context.previousStatus === 'COUNCIL_DELIBERATING', target: 'COUNCIL_DELIBERATING' as const, actions: ['clearError'] },
          { guard: ({ context }) => context.previousStatus === 'COUNCIL_VOTING_INTERVIEW', target: 'COUNCIL_VOTING_INTERVIEW' as const, actions: ['clearError'] },
          { guard: ({ context }) => context.previousStatus === 'COMPILING_INTERVIEW', target: 'COMPILING_INTERVIEW' as const, actions: ['clearError'] },
          { guard: ({ context }) => context.previousStatus === 'WAITING_INTERVIEW_ANSWERS', target: 'WAITING_INTERVIEW_ANSWERS' as const, actions: ['clearError'] },
          { guard: ({ context }) => context.previousStatus === 'VERIFYING_INTERVIEW_COVERAGE', target: 'VERIFYING_INTERVIEW_COVERAGE' as const, actions: ['clearError'] },
          { guard: ({ context }) => context.previousStatus === 'WAITING_INTERVIEW_APPROVAL', target: 'WAITING_INTERVIEW_APPROVAL' as const, actions: ['clearError'] },
          { guard: ({ context }) => context.previousStatus === 'DRAFTING_PRD', target: 'DRAFTING_PRD' as const, actions: ['clearError'] },
          { guard: ({ context }) => context.previousStatus === 'COUNCIL_VOTING_PRD', target: 'COUNCIL_VOTING_PRD' as const, actions: ['clearError'] },
          { guard: ({ context }) => context.previousStatus === 'REFINING_PRD', target: 'REFINING_PRD' as const, actions: ['clearError'] },
          { guard: ({ context }) => context.previousStatus === 'VERIFYING_PRD_COVERAGE', target: 'VERIFYING_PRD_COVERAGE' as const, actions: ['clearError'] },
          { guard: ({ context }) => context.previousStatus === 'WAITING_PRD_APPROVAL', target: 'WAITING_PRD_APPROVAL' as const, actions: ['clearError'] },
          { guard: ({ context }) => context.previousStatus === 'DRAFTING_BEADS', target: 'DRAFTING_BEADS' as const, actions: ['clearError'] },
          { guard: ({ context }) => context.previousStatus === 'COUNCIL_VOTING_BEADS', target: 'COUNCIL_VOTING_BEADS' as const, actions: ['clearError'] },
          { guard: ({ context }) => context.previousStatus === 'REFINING_BEADS', target: 'REFINING_BEADS' as const, actions: ['clearError'] },
          { guard: ({ context }) => context.previousStatus === 'VERIFYING_BEADS_COVERAGE', target: 'VERIFYING_BEADS_COVERAGE' as const, actions: ['clearError'] },
          { guard: ({ context }) => context.previousStatus === 'WAITING_BEADS_APPROVAL', target: 'WAITING_BEADS_APPROVAL' as const, actions: ['clearError'] },
          { guard: ({ context }) => context.previousStatus === 'PRE_FLIGHT_CHECK', target: 'PRE_FLIGHT_CHECK' as const, actions: ['clearError'] },
          { guard: ({ context }) => context.previousStatus === 'CODING', target: 'CODING' as const, actions: ['clearError'] },
          { guard: ({ context }) => context.previousStatus === 'RUNNING_FINAL_TEST', target: 'RUNNING_FINAL_TEST' as const, actions: ['clearError'] },
          { guard: ({ context }) => context.previousStatus === 'INTEGRATING_CHANGES', target: 'INTEGRATING_CHANGES' as const, actions: ['clearError'] },
          { guard: ({ context }) => context.previousStatus === 'WAITING_MANUAL_VERIFICATION', target: 'WAITING_MANUAL_VERIFICATION' as const, actions: ['clearError'] },
          { guard: ({ context }) => context.previousStatus === 'CLEANING_ENV', target: 'CLEANING_ENV' as const, actions: ['clearError'] },
          { target: 'DRAFT' as const, actions: ['clearError'] },
        ],
        CANCEL: { target: 'CANCELED' },
      },
    },
    COMPLETED: {
      type: 'final' as const,
      entry: [
        { type: 'updateStatus', params: { status: 'COMPLETED' } },
        'persistState',
        'notifyFrontend',
      ],
    },
    CANCELED: {
      type: 'final' as const,
      entry: [
        { type: 'updateStatus', params: { status: 'CANCELED' } },
        'persistState',
        'notifyFrontend',
      ],
    },
  },
})

export type TicketMachine = typeof ticketMachine
