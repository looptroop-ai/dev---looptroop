import { describe, expect, it } from 'vitest'
import { buildMinimalContext } from '../contextBuilder'

describe('contextBuilder interview_qa context', () => {
  it('keeps PROM4 ticket details focused on the ticket requirement', () => {
    const parts = buildMinimalContext('interview_qa', {
      ticketId: 'PROJ-42',
      title: 'Stabilize webhook retries',
      description: 'The sync webhook needs a clear retry and failure-handling strategy.',
      relevantFiles: '# Relevant Files',
      interview: 'questions:\n  - id: Q01',
      userAnswers: 'Q01: Existing retries are inconsistent.',
    })

    const ticketDetails = parts.find((part) => part.source === 'ticket_details')

    expect(ticketDetails?.content).toContain('## Primary User Requirement For This Ticket')
    expect(ticketDetails?.content).not.toContain('## User Interview Profile')
  })
})
