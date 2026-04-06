import { describe, expect, it } from 'vitest'
import type { RefinementChange } from '../refinementChanges'
import {
  buildBeadsUiRefinementDiffArtifact,
  buildBeadsUiRefinementDiffArtifactFromChanges,
  buildInterviewUiRefinementDiffArtifactFromChanges,
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

function buildExpectedPrdEpicSourceText(title = 'Preserve refinement attribution'): string {
  return [
    `Title: ${title}`,
    '',
    'Objective: Keep source lineage visible in spec diffs.',
  ].join('\n')
}

function buildExpectedBeadSourceText(
  title: string,
  description = `Deliver ${title.toLowerCase()}.`,
  prdRefs: string[] = ['EPIC-1 / US-1'],
): string {
  return [
    `Title: ${title}`,
    '',
    'PRD References:',
    ...prdRefs.map((ref) => `- ${ref}`),
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

function expectBlocks(
  blocks: Array<{ kind: string; id?: string; label: string; text: string }> | undefined,
  expected: Array<{ kind: string; id?: string; label: string; text: string }>,
) {
  expect(blocks).toEqual(expected)
}

describe.concurrent('refinement diff artifacts', () => {
  it('uses explicit PRD inspiration metadata when changes provide it', () => {
    const sourceTitle = 'Expose retry telemetry'
    const epicText = buildExpectedPrdEpicSourceText()
    const storyText = buildExpectedPrdStorySourceText(sourceTitle)
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
          sourceText: storyText,
        }),
        attributionStatus: 'inspired',
      }),
    ])
    expectBlocks(artifact.entries[0]?.inspiration?.blocks, [
      { kind: 'epic', id: 'EPIC-1', label: 'Preserve refinement attribution', text: epicText },
      { kind: 'user_story', id: 'US-8', label: sourceTitle, text: storyText },
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
    expectBlocks(artifact.entries[0]?.inspiration?.blocks, [
      {
        kind: 'user_story',
        id: 'US-8',
        label: sourceTitle,
        text: `Title: ${sourceTitle}\n\nDetail: ${sourceDetail}`,
      },
    ])
  })

  it('uses only the epic block when PRD inspiration points to an epic', () => {
    const epicTitle = 'Expose retry telemetry platform-wide'
    const epicText = buildExpectedPrdEpicSourceText(epicTitle)
    const artifact = buildPrdUiRefinementDiffArtifactFromChanges({
      winnerId: 'openai/gpt-5.2',
      winnerDraftContent: buildPrdDocument({
        stories: [{ id: 'US-1', title: 'Validate PRD refinement' }],
      }),
      refinedContent: buildPrdDocument({
        epicTitle,
        stories: [{ id: 'US-1', title: 'Validate PRD refinement' }],
      }),
      losingDrafts: [{
        memberId: 'openai/gpt-5-mini',
        content: buildPrdDocument({
          epicTitle,
          stories: [{ id: 'US-8', title: 'Expose retry telemetry' }],
        }),
      }],
      changes: [{
        type: 'modified',
        itemType: 'epic',
        before: { id: 'EPIC-1', label: 'Preserve refinement attribution' },
        after: { id: 'EPIC-1', label: epicTitle },
        inspiration: {
          draftIndex: 0,
          memberId: 'openai/gpt-5-mini',
          item: {
            id: 'EPIC-1',
            label: epicTitle,
          },
        },
        attributionStatus: 'inspired',
      }],
    })

    expectBlocks(artifact.entries[0]?.inspiration?.blocks, [
      { kind: 'epic', id: 'EPIC-1', label: epicTitle, text: epicText },
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

  it('drops explicit no-op PRD modified entries when before and after render identically', () => {
    const content = buildPrdDocument({
      stories: [{ id: 'US-1', title: 'Validate PRD refinement' }],
    })
    const artifact = buildPrdUiRefinementDiffArtifactFromChanges({
      winnerId: 'openai/gpt-5.2',
      winnerDraftContent: content,
      refinedContent: content,
      changes: [{
        type: 'modified',
        itemType: 'user_story',
        before: { id: 'US-1', label: 'Validate PRD refinement' },
        after: { id: 'US-1', label: 'Validate PRD refinement' },
        inspiration: null,
        attributionStatus: 'model_unattributed',
      }],
    })

    expect(artifact.entries).toEqual([])
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
    const epicText = buildExpectedPrdEpicSourceText()
    const storyText = buildExpectedPrdStorySourceText(refinedStory.title, refinedStory.acceptanceCriterion)
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
          sourceText: storyText,
        }),
        attributionStatus: 'inspired',
      }),
    ])
    expectBlocks(artifact.entries[0]?.inspiration?.blocks, [
      { kind: 'epic', id: 'EPIC-1', label: 'Preserve refinement attribution', text: epicText },
      { kind: 'user_story', id: 'US-8', label: refinedStory.title, text: storyText },
    ])
  })

  it('uses explicit Beads inspiration metadata when changes provide it', () => {
    const sourceTitle = 'Adopt losing-draft telemetry'
    const beadText = buildExpectedBeadSourceText(sourceTitle)
    const epicText = buildExpectedPrdEpicSourceText()
    const storyText = buildExpectedPrdStorySourceText('Review PRD drafts')
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
      prdContent: buildPrdDocument({
        stories: [{ id: 'US-1', title: 'Review PRD drafts' }],
      }),
    })

    expect(artifact.entries).toEqual([
      expect.objectContaining({
        changeType: 'added',
        itemKind: 'bead',
        inspiration: expect.objectContaining({
          memberId: 'openai/gpt-5-mini',
          sourceId: 'bead-9',
          sourceLabel: sourceTitle,
          sourceText: beadText,
        }),
        attributionStatus: 'inspired',
      }),
    ])
    expectBlocks(artifact.entries[0]?.inspiration?.blocks, [
      { kind: 'bead', id: 'bead-9', label: sourceTitle, text: beadText },
      { kind: 'epic', id: 'EPIC-1', label: 'Preserve refinement attribution', text: epicText },
      { kind: 'user_story', id: 'US-1', label: 'Review PRD drafts', text: storyText },
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
    expectBlocks(artifact.entries[0]?.inspiration?.blocks, [
      {
        kind: 'bead',
        id: 'bead-9',
        label: sourceTitle,
        text: `Title: ${sourceTitle}\n\nDescription: ${sourceDetail}`,
      },
    ])
  })

  it('drops explicit no-op beads modified entries when before and after render identically', () => {
    const content = buildBeadsDocument([{ id: 'bead-1', title: 'Validate refinement attribution' }])
    const artifact = buildBeadsUiRefinementDiffArtifactFromChanges({
      winnerId: 'openai/gpt-5.2',
      winnerDraftContent: content,
      refinedContent: content,
      changes: [{
        type: 'modified',
        itemType: 'bead',
        before: { id: 'bead-1', label: 'Validate refinement attribution' },
        after: { id: 'bead-1', label: 'Validate refinement attribution' },
        inspiration: null,
        attributionStatus: 'model_unattributed',
      }],
    })

    expect(artifact.entries).toEqual([])
  })

  it('drops explicit no-op interview modified and replaced entries when before and after text match', () => {
    const artifact = buildInterviewUiRefinementDiffArtifactFromChanges({
      winnerId: 'openai/gpt-5.2',
      changes: [
        {
          type: 'modified',
          before: { id: 'Q01', phase: 'Foundation', question: 'Keep the existing menu layout?' },
          after: { id: 'Q01', phase: 'Foundation', question: 'Keep the existing menu layout?' },
          inspiration: null,
          attributionStatus: 'model_unattributed',
        },
        {
          type: 'replaced',
          before: { id: 'Q02', phase: 'Structure', question: 'Verify the active state?' },
          after: { id: 'Q03', phase: 'Structure', question: 'Verify the active state?' },
          inspiration: null,
          attributionStatus: 'model_unattributed',
        },
      ],
    })

    expect(artifact.entries).toEqual([])
  })

  it('keeps exact-match PRD fallback attribution when no explicit changes metadata exists', () => {
    const refinedStory = {
      id: 'US-3',
      title: 'Surface retry metadata',
      acceptanceCriterion: 'Show structured retry metadata.',
    }
    const epicText = buildExpectedPrdEpicSourceText()
    const storyText = buildExpectedPrdStorySourceText(refinedStory.title, refinedStory.acceptanceCriterion)
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
          sourceText: storyText,
        }),
        attributionStatus: 'inspired',
      }),
    ])
    expectBlocks(artifact.entries[0]?.inspiration?.blocks, [
      { kind: 'epic', id: 'EPIC-1', label: 'Preserve refinement attribution', text: epicText },
      { kind: 'user_story', id: 'US-8', label: refinedStory.title, text: storyText },
    ])
  })

  it('keeps exact-match Beads fallback attribution when no explicit changes metadata exists', () => {
    const beadText = buildExpectedBeadSourceText('Surface retry metadata', 'Deliver surface retry metadata.', ['EPIC-1 / US-1'])
    const epicText = buildExpectedPrdEpicSourceText()
    const storyText = buildExpectedPrdStorySourceText('Review PRD drafts')
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
      prdContent: buildPrdDocument({
        stories: [{ id: 'US-1', title: 'Review PRD drafts' }],
      }),
    })

    expect(artifact.entries).toEqual([
      expect.objectContaining({
        changeType: 'added',
        inspiration: expect.objectContaining({
          memberId: 'openai/gpt-5-mini',
          sourceId: 'bead-9',
          sourceLabel: 'Surface retry metadata',
          sourceText: beadText,
        }),
        attributionStatus: 'inspired',
      }),
    ])
    expectBlocks(artifact.entries[0]?.inspiration?.blocks, [
      { kind: 'bead', id: 'bead-9', label: 'Surface retry metadata', text: beadText },
      { kind: 'epic', id: 'EPIC-1', label: 'Preserve refinement attribution', text: epicText },
      { kind: 'user_story', id: 'US-1', label: 'Review PRD drafts', text: storyText },
    ])
  })
})
