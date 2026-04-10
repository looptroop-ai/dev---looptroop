import jsYaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import {
  buildPrdCoverageRevisionArtifact,
  buildPrdCoverageRevisionUiDiff,
} from '../coverageRevision'

function buildPrdContent(toolingAssumptions: string[]): string {
  return jsYaml.dump({
    schema_version: 1,
    ticket_id: 'POBA-3',
    artifact: 'prd',
    status: 'draft',
    source_interview: {
      content_sha256: 'approved-hash',
    },
    product: {
      problem_statement: 'Keep PRD coverage diffs inspectable.',
      target_users: ['LoopTroop maintainers'],
    },
    scope: {
      in_scope: ['Coverage diff fallback'],
      out_of_scope: ['Execution changes'],
    },
    technical_requirements: {
      architecture_constraints: ['Prefer validated metadata when it exists.'],
      data_model: [],
      api_contracts: [],
      security_constraints: [],
      performance_constraints: [],
      reliability_constraints: ['Coverage revisions must remain reviewable.'],
      error_handling_rules: ['Fall back to structural before/after diffs when saved change metadata is unusable.'],
      tooling_assumptions: toolingAssumptions,
    },
    epics: [{
      id: 'EPIC-1',
      title: 'Inspect PRD coverage revisions',
      objective: 'Keep coverage revisions reviewable even when saved semantic changes are missing.',
      implementation_steps: ['Compare the prior candidate against the revised candidate.'],
      user_stories: [{
        id: 'US-1',
        title: 'Review the saved coverage diff',
        acceptance_criteria: ['Approval shows a meaningful diff for coverage revisions.'],
        implementation_steps: ['Build a structural fallback diff when semantic metadata is empty.'],
        verification: {
          required_commands: ['npm run test'],
        },
      }],
    }],
    risks: ['Empty saved diff metadata can hide real PRD changes.'],
    approval: {
      approved_by: '',
      approved_at: '',
    },
  }, { lineWidth: 120, noRefs: true }) as string
}

describe.concurrent('PRD coverage revision diffs', () => {
  it('falls back to a structural PRD diff when validated coverage changes are empty', () => {
    const beforeContent = buildPrdContent([
      'Use vitest for coverage diff regression checks.',
    ])
    const afterContent = buildPrdContent([
      'Use vitest for coverage diff regression checks.',
      'Build a structural fallback diff when saved coverage change metadata is empty.',
    ])

    const revisionArtifact = buildPrdCoverageRevisionArtifact('openai/gpt-5.4', 2, {
      refinedContent: afterContent,
      priorCandidateContent: beforeContent,
      changes: [],
      gapResolutions: [],
      metrics: { epicCount: 1, userStoryCount: 1 },
      repairApplied: true,
      repairWarnings: ['Skipped refinement change at index 0 with invalid type.'],
    })

    const uiDiffArtifact = buildPrdCoverageRevisionUiDiff(revisionArtifact)

    expect(uiDiffArtifact).toMatchObject({
      domain: 'prd',
      winnerId: 'openai/gpt-5.4',
      entries: expect.arrayContaining([
        expect.objectContaining({
          changeType: 'modified',
          itemKind: 'technical_requirements.tooling_assumptions',
          label: 'Tooling Assumptions',
        }),
      ]),
    })
  })
})
