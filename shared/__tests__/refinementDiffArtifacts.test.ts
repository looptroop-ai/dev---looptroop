import { describe, expect, it } from 'vitest'
import type { RefinementChange } from '../refinementChanges'
import {
  buildBeadsUiRefinementDiffArtifact,
  buildBeadsUiRefinementDiffArtifactFromChanges,
  buildPrdUiRefinementDiffArtifact,
  buildPrdUiRefinementDiffArtifactFromChanges,
} from '../refinementDiffArtifacts'

const TICKET_ID = 'TEST-1'

function buildPrdDocument(options: {
  epicTitle?: string
  stories: Array<{ id: string; title: string; acceptanceCriterion?: string }>
}): string {
  const storyLines = options.stories.flatMap((story) => [
    `      - id: "${story.id}"`,
    `        title: "${story.title}"`,
    '        acceptance_criteria:',
    `          - "${story.acceptanceCriterion ?? `Review ${story.title.toLowerCase()}.`}"`,
    '        implementation_steps:',
    `          - "Implement ${story.title.toLowerCase()}."`,
    '        verification:',
    '          required_commands:',
    '            - "npm run test"',
  ])

  return [
    'schema_version: 1',
    `ticket_id: ${TICKET_ID}`,
    'artifact: prd',
    'status: draft',
    'source_interview:',
    '  content_sha256: mock-sha',
    'product:',
    '  problem_statement: "Restore refinement attribution."',
    '  target_users:',
    '    - "LoopTroop maintainers"',
    'scope:',
    '  in_scope:',
    '    - "Refinement diff attribution"',
    '  out_of_scope:',
    '    - "Workflow changes outside refinement"',
    'technical_requirements:',
    '  architecture_constraints:',
    '    - "Keep attribution deterministic"',
    '  data_model: []',
    '  api_contracts: []',
    '  security_constraints: []',
    '  performance_constraints: []',
    '  reliability_constraints: []',
    '  error_handling_rules: []',
    '  tooling_assumptions: []',
    'epics:',
    '  - id: "EPIC-1"',
    `    title: "${options.epicTitle ?? 'Preserve refinement attribution'}"`,
    '    objective: "Keep source lineage visible in spec diffs."',
    '    user_stories:',
    ...storyLines,
    'approval:',
    '  approved_by: ""',
    '  approved_at: ""',
  ].join('\n')
}

function buildBeadsDocument(beads: Array<{ id: string; title: string; description?: string }>): string {
  return [
    'beads:',
    ...beads.flatMap((bead) => [
      `  - id: "${bead.id}"`,
      `    title: "${bead.title}"`,
      '    prdRefs: ["EPIC-1 / US-1"]',
      `    description: "${bead.description ?? `Deliver ${bead.title.toLowerCase()}.`}"`,
      '    contextGuidance: "Keep repairs deterministic."',
      '    acceptanceCriteria:',
      `      - "Validate ${bead.title.toLowerCase()}"`,
      '    tests:',
      `      - "Test ${bead.title.toLowerCase()}"`,
      '    testCommands:',
      '      - "npm run test:server"',
    ]),
  ].join('\n')
}

function buildExpectedPrdStorySourceText(title: string, acceptanceCriterion = `Review ${title.toLowerCase()}.`): string {
  return [
    `Title: ${title}`,
    '',
    'Acceptance Criteria:',
    `- ${acceptanceCriterion}`,
    '',
    'Implementation Steps:',
    `- Implement ${title.toLowerCase()}.`,
    '',
    'Verification Commands:',
    '- npm run test',
  ].join('\n')
}

function buildExpectedBeadSourceText(title: string, description = `Deliver ${title.toLowerCase()}.`): string {
  return [
    `Title: ${title}`,
    '',
    'PRD References:',
    '- EPIC-1 / US-1',
    '',
    `Description: ${description}`,
    '',
    'Context Guidance: Keep repairs deterministic.',
    '',
    'Acceptance Criteria:',
    `- Validate ${title.toLowerCase()}`,
    '',
    'Tests:',
    `- Test ${title.toLowerCase()}`,
    '',
    'Test Commands:',
    '- npm run test:server',
  ].join('\n')
}

