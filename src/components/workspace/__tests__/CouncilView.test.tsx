import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CouncilView } from '../CouncilView'
import type { Ticket } from '@/hooks/useTickets'

const mockUseTicketArtifacts = vi.fn()

vi.mock('@/hooks/useTicketArtifacts', () => ({
  useTicketArtifacts: (...args: unknown[]) => mockUseTicketArtifacts(...args),
}))

vi.mock('../PhaseArtifactsPanel', () => ({
  PhaseArtifactsPanel: () => <div>Artifacts</div>,
}))

vi.mock('../PhaseLogPanel', () => ({
  PhaseLogPanel: () => <div>Logs</div>,
}))

const baseTicket: Ticket = {
  id: '7:KRPI4-7',
  externalId: 'KRPI4-7',
  projectId: 7,
  title: 'Council live state test',
  description: null,
  priority: 3,
  status: 'COUNCIL_DELIBERATING',
  xstateSnapshot: null,
  branchName: 'KRPI4-7',
  currentBead: null,
  totalBeads: null,
  percentComplete: null,
  errorMessage: null,
  lockedMainImplementer: null,
  lockedCouncilMembers: null,
  startedAt: null,
  plannedDate: null,
  createdAt: '2026-03-10T08:28:04.000Z',
  updatedAt: '2026-03-10T08:28:04.000Z',
}

describe('CouncilView', () => {
  beforeEach(() => {
    mockUseTicketArtifacts.mockReset()
  })

  it('delegates live member rendering to the artifacts panel', () => {
    mockUseTicketArtifacts.mockReturnValue({
      isLoading: false,
      artifacts: [
        {
          id: 1,
          ticketId: '7:KRPI4-7',
          phase: 'COUNCIL_DELIBERATING',
          artifactType: 'interview_drafts',
          filePath: null,
          createdAt: '2026-03-10T08:28:07.962Z',
          content: JSON.stringify({
            drafts: [
              {
                memberId: 'openai/codex-mini-latest',
                outcome: 'completed',
                content: '1. Why now?\n2. How will users adopt it?\n3. What will break?',
              },
              {
                memberId: 'anthropic/claude-sonnet-4',
                outcome: 'failed',
                error: 'provider offline',
              },
              {
                memberId: 'google/gemini-2.5-pro',
                outcome: 'pending',
              },
            ],
          }),
        },
      ],
    })

    render(
      <CouncilView
        phase="COUNCIL_DELIBERATING"
        ticket={{
          ...baseTicket,
          lockedCouncilMembers: JSON.stringify([
            'openai/codex-mini-latest',
            'anthropic/claude-sonnet-4',
            'google/gemini-2.5-pro',
          ]),
        }}
      />,
    )

    expect(screen.getByText('AI Council — Interview Drafting')).toBeInTheDocument()
    expect(screen.getByText('Artifacts')).toBeInTheDocument()
    expect(screen.getByText('Logs')).toBeInTheDocument()
    expect(screen.queryByText('claude-sonnet-4')).not.toBeInTheDocument()
    expect(screen.queryByText('Failed')).not.toBeInTheDocument()
    expect(screen.queryByText(/waiting for response/i)).not.toBeInTheDocument()
  })

  it('does not render a duplicate refinement member row around the artifacts panel', () => {
    mockUseTicketArtifacts.mockReturnValue({
      isLoading: false,
      artifacts: [
        {
          id: 1,
          ticketId: '7:KRPI4-7',
          phase: 'COUNCIL_DELIBERATING',
          artifactType: 'interview_drafts',
          filePath: null,
          createdAt: '2026-03-10T08:30:40.353Z',
          content: JSON.stringify({
            drafts: [
              {
                memberId: 'openai/codex-mini-latest',
                outcome: 'completed',
                content: 'legacy interview draft',
              },
            ],
          }),
        },
        {
          id: 2,
          ticketId: '7:KRPI4-7',
          phase: 'COUNCIL_VOTING_PRD',
          artifactType: 'prd_votes',
          filePath: null,
          createdAt: '2026-03-10T08:40:00.000Z',
          content: JSON.stringify({
            winnerId: 'anthropic/claude-sonnet-4',
            drafts: [
              {
                memberId: 'anthropic/claude-sonnet-4',
                outcome: 'completed',
                content: '# Winning PRD',
              },
              {
                memberId: 'openai/gpt-5',
                outcome: 'completed',
                content: '# Runner up PRD',
              },
            ],
            votes: [
              {
                voterId: 'openai/gpt-5',
                draftId: 'anthropic/claude-sonnet-4',
                totalScore: 9,
                scores: [],
              },
            ],
            voterOutcomes: {
              'anthropic/claude-sonnet-4': 'completed',
              'openai/gpt-5': 'completed',
            },
          }),
        },
      ],
    })

    render(
      <CouncilView
        phase="REFINING_PRD"
        ticket={{
          ...baseTicket,
          status: 'REFINING_PRD',
          lockedCouncilMembers: JSON.stringify([
            'anthropic/claude-sonnet-4',
            'openai/gpt-5',
          ]),
        }}
      />,
    )

    expect(screen.getByText('AI Council — PRD Refining')).toBeInTheDocument()
    expect(screen.getByText('Artifacts')).toBeInTheDocument()
    expect(screen.getByText('Logs')).toBeInTheDocument()
    expect(screen.queryByText('claude-sonnet-4')).not.toBeInTheDocument()
    expect(screen.queryByText(/Winner — refining draft/i)).not.toBeInTheDocument()
    expect(screen.queryByText('codex-mini-latest')).not.toBeInTheDocument()
  })
})
