import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/renderHelpers'
import { TEST } from '@/test/factories'
import { ApprovalNavigator } from '../ApprovalNavigator'

describe('ApprovalNavigator', () => {
  it('renders the interview approval navigator for interview approval phases', () => {
    renderWithProviders(<ApprovalNavigator ticketId={TEST.ticketId} phase="WAITING_INTERVIEW_APPROVAL" />)

    expect(screen.getByText('Interview Results')).toBeInTheDocument()
    expect(screen.queryByText('PRD Approval')).not.toBeInTheDocument()
  })

  it('renders the PRD approval navigator for PRD approval phases', () => {
    renderWithProviders(<ApprovalNavigator ticketId={TEST.ticketId} phase="WAITING_PRD_APPROVAL" />)

    expect(screen.getByText('PRD Approval')).toBeInTheDocument()
    expect(screen.queryByText('Interview Results')).not.toBeInTheDocument()
  })
})
