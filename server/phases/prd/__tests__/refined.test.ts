import jsYaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import type { InterviewDocument } from '@shared/interviewArtifact'
import { buildInterviewDocumentYaml } from '../../../structuredOutput'
import {
  buildPrdRefinedArtifact,
  parsePrdRefinedArtifact,
  requirePrdRefinedArtifact,
  validatePrdRefinementOutput,
} from '../refined'

function buildInterviewYaml(ticketId: string): string {
  const document: InterviewDocument = {
    schema_version: 1,
    ticket_id: ticketId,
    artifact: 'interview',
    status: 'approved',
    generated_by: {
      winner_model: 'openai/gpt-5',
      generated_at: '2026-03-26T10:00:00.000Z',
    },
    questions: [
      {
        id: 'Q01',
        phase: 'Foundation',
        prompt: 'Which prompt hardening rules are required?',
        source: 'compiled',
        follow_up_round: null,
        answer_type: 'free_text',
        options: [],
        answer: {
          skipped: false,
          selected_option_ids: [],
          free_text: 'Require strict output validation and exact retry handling.',
          answered_by: 'user',
          answered_at: '2026-03-26T10:01:00.000Z',
        },
      },
    ],
    follow_up_rounds: [],
    summary: {
      goals: ['Harden REFINING_PRD'],
      constraints: ['Preserve winner-only refinement'],
      non_goals: ['Change execution'],
      final_free_form_answer: '',
    },
    approval: {
      approved_by: 'user',
      approved_at: '2026-03-26T10:02:00.000Z',
    },
  }

  return buildInterviewDocumentYaml(document)
}

function buildPrdContent(
  ticketId: string,
  options: {
    epicTitle?: string
    storyOneTitle?: string
    includeStoryTwo?: boolean
    includeStoryThree?: boolean
    changes?: unknown[]
  } = {},
): string {
  const document: Record<string, unknown> = {
    schema_version: 1,
    ticket_id: ticketId,
    artifact: 'prd',
    status: 'draft',
    source_interview: {
      content_sha256: 'stale-hash',
    },
    product: {
      problem_statement: 'Keep PRD refinement strict and restart-safe.',
      target_users: ['LoopTroop maintainers'],
    },
    scope: {
      in_scope: ['PRD refinement validation', 'artifact parsing'],
      out_of_scope: ['Execution pipeline changes'],
    },
    technical_requirements: {
      architecture_constraints: ['Preserve the winner-only refinement flow.'],
      data_model: [],
      api_contracts: [],
      security_constraints: [],
      performance_constraints: [],
      reliability_constraints: ['Validated artifacts must survive restarts.'],
      error_handling_rules: ['Retry once on structured-output failures.'],
      tooling_assumptions: [],
    },
    epics: [
      {
        id: 'EPIC-1',
        title: options.epicTitle ?? 'Prompt hardening',
        objective: 'Make PRD refinement exact and auditable.',
        implementation_steps: ['Compare the winner draft against the final refined PRD.'],
        user_stories: [
          {
            id: 'US-1',
            title: options.storyOneTitle ?? 'Validate PRD refinement',
            acceptance_criteria: ['Every winner-to-final diff is represented exactly once.'],
            implementation_steps: ['Validate change coverage before persisting the artifact.'],
            verification: {
              required_commands: ['npm run test'],
            },
          },
          ...(options.includeStoryTwo === false
            ? []
            : [{
                id: 'US-2',
                title: 'Record change attribution',
                acceptance_criteria: ['Every adopted improvement records its source.'],
                implementation_steps: ['Persist attribution status alongside each change.'],
                verification: {
                  required_commands: ['npm run test'],
                },
              }]),
          ...(options.includeStoryThree
            ? [{
                id: 'US-3',
                title: 'Surface retry metadata',
                acceptance_criteria: ['Structured retry metadata is preserved for review.'],
                implementation_steps: ['Expose retry metadata in the final artifact.'],
                verification: {
                  required_commands: ['npm run test'],
                },
              }]
            : []),
        ],
      },
    ],
    risks: ['Loose parsing could hide real refinement mistakes.'],
    approval: {
      approved_by: '',
      approved_at: '',
    },
  }

  if (options.changes !== undefined) {
    document.changes = options.changes
  }

  return jsYaml.dump(document, { lineWidth: 120, noRefs: true }) as string
}

