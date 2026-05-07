import { afterAll, describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import {
  makeBeadsYaml,
  makeInterviewYaml,
  makePrdYaml,
} from '../../test/factories'
import { createInitializedTestTicket, createTestRepoManager, resetTestDb } from '../../test/integration'
import { upsertLatestPhaseArtifact } from '../../storage/tickets'
import {
  buildPullRequestContext,
  buildPullRequestPrompt,
} from '../phases/pullRequestPhase'

describe('pull request drafting context', () => {
  const repoManager = createTestRepoManager('pull-request-phase-')

  afterAll(() => {
    resetTestDb()
    repoManager.cleanup()
  })

  it('uses only ticket details and PRD as context while appending reports and diff sections explicitly', () => {
    resetTestDb()
    const { ticket, context, paths } = createInitializedTestTicket(repoManager, {
      title: 'Draft concise PR',
      description: 'Explain the implementation without replaying planning context.',
    })

    writeFileSync(`${paths.ticketDir}/interview.yaml`, makeInterviewYaml({ ticket_id: ticket.externalId }))
    writeFileSync(`${paths.ticketDir}/prd.yaml`, makePrdYaml({
      ticketId: ticket.externalId,
      problemStatement: 'Use PRD requirements as the reviewer-facing why.',
    }))
    writeFileSync(paths.beadsPath, makeBeadsYaml({ beadCount: 1 }))
    upsertLatestPhaseArtifact(
      ticket.id,
      'final_test_report',
      'RUNNING_FINAL_TEST',
      JSON.stringify({ status: 'passed', summary: 'Final tests passed.' }),
    )

    const { contextParts, finalTestReport } = buildPullRequestContext(
      ticket.id,
      context,
      ticket.description ?? '',
    )
    const prompt = buildPullRequestPrompt({
      fallbackTitle: `${ticket.externalId}: ${ticket.title}`,
      contextParts,
      integrationReport: '{"candidateCommitSha":"abc123"}',
      finalTestReport,
      diffStat: '1 file changed, 2 insertions(+)',
      diffNameStatus: 'M\tsrc/example.ts',
      diffPatch: 'diff --git a/src/example.ts b/src/example.ts',
    })

    expect(contextParts.map((part) => part.source)).toEqual(['ticket_details', 'prd'])
    expect(prompt).toContain('### ticket_details')
    expect(prompt).toContain('### prd')
    expect(prompt).toContain('Use PRD requirements as the reviewer-facing why.')
    expect(prompt).toContain('### integration_report')
    expect(prompt).toContain('### final_test_report')
    expect(prompt).toContain('Final tests passed.')
    expect(prompt).toContain('### final_diff_stat')
    expect(prompt).toContain('### final_diff_name_status')
    expect(prompt).toContain('### final_diff_patch')
    expect(prompt).not.toContain('artifact: interview')
    expect(prompt).not.toContain('beads:')
  })
})
