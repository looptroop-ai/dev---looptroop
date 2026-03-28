import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CouncilView } from '../CouncilView'
import type { Ticket } from '@/hooks/useTickets'

vi.mock('@/hooks/useTicketArtifacts', () => ({
  useTicketArtifacts: () => ({
    artifacts: [],
    isLoading: true,
  }),
}))

vi.mock('../PhaseArtifactsPanel', () => ({
  PhaseArtifactsPanel: ({
    phase,
    ticketId,
  }: {
    phase: string
    ticketId?: string
  }) => <div data-testid="phase-artifacts-panel">{phase}:{ticketId}</div>,
}))

vi.mock('../CollapsiblePhaseLogSection', () => ({
  CollapsiblePhaseLogSection: ({ phase }: { phase: string }) => <div data-testid="phase-log-section">{phase}</div>,
}))

function makeTicket(status: string): Ticket {
  return {
    id: '1:T-42',
    externalId: 'T-42',
    projectId: 1,
    title: 'Fix drafting flash',
    description: 'Keep the PRD drafting view visible while artifacts load.',
    priority: 3,
    status,
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
    lockedCouncilMembers: ['openai/gpt-5-codex', 'openai/gpt-5-mini'],
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
      artifactRoot: '/tmp/ticket',
      beads: [],
      candidateCommitSha: null,
      preSquashHead: null,
      finalTestStatus: 'pending',
    },
    startedAt: null,
    plannedDate: null,
    createdAt: '2026-03-11T10:00:00.000Z',
    updatedAt: '2026-03-11T10:00:00.000Z',
  }
}

describe('CouncilView', () => {
  it('keeps the live council view visible while artifacts are still loading', () => {
    render(<CouncilView phase="DRAFTING_PRD" ticket={makeTicket('DRAFTING_PRD')} />)

    expect(screen.getByText('AI Council — PRD Drafting')).toBeInTheDocument()
    expect(screen.getByText('Each council model is independently generating a prd draft.')).toBeInTheDocument()
    expect(screen.getByTestId('phase-artifacts-panel')).toHaveTextContent('DRAFTING_PRD:1:T-42')
    expect(screen.getByTestId('phase-log-section')).toHaveTextContent('DRAFTING_PRD')
    expect(screen.queryByText('Loading phase data…')).not.toBeInTheDocument()
  })
})
