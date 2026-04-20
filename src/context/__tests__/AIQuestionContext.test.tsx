import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AIQuestionProvider } from '../AIQuestionContext'
import { useAIQuestions } from '../useAIQuestions'
import { makeTicket, TEST } from '@/test/factories'

class MockEventSource {
  onerror: (() => void) | null = null
  addEventListener() {
    return undefined
  }
  close() {
    return undefined
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
    const ticket = makeTicket({ status: 'CODING' })
    vi.stubGlobal('EventSource', MockEventSource)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      questions: [{
        type: 'opencode_question',
        ticketId: ticket.id,
        ticketExternalId: ticket.externalId,
        ticketTitle: ticket.title,
        status: 'CODING',
        phase: 'CODING',
        modelId: TEST.model,
        sessionId: 'session-1234567890',
        requestId: 'question-1',
        questions: [{
          header: 'Choose path',
          question: 'Which implementation path should I use?',
          options: [{ label: 'Small', description: 'Keep the change narrow' }],
          custom: true,
        }],
        timestamp: TEST.timestamp,
      }],
    }), { status: 200 })))

    render(
      <AIQuestionProvider tickets={[ticket]}>
        <PendingCount ticketId={ticket.id} />
      </AIQuestionProvider>,
    )

    expect(await screen.findByText('Choose path')).toBeInTheDocument()
    expect(screen.getByText(new RegExp(TEST.externalId))).toBeInTheDocument()
    expect(screen.getByText(new RegExp(TEST.model.replace('/', '\\/')))).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('pending:1')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /minimize ai question/i }))

    expect(screen.getByText('AI question waiting')).toBeInTheDocument()
    expect(screen.getByText(/1 pending/)).toBeInTheDocument()
  })
})
