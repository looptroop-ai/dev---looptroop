/**
 * Shared test factories for client-side tests.
 * Eliminates hardcoded ticket IDs, model names, and project-specific data.
 */
import type { Ticket } from '@/hooks/useTickets'

// ---------------------------------------------------------------------------
// Generic test constants — never reference real ticket/project names
// ---------------------------------------------------------------------------
export const TEST = {
  ticketId: '1:TEST-1',
  externalId: 'TEST-1',
  projectId: 1,
  projectName: 'TestProject',
  shortname: 'TEST',
  model: 'test-vendor/test-model',
  implementer: 'test-vendor/test-implementer',
  councilMembers: ['test-vendor/council-a', 'test-vendor/council-b'] as string[],
  timestamp: '2026-01-01T00:00:00.000Z',
} as const

// ---------------------------------------------------------------------------
// Client Ticket factory
// ---------------------------------------------------------------------------
export function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: TEST.ticketId,
    externalId: TEST.externalId,
    projectId: TEST.projectId,
    title: 'Test ticket',
    description: null,
    priority: 3,
    status: 'DRAFT',
    xstateSnapshot: null,
    branchName: null,
    currentBead: null,
    totalBeads: null,
    percentComplete: null,
    errorMessage: null,
    errorSeenSignature: null,
    errorOccurrences: [],
    activeErrorOccurrenceId: null,
    hasPastErrors: false,
    lockedMainImplementer: null,
    lockedMainImplementerVariant: null,
    lockedCouncilMembers: [...TEST.councilMembers],
    lockedCouncilMemberVariants: null,
    availableActions: [],
    previousStatus: null,
    reviewCutoffStatus: null,
    runtime: {
      baseBranch: 'main',
      currentBead: 0,
      completedBeads: 0,
      totalBeads: 0,
      percentComplete: 0,
      iterationCount: 0,
      maxIterations: null,
      maxIterationsPerBead: null,
      activeBeadId: null,
      activeBeadIteration: null,
      lastFailedBeadId: null,
      artifactRoot: '/tmp/test-ticket',
      beads: [],
      candidateCommitSha: null,
      preSquashHead: null,
      finalTestStatus: 'pending',
    },
    startedAt: null,
    plannedDate: null,
    createdAt: TEST.timestamp,
    updatedAt: TEST.timestamp,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Log entry factory
// ---------------------------------------------------------------------------
export function makeLogEntry(overrides: Record<string, unknown> = {}) {
  return {
    ts: Date.now(),
    phase: 'CODING',
    event: 'test_event',
    detail: 'Test detail',
    ...overrides,
  }
}