function buildValidRefinementOutput(ticketId: string, options: { omitStoryItemType?: boolean } = {}): string {
  return buildPrdContent(ticketId, {
    epicTitle: 'Prompt hardening and refinement safety',
    storyOneTitle: 'Validate PRD refinement exactly',
    includeStoryTwo: false,
    includeStoryThree: true,
    changes: [
      {
        type: 'modified',
        item_type: 'epic',
        before: { id: 'EPIC-1', title: 'Prompt hardening' },
        after: { id: 'EPIC-1', title: 'Prompt hardening and refinement safety' },
        inspiration: null,
      },
      {
        type: 'modified',
        ...(options.omitStoryItemType ? {} : { item_type: 'user_story' }),
        before: { id: 'US-1', title: 'Validate PRD refinement' },
        after: { id: 'US-1', title: 'Validate PRD refinement exactly' },
        inspiration: null,
      },
      {
        type: 'removed',
        item_type: 'user_story',
        before: { id: 'US-2', title: 'Record change attribution' },
        after: null,
        inspiration: null,
      },
      {
        type: 'added',
        item_type: 'user_story',
        before: null,
        after: { id: 'US-3', title: 'Surface retry metadata' },
        inspiration: {
          alternative_draft: 1,
          item: { id: 'US-8', title: 'Expose retry telemetry' },
        },
      },
    ],
  })
}

