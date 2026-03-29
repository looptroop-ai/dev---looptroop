import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CouncilView } from '../CouncilView'
import { makeTicket, TEST } from '@/test/factories'

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

describe('CouncilView', () => {
  it('keeps the live council view visible while artifacts are still loading', () => {
    render(<CouncilView phase="DRAFTING_PRD" ticket={makeTicket({ status: 'DRAFTING_PRD' })} />)

    expect(screen.getByText('AI Council — PRD Drafting')).toBeInTheDocument()
    expect(screen.getByText('Each council model is independently generating a prd draft.')).toBeInTheDocument()
    expect(screen.getByTestId('phase-artifacts-panel')).toHaveTextContent(`DRAFTING_PRD:${TEST.ticketId}`)
    expect(screen.getByTestId('phase-log-section')).toHaveTextContent('DRAFTING_PRD')
    expect(screen.queryByText('Loading phase data…')).not.toBeInTheDocument()
  })
})
