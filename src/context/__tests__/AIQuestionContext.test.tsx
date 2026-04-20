import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AIQuestionProvider, useAIQuestions } from '../AIQuestionContext'
import type { Ticket } from '@/hooks/useTickets'

class MockEventSource {
  onerror: (() => void) | null = null
  addEventListener() {
    return undefined
  }
  close() {
    return undefined
  }
}

function makeTicket(): Ticket {
  return {
    id: 'ticket-1',
    externalId: 'LOOP-1',
    projectId: 1,
    title: 'Build question popup',
    description: null,
    priority: 3,
    status: 'CODING',
    xstateSnapshot: null,
    branchName: null,
    currentBead: null,
    totalBeads: null,
    percentComplete: null,
    errorMessage: null,
    lockedMainImplementer: null,
    lockedCouncilMembers: [],
    availableActions: [],
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
      artifactRoot: '',
      candidateCommitSha: null,
      preSquashHead: null,
      finalTestStatus: 'pending',
    },
    startedAt: null,
    plannedDate: null,
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-20T00:00:00.000Z',
  }
}

function PendingCount({ ticketId }: { ticketId: string }) {
  const { getPendingCount } = useAIQuestions()
  return <div>pending:{getPendingCount(ticketId)}</div>
}

describe('AIQuestionProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('recovers pending questions and shows a minimizable popup', async () => {
    vi.stubGlobal('EventSource', MockEventSource)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      questions: [{
        type: 'opencode_question',
        ticketId: 'ticket-1',
        ticketExternalId: 'LOOP-1',
        ticketTitle: 'Build question popup',
        status: 'CODING',
        phase: 'CODING',
        modelId: 'openai/gpt-5.4',
        sessionId: 'session-1234567890',
        requestId: 'question-1',
        questions: [{
          header: 'Choose path',
          question: 'Which implementation path should I use?',
          options: [{ label: 'Small', description: 'Keep the change narrow' }],
          custom: true,
        }],
        timestamp: '2026-04-20T00:00:00.000Z',
      }],
    }), { status: 200 })))

    render(
      <AIQuestionProvider tickets={[makeTicket()]}>
        <PendingCount ticketId="ticket-1" />
      </AIQuestionProvider>,
    )

    expect(await screen.findByText('Choose path')).toBeInTheDocument()
    expect(screen.getByText(/LOOP-1/)).toBeInTheDocument()
    expect(screen.getByText(/openai\/gpt-5.4/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('pending:1')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /minimize ai question/i }))

    expect(screen.getByText('AI question waiting')).toBeInTheDocument()
    expect(screen.getByText(/1 pending/)).toBeInTheDocument()
  })
})
