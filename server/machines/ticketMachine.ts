import { assign, setup } from 'xstate'
import type { TicketContext, TicketEvent } from './types'
import { PROFILE_DEFAULTS } from '../db/defaults'

type TicketInput = Partial<TicketContext>

export const ticketMachine = setup({
  types: {
    context: {} as TicketContext,
    events: {} as TicketEvent,
    input: {} as TicketInput,
  },
  actions: {
    recordError: assign({
      error: ({ event }) => {
        if (event.type === 'ERROR') return event.message
        if (event.type === 'INIT_FAILED') return event.message
        if (event.type === 'CHECKS_FAILED') return 'Pre-flight check failed'
        if (event.type === 'EXECUTION_SETUP_PLAN_FAILED') return 'Execution setup plan failed'
        if (event.type === 'EXECUTION_SETUP_FAILED') return 'Execution setup failed'
        if (event.type === 'TESTS_FAILED') return 'Final test failed'
        if (event.type === 'BEAD_ERROR') return 'Bead execution failed'
        return 'Unknown error'
      },
      errorCodes: ({ event }) => {
        if (event.type === 'ERROR') return event.codes ?? []
        if (event.type === 'INIT_FAILED') return event.codes ?? []
        if (event.type === 'CHECKS_FAILED') return event.errors
        if (event.type === 'EXECUTION_SETUP_PLAN_FAILED') return event.errors ?? []
        if (event.type === 'EXECUTION_SETUP_FAILED') return event.errors ?? []
        if (event.type === 'BEAD_ERROR') return event.codes ?? []
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
  },
  guards: {
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
    lockedMainImplementerVariant: input.lockedMainImplementerVariant ?? null,
    lockedCouncilMembers: input.lockedCouncilMembers ?? null,
    lockedCouncilMemberVariants: input.lockedCouncilMemberVariants ?? null,
    lockedInterviewQuestions: input.lockedInterviewQuestions ?? null,
    lockedCoverageFollowUpBudgetPercent: input.lockedCoverageFollowUpBudgetPercent ?? null,
    lockedMaxCoveragePasses: input.lockedMaxCoveragePasses ?? null,
    previousStatus: null,
    error: null,
    errorCodes: [],
    beadProgress: { total: 0, completed: 0, current: null },
    iterationCount: 0,
    maxIterations: input.maxIterations ?? PROFILE_DEFAULTS.maxIterations,
    councilResults: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  states: {
    DRAFT: {
      entry: [
        { type: 'updateStatus', params: { status: 'DRAFT' } },
      ],
      on: {
        START: {
          target: 'SCANNING_RELEVANT_FILES',
          actions: assign({
            lockedMainImplementer: ({ event }) => event.lockedMainImplementer ?? null,
            lockedMainImplementerVariant: ({ event }) => event.lockedMainImplementerVariant ?? null,
            lockedCouncilMembers: ({ event }) => event.lockedCouncilMembers ?? null,
            lockedCouncilMemberVariants: ({ event }) => event.lockedCouncilMemberVariants ?? null,
            lockedInterviewQuestions: ({ event }) => event.lockedInterviewQuestions ?? null,
            lockedCoverageFollowUpBudgetPercent: ({ event }) => event.lockedCoverageFollowUpBudgetPercent ?? null,
            lockedMaxCoveragePasses: ({ event }) => event.lockedMaxCoveragePasses ?? null,
          }),
        },
        INIT_FAILED: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    SCANNING_RELEVANT_FILES: {
      entry: [
        { type: 'updateStatus', params: { status: 'SCANNING_RELEVANT_FILES' } },
      ],
      on: {
        RELEVANT_FILES_READY: { target: 'COUNCIL_DELIBERATING' },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    COUNCIL_DELIBERATING: {
      entry: [
        { type: 'updateStatus', params: { status: 'COUNCIL_DELIBERATING' } },
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
      ],
      on: {
        BATCH_ANSWERED: { target: 'WAITING_INTERVIEW_ANSWERS' },
        INTERVIEW_COMPLETE: { target: 'VERIFYING_INTERVIEW_COVERAGE' },
        SKIP_ALL_TO_APPROVAL: { target: 'WAITING_INTERVIEW_APPROVAL' },
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
      ],
      on: {
        COVERAGE_CLEAN: { target: 'WAITING_INTERVIEW_APPROVAL' },
        GAPS_FOUND: { target: 'WAITING_INTERVIEW_ANSWERS' },
        COVERAGE_LIMIT_REACHED: { target: 'WAITING_INTERVIEW_APPROVAL' },
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
      ],
      on: {
        APPROVE: { target: 'DRAFTING_PRD' },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    DRAFTING_PRD: {
      entry: [
        { type: 'updateStatus', params: { status: 'DRAFTING_PRD' } },
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
      ],
      on: {
        COVERAGE_CLEAN: { target: 'WAITING_PRD_APPROVAL' },
        GAPS_FOUND: { target: 'REFINING_PRD' },
        COVERAGE_LIMIT_REACHED: { target: 'WAITING_PRD_APPROVAL' },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    WAITING_PRD_APPROVAL: {
      entry: [
        { type: 'updateStatus', params: { status: 'WAITING_PRD_APPROVAL' } },
      ],
      on: {
        APPROVE: { target: 'DRAFTING_BEADS' },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    DRAFTING_BEADS: {
      entry: [
        { type: 'updateStatus', params: { status: 'DRAFTING_BEADS' } },
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
      ],
      on: {
        COVERAGE_CLEAN: { target: 'WAITING_BEADS_APPROVAL' },
        GAPS_FOUND: { target: 'REFINING_BEADS' },
        COVERAGE_LIMIT_REACHED: { target: 'WAITING_BEADS_APPROVAL' },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    WAITING_BEADS_APPROVAL: {
      entry: [
        { type: 'updateStatus', params: { status: 'WAITING_BEADS_APPROVAL' } },
      ],
      on: {
        APPROVE: { target: 'PRE_FLIGHT_CHECK' },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    PRE_FLIGHT_CHECK: {
      entry: [
        { type: 'updateStatus', params: { status: 'PRE_FLIGHT_CHECK' } },
      ],
      on: {
        CHECKS_PASSED: { target: 'WAITING_EXECUTION_SETUP_APPROVAL' },
        CHECKS_FAILED: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    WAITING_EXECUTION_SETUP_APPROVAL: {
      entry: [
        { type: 'updateStatus', params: { status: 'WAITING_EXECUTION_SETUP_APPROVAL' } },
      ],
      on: {
        EXECUTION_SETUP_PLAN_READY: {},
        REGENERATE_EXECUTION_SETUP_PLAN: {},
        APPROVE_EXECUTION_SETUP_PLAN: { target: 'PREPARING_EXECUTION_ENV' },
        EXECUTION_SETUP_PLAN_FAILED: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    PREPARING_EXECUTION_ENV: {
      entry: [
        { type: 'updateStatus', params: { status: 'PREPARING_EXECUTION_ENV' } },
      ],
      on: {
        EXECUTION_SETUP_READY: { target: 'CODING' },
        EXECUTION_SETUP_FAILED: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    CODING: {
      entry: [
        { type: 'updateStatus', params: { status: 'CODING' } },
      ],
      on: {
        BEAD_COMPLETE: [
          { guard: 'allBeadsComplete', target: 'RUNNING_FINAL_TEST' },
          { target: 'CODING' },
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
      ],
      on: {
        INTEGRATION_DONE: { target: 'CREATING_PULL_REQUEST' },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    CREATING_PULL_REQUEST: {
      entry: [
        {
          type: 'updateStatus',
          params: { status: 'CREATING_PULL_REQUEST' },
        },
      ],
      on: {
        PULL_REQUEST_READY: { target: 'WAITING_PR_REVIEW' },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    WAITING_PR_REVIEW: {
      entry: [
        {
          type: 'updateStatus',
          params: { status: 'WAITING_PR_REVIEW' },
        },
      ],
      on: {
        MERGE_COMPLETE: { target: 'CLEANING_ENV' },
        CLOSE_UNMERGED_COMPLETE: { target: 'CLEANING_ENV' },
        ERROR: { target: 'BLOCKED_ERROR', actions: ['recordError'] },
        CANCEL: { target: 'CANCELED' },
      },
    },
    CLEANING_ENV: {
      entry: [
        { type: 'updateStatus', params: { status: 'CLEANING_ENV' } },
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
      ],
      on: {
        RETRY: [
          { guard: ({ context }) => context.previousStatus === 'DRAFT', target: 'DRAFT' as const, actions: ['clearError'] },
          { guard: ({ context }) => context.previousStatus === 'SCANNING_RELEVANT_FILES', target: 'SCANNING_RELEVANT_FILES' as const, actions: ['clearError'] },
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
          { guard: ({ context }) => context.previousStatus === 'WAITING_EXECUTION_SETUP_APPROVAL', target: 'WAITING_EXECUTION_SETUP_APPROVAL' as const, actions: ['clearError'] },
          { guard: ({ context }) => context.previousStatus === 'PREPARING_EXECUTION_ENV', target: 'PREPARING_EXECUTION_ENV' as const, actions: ['clearError'] },
          { guard: ({ context }) => context.previousStatus === 'CODING', target: 'CODING' as const, actions: ['clearError'] },
          { guard: ({ context }) => context.previousStatus === 'RUNNING_FINAL_TEST', target: 'RUNNING_FINAL_TEST' as const, actions: ['clearError'] },
          { guard: ({ context }) => context.previousStatus === 'INTEGRATING_CHANGES', target: 'INTEGRATING_CHANGES' as const, actions: ['clearError'] },
          { guard: ({ context }) => context.previousStatus === 'CREATING_PULL_REQUEST', target: 'CREATING_PULL_REQUEST' as const, actions: ['clearError'] },
          { guard: ({ context }) => context.previousStatus === 'WAITING_PR_REVIEW', target: 'WAITING_PR_REVIEW' as const, actions: ['clearError'] },
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
      ],
    },
    CANCELED: {
      type: 'final' as const,
      entry: [
        { type: 'updateStatus', params: { status: 'CANCELED' } },
      ],
    },
  },
})
