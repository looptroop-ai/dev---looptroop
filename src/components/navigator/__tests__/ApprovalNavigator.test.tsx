import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/renderHelpers'
import { TEST } from '@/test/factories'
import { ApprovalNavigator } from '../ApprovalNavigator'

describe('ApprovalNavigator', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

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

  it('renders the execution setup plan navigator for setup-plan approval phases', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      plan: {
        steps: [
          { id: 'deps', title: 'Install dependencies', required: true },
        ],
      },
    }), { status: 200 }) as Response)

    renderWithProviders(<ApprovalNavigator ticketId={TEST.ticketId} phase="WAITING_EXECUTION_SETUP_APPROVAL" />)

    expect(await screen.findByText('Setup Plan')).toBeInTheDocument()
    expect(await screen.findByText('Install dependencies')).toBeInTheDocument()
  })
})
