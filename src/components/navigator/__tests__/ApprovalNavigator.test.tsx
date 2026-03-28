import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApprovalNavigator } from '../ApprovalNavigator'

vi.mock('../InterviewApprovalNavigator', () => ({
  InterviewApprovalNavigator: ({ ticketId }: { ticketId: string }) => <div data-testid="interview-approval-navigator">{ticketId}</div>,
}))

vi.mock('../PrdApprovalNavigator', () => ({
  PrdApprovalNavigator: ({ ticketId }: { ticketId: string }) => <div data-testid="prd-approval-navigator">{ticketId}</div>,
}))

describe('ApprovalNavigator', () => {
  it('renders the interview approval navigator for interview approval phases', () => {
    render(<ApprovalNavigator ticketId="1:PROJ-42" phase="WAITING_INTERVIEW_APPROVAL" />)

    expect(screen.getByTestId('interview-approval-navigator')).toHaveTextContent('1:PROJ-42')
    expect(screen.queryByTestId('prd-approval-navigator')).not.toBeInTheDocument()
  })

  it('renders the PRD approval navigator for PRD approval phases', () => {
    render(<ApprovalNavigator ticketId="1:PROJ-42" phase="WAITING_PRD_APPROVAL" />)

    expect(screen.getByTestId('prd-approval-navigator')).toHaveTextContent('1:PROJ-42')
    expect(screen.queryByTestId('interview-approval-navigator')).not.toBeInTheDocument()
  })
})
