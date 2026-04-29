import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CouncilView } from '../CouncilView'
import { makeTicket, TEST } from '@/test/factories'

const mockUseTicketArtifacts = vi.fn()
const mockUseTicketPhaseAttempts = vi.fn()

vi.mock('@/hooks/useTicketArtifacts', () => ({
  useTicketArtifacts: (...args: unknown[]) => mockUseTicketArtifacts(...args),
}))

vi.mock('@/hooks/useTicketPhaseAttempts', () => ({
  useTicketPhaseAttempts: (...args: unknown[]) => mockUseTicketPhaseAttempts(...args),
}))

vi.mock('../PhaseArtifactsPanel', () => ({
  PhaseArtifactsPanel: ({
    phase,
    ticketId,
    preloadedArtifacts,
  }: {
    phase: string
    ticketId?: string
    preloadedArtifacts?: Array<{ content?: string | null }>
  }) => <div data-testid="phase-artifacts-panel">{phase}:{ticketId}:{preloadedArtifacts?.[0]?.content ?? ''}</div>,
}))

vi.mock('../CollapsiblePhaseLogSection', () => ({
  CollapsiblePhaseLogSection: ({
    phase,
    phaseAttempt,
  }: {
    phase: string
    phaseAttempt?: number
  }) => <div data-testid="phase-log-section">{phase}:{phaseAttempt ?? 'active'}</div>,
}))

describe('CouncilView', () => {
  beforeEach(() => {
    mockUseTicketArtifacts.mockReturnValue({
      artifacts: [],
      isLoading: true,
    })
    mockUseTicketPhaseAttempts.mockReturnValue({ data: [] })
  })

  it('keeps the live council view visible while artifacts are still loading', () => {
    render(<CouncilView phase="DRAFTING_PRD" ticket={makeTicket({ status: 'DRAFTING_PRD' })} />)

    expect(screen.getByText('AI Council — PRD Drafting')).toBeInTheDocument()
    expect(screen.getByText('Each council model is independently generating a prd draft.')).toBeInTheDocument()
    expect(screen.getByTestId('phase-artifacts-panel')).toHaveTextContent(`DRAFTING_PRD:${TEST.ticketId}`)
    expect(screen.getByTestId('phase-log-section')).toHaveTextContent('DRAFTING_PRD')
    expect(screen.queryByText('Loading phase data…')).not.toBeInTheDocument()
  })

  it('shows archived live-phase versions as soon as a fresh active attempt exists', () => {
    mockUseTicketPhaseAttempts.mockReturnValue({
      data: [
        {
          ticketId: TEST.ticketId,
          phase: 'DRAFTING_PRD',
          attemptNumber: 2,
          state: 'active',
          archivedReason: null,
          createdAt: '2026-04-29T12:00:00.000Z',
          archivedAt: null,
        },
        {
          ticketId: TEST.ticketId,
          phase: 'DRAFTING_PRD',
          attemptNumber: 1,
          state: 'archived',
          archivedReason: 'interview_edit_restart',
          createdAt: '2026-04-29T11:00:00.000Z',
          archivedAt: '2026-04-29T12:00:00.000Z',
        },
      ],
    })
    mockUseTicketArtifacts.mockImplementation((_ticketId: string, options?: { phaseAttempt?: number }) => ({
      artifacts: options?.phaseAttempt === 1
        ? [{ content: 'archived-prd-draft' }]
        : [{ content: 'current-prd-draft' }],
      isLoading: false,
    }))

    render(<CouncilView phase="DRAFTING_PRD" ticket={makeTicket({ status: 'DRAFTING_PRD' })} />)

    const selector = screen.getByRole('combobox', { name: /version/i })
    expect(selector).toHaveValue('2')
    expect(screen.getByText('Current version (2)')).toBeInTheDocument()
    expect(screen.getByText('Archived version 1')).toBeInTheDocument()
    expect(screen.getByTestId('phase-artifacts-panel')).toHaveTextContent('current-prd-draft')
    expect(screen.getByTestId('phase-log-section')).toHaveTextContent('DRAFTING_PRD:active')

    fireEvent.change(selector, { target: { value: '1' } })

    expect(mockUseTicketArtifacts).toHaveBeenCalledWith(TEST.ticketId, {
      phase: 'DRAFTING_PRD',
      phaseAttempt: 1,
    })
    expect(screen.getByTestId('phase-artifacts-panel')).toHaveTextContent('archived-prd-draft')
    expect(screen.getByTestId('phase-log-section')).toHaveTextContent('DRAFTING_PRD:1')
  })
})