describe.concurrent('refinement diff artifacts', () => {
  it('uses explicit PRD inspiration metadata when changes provide it', () => {
    const sourceTitle = 'Expose retry telemetry'
    const artifact = buildPrdUiRefinementDiffArtifactFromChanges({
      winnerId: 'openai/gpt-5.2',
      winnerDraftContent: buildPrdDocument({
        stories: [{ id: 'US-1', title: 'Validate PRD refinement' }],
      }),
      refinedContent: buildPrdDocument({
        stories: [
          { id: 'US-1', title: 'Validate PRD refinement' },
          { id: 'US-3', title: 'Surface retry metadata' },
        ],
      }),
      losingDrafts: [{
        memberId: 'openai/gpt-5-mini',
        content: buildPrdDocument({
          stories: [
            { id: 'US-1', title: 'Validate PRD refinement' },
            { id: 'US-8', title: sourceTitle },
          ],
        }),
      }],
      changes: [{
        type: 'added',
        itemType: 'user_story',
        before: null,
        after: { id: 'US-3', label: 'Surface retry metadata' },
        inspiration: {
          draftIndex: 0,
          memberId: 'openai/gpt-5-mini',
          item: {
            id: 'US-8',
            label: 'Expose retry telemetry',
          },
        },
        attributionStatus: 'inspired',
      }],
    })

    expect(artifact.entries).toEqual([
      expect.objectContaining({
        changeType: 'added',
        itemKind: 'user_story',
        afterId: 'US-3',
        inspiration: expect.objectContaining({
          memberId: 'openai/gpt-5-mini',
          sourceId: 'US-8',
          sourceLabel: sourceTitle,
          sourceText: buildExpectedPrdStorySourceText(sourceTitle),
        }),
        attributionStatus: 'inspired',
      }),
    ])
  })

  it('falls back to label and detail for explicit PRD inspiration when the source draft item cannot be recovered', () => {
    const sourceTitle = 'Expose retry telemetry'
    const sourceDetail = 'Show retry telemetry in the approval diff.'
    const artifact = buildPrdUiRefinementDiffArtifactFromChanges({
      winnerId: 'openai/gpt-5.2',
      winnerDraftContent: buildPrdDocument({
        stories: [{ id: 'US-1', title: 'Validate PRD refinement' }],
      }),
      refinedContent: buildPrdDocument({
        stories: [
          { id: 'US-1', title: 'Validate PRD refinement' },
          { id: 'US-3', title: 'Surface retry metadata' },
        ],
      }),
      changes: [{
        type: 'added',
        itemType: 'user_story',
        before: null,
        after: { id: 'US-3', label: 'Surface retry metadata' },
        inspiration: {
          draftIndex: 0,
          memberId: 'openai/gpt-5-mini',
          item: {
            id: 'US-8',
            label: sourceTitle,
            detail: sourceDetail,
          },
        },
        attributionStatus: 'inspired',
      }],
    })

    expect(artifact.entries).toEqual([
      expect.objectContaining({
        inspiration: expect.objectContaining({
          memberId: 'openai/gpt-5-mini',
          sourceId: 'US-8',
          sourceLabel: sourceTitle,
          sourceText: `Title: ${sourceTitle}\n\nDetail: ${sourceDetail}`,
        }),
        attributionStatus: 'inspired',
      }),
    ])
  })

  it('keeps PRD changes model-unattributed when no explicit or deterministic source exists', () => {
    const artifact = buildPrdUiRefinementDiffArtifactFromChanges({
      winnerId: 'openai/gpt-5.2',
      winnerDraftContent: buildPrdDocument({
        stories: [{ id: 'US-1', title: 'Validate PRD refinement' }],
      }),
      refinedContent: buildPrdDocument({
        stories: [{ id: 'US-1', title: 'Validate PRD refinement exactly' }],
      }),
      changes: [{
        type: 'modified',
        itemType: 'user_story',
        before: { id: 'US-1', label: 'Validate PRD refinement' },
        after: { id: 'US-1', label: 'Validate PRD refinement exactly' },
        inspiration: null,
        attributionStatus: 'model_unattributed',
      }],
    })

    expect(artifact.entries).toEqual([
      expect.objectContaining({
        changeType: 'modified',
        itemKind: 'user_story',
        inspiration: null,
        attributionStatus: 'model_unattributed',
      }),
    ])
  })

  it('keeps invalid PRD attribution cleared instead of backfilling a deterministic source', () => {
    const changes: RefinementChange[] = [{
      type: 'added',
      itemType: 'user_story',
      before: null,
      after: { id: 'US-3', label: 'Surface retry metadata' },
      inspiration: null,
      attributionStatus: 'invalid_unattributed',
    }]

    const sharedStory = {
      id: 'US-3',
      title: 'Surface retry metadata',
      acceptanceCriterion: 'Show structured retry metadata.',
    }
    const artifact = buildPrdUiRefinementDiffArtifactFromChanges({
      winnerId: 'openai/gpt-5.2',
      winnerDraftContent: buildPrdDocument({
        stories: [{ id: 'US-1', title: 'Validate PRD refinement' }],
      }),
      refinedContent: buildPrdDocument({
        stories: [{ id: 'US-1', title: 'Validate PRD refinement' }, sharedStory],
      }),
      losingDrafts: [{
        memberId: 'openai/gpt-5-mini',
        content: buildPrdDocument({
          stories: [
            { id: 'US-1', title: 'Validate PRD refinement' },
            { id: 'US-8', title: sharedStory.title, acceptanceCriterion: sharedStory.acceptanceCriterion },
          ],
        }),
      }],
      changes,
    })

    expect(artifact.entries).toEqual([
      expect.objectContaining({
        inspiration: null,
        attributionStatus: 'invalid_unattributed',
      }),
    ])
  })

  it('falls back to deterministic PRD inspiration when the model omits source metadata', () => {
    const refinedStory = {
      id: 'US-3',
      title: 'Surface retry metadata',
      acceptanceCriterion: 'Show structured retry metadata.',
    }
    const artifact = buildPrdUiRefinementDiffArtifactFromChanges({
      winnerId: 'openai/gpt-5.2',
      winnerDraftContent: buildPrdDocument({
        stories: [{ id: 'US-1', title: 'Validate PRD refinement' }],
      }),
      refinedContent: buildPrdDocument({
        stories: [{ id: 'US-1', title: 'Validate PRD refinement' }, refinedStory],
      }),
      losingDrafts: [{
        memberId: 'openai/gpt-5-mini',
        content: buildPrdDocument({
          stories: [
            { id: 'US-1', title: 'Validate PRD refinement' },
            { id: 'US-8', title: refinedStory.title, acceptanceCriterion: refinedStory.acceptanceCriterion },
          ],
        }),
      }],
      changes: [{
        type: 'added',
        itemType: 'user_story',
        before: null,
        after: { id: refinedStory.id, label: refinedStory.title },
        inspiration: null,
        attributionStatus: 'model_unattributed',
      }],
    })

    expect(artifact.entries).toEqual([
      expect.objectContaining({
        inspiration: expect.objectContaining({
          memberId: 'openai/gpt-5-mini',
          sourceId: 'US-8',
          sourceLabel: refinedStory.title,
        }),
        attributionStatus: 'inspired',
      }),
    ])
  })

  it('uses explicit Beads inspiration metadata when changes provide it', () => {
    const sourceTitle = 'Adopt losing-draft telemetry'
    const artifact = buildBeadsUiRefinementDiffArtifactFromChanges({
      winnerId: 'openai/gpt-5.2',
      winnerDraftContent: buildBeadsDocument([{ id: 'bead-1', title: 'Validate refinement attribution' }]),
      refinedContent: buildBeadsDocument([
        { id: 'bead-1', title: 'Validate refinement attribution' },
        { id: 'bead-2', title: 'Surface retry metadata' },
      ]),
      losingDrafts: [{
        memberId: 'openai/gpt-5-mini',
        content: buildBeadsDocument([
          { id: 'bead-1', title: 'Validate refinement attribution' },
          { id: 'bead-9', title: sourceTitle },
        ]),
      }],
      changes: [{
        type: 'added',
        itemType: 'bead',
        before: null,
        after: { id: 'bead-2', label: 'Surface retry metadata' },
        inspiration: {
          draftIndex: 0,
          memberId: 'openai/gpt-5-mini',
          item: {
            id: 'bead-9',
            label: sourceTitle,
          },
        },
        attributionStatus: 'inspired',
      }],
    })

    expect(artifact.entries).toEqual([
      expect.objectContaining({
        changeType: 'added',
        itemKind: 'bead',
        inspiration: expect.objectContaining({
          memberId: 'openai/gpt-5-mini',
          sourceId: 'bead-9',
          sourceLabel: sourceTitle,
          sourceText: buildExpectedBeadSourceText(sourceTitle),
        }),
        attributionStatus: 'inspired',
      }),
    ])
  })

  it('falls back to label and detail for explicit Beads inspiration when the source draft item cannot be recovered', () => {
    const sourceTitle = 'Adopt losing-draft telemetry'
    const sourceDetail = 'Surface refinement retry metadata in the diff viewer.'
    const artifact = buildBeadsUiRefinementDiffArtifactFromChanges({
      winnerId: 'openai/gpt-5.2',
      winnerDraftContent: buildBeadsDocument([{ id: 'bead-1', title: 'Validate refinement attribution' }]),
      refinedContent: buildBeadsDocument([
        { id: 'bead-1', title: 'Validate refinement attribution' },
        { id: 'bead-2', title: 'Surface retry metadata' },
      ]),
      changes: [{
        type: 'added',
        itemType: 'bead',
        before: null,
        after: { id: 'bead-2', label: 'Surface retry metadata' },
        inspiration: {
          draftIndex: 0,
          memberId: 'openai/gpt-5-mini',
          item: {
            id: 'bead-9',
            label: sourceTitle,
            detail: sourceDetail,
          },
        },
        attributionStatus: 'inspired',
      }],
    })

    expect(artifact.entries).toEqual([
      expect.objectContaining({
        inspiration: expect.objectContaining({
          memberId: 'openai/gpt-5-mini',
          sourceId: 'bead-9',
          sourceLabel: sourceTitle,
          sourceText: `Title: ${sourceTitle}\n\nDescription: ${sourceDetail}`,
        }),
        attributionStatus: 'inspired',
      }),
    ])
  })

  it('keeps exact-match PRD fallback attribution when no explicit changes metadata exists', () => {
    const refinedStory = {
      id: 'US-3',
      title: 'Surface retry metadata',
      acceptanceCriterion: 'Show structured retry metadata.',
    }
    const artifact = buildPrdUiRefinementDiffArtifact({
      winnerId: 'openai/gpt-5.2',
      winnerDraftContent: buildPrdDocument({
        stories: [{ id: 'US-1', title: 'Validate PRD refinement' }],
      }),
      refinedContent: buildPrdDocument({
        stories: [{ id: 'US-1', title: 'Validate PRD refinement' }, refinedStory],
      }),
      losingDrafts: [{
        memberId: 'openai/gpt-5-mini',
        content: buildPrdDocument({
          stories: [
            { id: 'US-1', title: 'Validate PRD refinement' },
            { id: 'US-8', title: refinedStory.title, acceptanceCriterion: refinedStory.acceptanceCriterion },
          ],
        }),
      }],
    })

    expect(artifact.entries).toEqual([
      expect.objectContaining({
        changeType: 'added',
        inspiration: expect.objectContaining({
          memberId: 'openai/gpt-5-mini',
          sourceId: 'US-8',
          sourceLabel: refinedStory.title,
        }),
        attributionStatus: 'inspired',
      }),
    ])
  })

  it('keeps exact-match Beads fallback attribution when no explicit changes metadata exists', () => {
    const artifact = buildBeadsUiRefinementDiffArtifact({
      winnerId: 'openai/gpt-5.2',
      winnerDraftContent: buildBeadsDocument([{ id: 'bead-1', title: 'Validate refinement attribution' }]),
      refinedContent: buildBeadsDocument([
        { id: 'bead-1', title: 'Validate refinement attribution' },
        { id: 'bead-2', title: 'Surface retry metadata' },
      ]),
      losingDrafts: [{
        memberId: 'openai/gpt-5-mini',
        content: buildBeadsDocument([
          { id: 'bead-1', title: 'Validate refinement attribution' },
          { id: 'bead-9', title: 'Surface retry metadata' },
        ]),
      }],
    })

    expect(artifact.entries).toEqual([
      expect.objectContaining({
        changeType: 'added',
        inspiration: expect.objectContaining({
          memberId: 'openai/gpt-5-mini',
          sourceId: 'bead-9',
          sourceLabel: 'Surface retry metadata',
        }),
        attributionStatus: 'inspired',
      }),
    ])
  })
})
