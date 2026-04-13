import { describe, expect, it } from 'vitest'
import { TEST } from '@/test/factories'
import { buildInterviewDiffEntries, buildRefinementDiffEntries } from '../phaseArtifactTypes'

describe('phaseArtifactTypes', () => {
  it('drops persisted interview ui diff entries when before and after text are trim-identical', () => {
    const interviewDocument = JSON.stringify({
      questions: [
        {
          id: 'Q01',
          phase: 'Foundation',
          question: 'Should the theme switcher keep the same layout?',
        },
      ],
    })

    const entries = buildInterviewDiffEntries(JSON.stringify({
      originalContent: interviewDocument,
      refinedContent: interviewDocument,
      uiRefinementDiff: {
        domain: 'interview',
        winnerId: 'openai/gpt-5.4',
        generatedAt: '2026-04-06T11:38:37.016Z',
        entries: [
          {
            key: 'Q01:modified:0',
            changeType: 'modified',
            itemKind: 'question',
            label: 'Q01',
            beforeId: 'Q01',
            afterId: 'Q01',
            beforeText: 'Should the theme switcher keep the same layout?',
            afterText: '  Should the theme switcher keep the same layout?  ',
            attributionStatus: 'model_unattributed',
          },
        ],
      },
    }))

    expect(entries).toEqual([])
  })

  it('falls back to structural PRD coverage diffs when saved coverage diff metadata is empty', () => {
    const beforePrd = [
      'schema_version: 1',
      `ticket_id: ${TEST.externalId}`,
      'artifact: prd',
      'status: draft',
      'source_interview:',
      '  content_sha256: approved-hash',
      'product:',
      '  problem_statement: Keep PRD coverage diffs visible.',
      '  target_users:',
      '    - LoopTroop maintainers',
      'scope:',
      '  in_scope:',
      '    - Coverage diff fallback',
      '  out_of_scope:',
      '    - Execution changes',
      'technical_requirements:',
      '  architecture_constraints:',
      '    - Prefer validated metadata when it exists.',
      '  data_model: []',
      '  api_contracts: []',
      '  security_constraints: []',
      '  performance_constraints: []',
      '  reliability_constraints:',
      '    - Coverage revisions must remain reviewable.',
      '  error_handling_rules:',
      '    - Fall back to structural before/after diffs when saved change metadata is unusable.',
      '  tooling_assumptions:',
      '    - Use vitest.',
      'epics:',
      `  - id: ${TEST.epicId}`,
      '    title: Review PRD coverage revisions',
      '    objective: Keep approval diffs visible.',
      '    implementation_steps:',
      '      - Preserve fallback diffs.',
      '    user_stories:',
      `      - id: ${TEST.storyId}`,
      '        title: Inspect the saved coverage diff',
      '        acceptance_criteria:',
      '          - Approval shows a meaningful coverage diff.',
      '        implementation_steps:',
      '          - Show a structural diff when saved metadata is empty.',
      '        verification:',
      '          required_commands:',
      '            - npm run test',
      'risks: []',
      'approval:',
      '  approved_by: ""',
      '  approved_at: ""',
    ].join('\n')
    const afterPrd = beforePrd.replace(
      '    - Use vitest.',
      [
        '    - Use vitest.',
        '    - Build a structural fallback diff when saved coverage diff metadata is empty.',
      ].join('\n'),
    )

    const entries = buildRefinementDiffEntries(JSON.stringify({
      winnerId: 'openai/gpt-5.4',
      coverageBaselineContent: beforePrd,
      coverageBaselineVersion: 2,
      refinedContent: afterPrd,
      coverageUiRefinementDiff: {
        domain: 'prd',
        winnerId: 'openai/gpt-5.4',
        generatedAt: '2026-04-10T09:35:04.430Z',
        entries: [],
      },
    }), 'prd')

    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        changeType: 'modified',
        itemKind: 'technical_requirements.tooling_assumptions',
        label: 'Tooling Assumptions',
      }),
    ]))
  })
})
