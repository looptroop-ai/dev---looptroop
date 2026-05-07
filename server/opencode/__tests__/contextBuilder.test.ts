import { describe, expect, it } from 'vitest'
import { TEST } from '../../test/factories'
import { buildMinimalContext } from '../contextBuilder'

describe('contextBuilder interview_qa context', () => {
  it('keeps PROM4 ticket details focused on the ticket requirement', () => {
    const parts = buildMinimalContext('interview_qa', {
      ticketId: TEST.externalId,
      title: 'Stabilize webhook retries',
      description: 'The sync webhook needs a clear retry and failure-handling strategy.',
      relevantFiles: '# Relevant Files',
      interview: 'questions:\n  - id: Q01',
      userAnswers: 'Q01: Existing retries are inconsistent.',
    })

    const ticketDetails = parts.find((part) => part.source === 'ticket_details')

    expect(ticketDetails?.content).toContain('## Primary User Requirement For This Ticket')
    expect(ticketDetails?.content).not.toContain('## User Interview Profile')
    expect(parts.map((part) => part.source)).toEqual(['ticket_details'])
  })

  it('keeps PRD coverage focused on winner full answers and PRD only', () => {
    const parts = buildMinimalContext('prd_coverage', {
      ticketId: TEST.externalId,
      interview: 'approved interview content',
      fullAnswers: ['winner full answers content'],
      prd: 'prd candidate content',
    })

    expect(parts.map((part) => part.source)).toEqual([
      'full_answers',
      'prd',
    ])
    expect(parts.map((part) => part.content).join('\n')).not.toContain('approved interview content')
  })

  it('keeps final test context to ticket details, PRD, beads, and retry notes', () => {
    const parts = buildMinimalContext('final_test', {
      ticketId: TEST.externalId,
      title: 'Final verification',
      description: 'Verify the implementation.',
      interview: 'approved interview content',
      prd: 'approved prd content',
      beads: 'approved beads content',
      finalTestNotes: ['final test retry note'],
    })

    expect(parts.map((part) => part.source)).toEqual([
      'ticket_details',
      'prd',
      'beads',
      'final_test_note',
    ])
    expect(parts.map((part) => part.content).join('\n')).not.toContain('approved interview content')
  })

  it('keeps pull request context to ticket details and PRD only', () => {
    const parts = buildMinimalContext('pull_request', {
      ticketId: TEST.externalId,
      title: 'Draft PR',
      description: 'Explain the finished change.',
      interview: 'approved interview content',
      prd: 'approved prd content',
      beads: 'approved beads content',
    })

    expect(parts.map((part) => part.source)).toEqual([
      'ticket_details',
      'prd',
    ])
    expect(parts.map((part) => part.content).join('\n')).not.toContain('approved interview content')
    expect(parts.map((part) => part.content).join('\n')).not.toContain('approved beads content')
  })

  it('keeps coding context to bead data and retry notes without inlining setup profile', () => {
    const parts = buildMinimalContext('coding', {
      ticketId: TEST.externalId,
      beadData: 'Bead A',
      beadNotes: ['prior coding retry'],
      executionSetupProfile: '{"artifact":"execution_setup_profile","status":"ready"}',
      executionSetupNotes: ['setup retry note'],
    })

    expect(parts.map((part) => part.source)).toEqual([
      'bead_data',
      'bead_note',
    ])
  })

  it('includes execution setup retry notes in the execution setup phase context', () => {
    const parts = buildMinimalContext('execution_setup', {
      ticketId: TEST.externalId,
      title: 'Prepare runtime',
      description: 'Initialize the environment.',
      relevantFiles: '# Relevant Files',
      prd: 'artifact: prd',
      beads: '{"id":"bead-1"}',
      executionSetupPlan: '{"artifact":"execution_setup_plan","status":"draft"}',
      executionSetupNotes: ['avoid writing to node_modules'],
    })

    expect(parts.map((part) => part.source)).toEqual([
      'ticket_details',
      'beads',
      'execution_setup_plan',
      'execution_setup_note',
    ])
  })

  it('includes setup-plan notes in the execution setup plan context', () => {
    const parts = buildMinimalContext('execution_setup_plan', {
      ticketId: TEST.externalId,
      title: 'Prepare runtime',
      description: 'Initialize the environment.',
      relevantFiles: '# Relevant Files',
      prd: 'artifact: prd',
      beads: '{"id":"bead-1"}',
      executionSetupProfile: '{"artifact":"execution_setup_profile","status":"ready"}',
      executionSetupPlanNotes: ['Use pnpm instead of npm.'],
    })

    expect(parts.map((part) => part.source)).toEqual([
      'ticket_details',
      'relevant_files',
      'prd',
      'beads',
      'execution_setup_profile',
      'execution_setup_plan_note',
    ])
  })
})
