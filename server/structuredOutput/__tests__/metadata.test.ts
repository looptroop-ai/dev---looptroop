import { describe, expect, it } from 'vitest'
import { buildStructuredOutputMetadata, normalizeStructuredOutputMetadata } from '../metadata'

describe.concurrent('structured output metadata helpers', () => {
  it('normalizes metadata and drops malformed interventions', () => {
    const metadata = normalizeStructuredOutputMetadata({
      repairApplied: true,
      repairWarnings: ['Canonicalized ticket_id from the ticket context.'],
      autoRetryCount: 1,
      validationError: 'First pass failed validation.',
      interventions: [
        {
          code: 'cleanup_canonicalization',
          stage: 'normalize',
          category: 'cleanup',
          title: 'Canonicalized saved artifact details',
          summary: 'Saved artifact metadata was normalized.',
          why: 'The generated output did not match the canonical schema.',
          how: 'LoopTroop rewrote the affected fields before saving.',
        },
        {
          code: 'missing_fields_only',
        },
      ],
    })

    expect(metadata).toEqual({
      repairApplied: true,
      repairWarnings: ['Canonicalized ticket_id from the ticket context.'],
      autoRetryCount: 1,
      validationError: 'First pass failed validation.',
      interventions: [
        expect.objectContaining({
          code: 'cleanup_canonicalization',
          category: 'cleanup',
        }),
      ],
    })
  })

  it('merges explicit and derived interventions when building metadata', () => {
    const metadata = buildStructuredOutputMetadata(
      {
        repairApplied: true,
        interventions: [
          {
            code: 'attribution_repaired',
            stage: 'semantic_validation',
            category: 'attribution',
            title: 'Repaired change attribution',
            summary: 'Source attribution was corrected.',
            why: 'The original attribution referenced an invalid source.',
            how: 'LoopTroop repaired the attribution fields before saving.',
          },
        ],
      },
      {
        repairWarnings: [
          'Recovered the structured artifact from surrounding transcript or wrapper text before validation.',
        ],
        autoRetryCount: 1,
        validationError: 'Malformed YAML on first pass.',
      },
    )

    expect(metadata.repairApplied).toBe(true)
    expect(metadata.repairWarnings).toEqual([
      'Recovered the structured artifact from surrounding transcript or wrapper text before validation.',
    ])
    expect(metadata.interventions).toEqual([
      expect.objectContaining({ code: 'attribution_repaired', category: 'attribution' }),
      expect.objectContaining({ code: 'parser_transcript_recovery', category: 'parser_fix' }),
      expect.objectContaining({ code: 'retry_after_validation_failure', category: 'retry' }),
    ])
  })
})