describe('PRD refined artifacts', () => {
  it('validates a refined PRD only when changes fully and exactly cover the winner-to-final diff', () => {
    const ticketId = 'PROJ-7'
    const interviewContent = buildInterviewYaml(ticketId)
    const result = validatePrdRefinementOutput(buildValidRefinementOutput(ticketId), {
      ticketId,
      interviewContent,
      winnerDraftContent: buildPrdContent(ticketId),
      losingDraftMeta: [{ memberId: 'openai/gpt-5-mini' }],
    })

    expect(result.metrics).toEqual({ epicCount: 1, userStoryCount: 2 })
    expect(result.changes).toHaveLength(4)
    expect(result.changes.map((change) => change.type)).toEqual(['modified', 'modified', 'removed', 'added'])
    expect(result.repairApplied).toBe(true)
    expect(result.repairWarnings).toContain('Canonicalized source_interview.content_sha256 from the approved Interview Results artifact.')
    expect(result.refinedContent).not.toContain('changes:')
  })

  it('drops no-op modified changes before validating diff coverage', () => {
    const ticketId = 'PROJ-8'
    const interviewContent = buildInterviewYaml(ticketId)
    const unchangedContent = buildPrdContent(ticketId, {
      changes: [
        {
          type: 'modified',
          item_type: 'user_story',
          before: { id: 'US-1', title: 'Validate PRD refinement' },
          after: { id: 'US-1', title: 'Validate PRD refinement' },
          inspiration: null,
        },
      ],
    })

    const result = validatePrdRefinementOutput(unchangedContent, {
      ticketId,
      interviewContent,
      winnerDraftContent: buildPrdContent(ticketId),
    })

    expect(result.changes).toEqual([])
    expect(result.repairWarnings.join('\n')).toContain('Dropped no-op PRD refinement modified change')
  })

  it('rejects changes that reference items outside the winning draft', () => {
    const ticketId = 'PROJ-9'
    const interviewContent = buildInterviewYaml(ticketId)
    const invalidOutput = buildPrdContent(ticketId, {
      changes: [
        {
          type: 'removed',
          item_type: 'user_story',
          before: { id: 'US-99', title: 'Ghost story' },
          after: null,
          inspiration: null,
        },
      ],
    })

    expect(() => validatePrdRefinementOutput(invalidOutput, {
      ticketId,
      interviewContent,
      winnerDraftContent: buildPrdContent(ticketId),
    })).toThrow('does not match any item from the winning draft')
  })

  it('rejects duplicate before or after reuse across changes', () => {
    const ticketId = 'PROJ-10'
    const interviewContent = buildInterviewYaml(ticketId)
    const duplicateReuseOutput = buildPrdContent(ticketId, {
      storyOneTitle: 'Validate PRD refinement exactly',
      changes: [
        {
          type: 'modified',
          item_type: 'user_story',
          before: { id: 'US-1', title: 'Validate PRD refinement' },
          after: { id: 'US-1', title: 'Validate PRD refinement exactly' },
          inspiration: null,
        },
        {
          type: 'removed',
          item_type: 'user_story',
          before: { id: 'US-1', title: 'Validate PRD refinement' },
          after: null,
          inspiration: null,
        },
      ],
    })

    expect(() => validatePrdRefinementOutput(duplicateReuseOutput, {
      ticketId,
      interviewContent,
      winnerDraftContent: buildPrdContent(ticketId),
    })).toThrow('reuses a winning-draft item already referenced by another change')
  })

  it('downgrades malformed inspiration to invalid_unattributed', () => {
    const ticketId = 'PROJ-11'
    const interviewContent = buildInterviewYaml(ticketId)
    const result = validatePrdRefinementOutput(buildPrdContent(ticketId, {
      includeStoryThree: true,
      changes: [
        {
          type: 'added',
          item_type: 'user_story',
          before: null,
          after: { id: 'US-3', title: 'Surface retry metadata' },
          inspiration: {
            alternative_draft: 'oops',
            item: { id: 'US-8', title: 'Expose retry telemetry' },
          },
        },
      ],
    }), {
      ticketId,
      interviewContent,
      winnerDraftContent: buildPrdContent(ticketId),
      losingDraftMeta: [{ memberId: 'openai/gpt-5-mini' }],
    })

    expect(result.changes).toHaveLength(1)
    expect(result.changes[0]).toMatchObject({
      inspiration: null,
      attributionStatus: 'invalid_unattributed',
    })
  })

  it('defaults uninspired edits to model_unattributed', () => {
    const ticketId = 'PROJ-12'
    const interviewContent = buildInterviewYaml(ticketId)
    const result = validatePrdRefinementOutput(buildPrdContent(ticketId, {
      storyOneTitle: 'Validate PRD refinement exactly',
      includeStoryTwo: false,
      changes: [
        {
          type: 'modified',
          item_type: 'user_story',
          before: { id: 'US-1', title: 'Validate PRD refinement' },
          after: { id: 'US-1', title: 'Validate PRD refinement exactly' },
        },
      ],
    }), {
      ticketId,
      interviewContent,
      winnerDraftContent: buildPrdContent(ticketId, { includeStoryTwo: false }),
    })

    expect(result.changes).toHaveLength(1)
    expect(result.changes[0]).toMatchObject({
      inspiration: null,
      attributionStatus: 'model_unattributed',
    })
  })

  it('round-trips parsed refined PRD artifacts and rejects missing persisted artifacts', () => {
    const ticketId = 'PROJ-13'
    const interviewContent = buildInterviewYaml(ticketId)
    const refinement = validatePrdRefinementOutput(buildValidRefinementOutput(ticketId), {
      ticketId,
      interviewContent,
      winnerDraftContent: buildPrdContent(ticketId),
      losingDraftMeta: [{ memberId: 'openai/gpt-5-mini' }],
    })

    const artifact = buildPrdRefinedArtifact(
      'openai/gpt-5',
      refinement.winnerDraftContent,
      refinement,
      {
        repairApplied: refinement.repairApplied,
        repairWarnings: refinement.repairWarnings,
        autoRetryCount: 1,
        validationError: 'PRD refinement output is missing changes',
      },
    )
    const parsed = parsePrdRefinedArtifact(JSON.stringify(artifact))

    expect(parsed.winnerId).toBe('openai/gpt-5')
    expect(parsed.draftMetrics).toEqual({ epicCount: 1, userStoryCount: 2 })
    expect(parsed.changes).toHaveLength(4)
    expect(parsed.winnerDraftContent).toContain('title: Prompt hardening')
    expect(parsed.structuredOutput).toMatchObject({
      autoRetryCount: 1,
      validationError: 'PRD refinement output is missing changes',
    })
    expect(() => requirePrdRefinedArtifact(undefined)).toThrow('No validated refined PRD found')
  })
})
