import { describe, expect, it } from 'vitest'
import { buildMinimalContext } from '../contextBuilder'

describe('contextBuilder interview_qa context', () => {
  it('injects the frozen user interview profile into PROM4 ticket details', () => {
    const parts = buildMinimalContext('interview_qa', {
      ticketId: 'PROJ-42',
      title: 'Stabilize webhook retries',
      description: 'The sync webhook needs a clear retry and failure-handling strategy.',
      userBackground: 'SRE',
      disableAnalogies: true,
      codebaseMap: '# Codebase Map',
      interview: 'questions:\n  - id: Q01',
      userAnswers: 'Q01: Existing retries are inconsistent.',
    })

    const ticketDetails = parts.find((part) => part.source === 'ticket_details')

    expect(ticketDetails?.content).toContain('## User Interview Profile')
    expect(ticketDetails?.content).toContain('Background / expertise: SRE')
    expect(ticketDetails?.content).toContain('avoid analogies unless they are essential for clarity')
  })
})
