import { describe, expect, it } from 'vitest'
import { parseRefinementChanges } from '../refinementChanges'

const LOSING_DRAFT_META = [
  { memberId: 'openai/gpt-5-mini' },
  { memberId: 'anthropic/claude-sonnet-4' },
]

function makeChange(overrides: Record<string, unknown> = {}) {
  return {
    type: 'modified',
    item_type: 'user_story',
    before: { id: 'US-1', title: 'Original story' },
    after: { id: 'US-1', title: 'Refined story' },
    ...overrides,
  }
}

describe.concurrent('parseRefinementChanges — inspiration item parsing', () => {
  it('accepts inspiration with both id and label (strict format)', () => {
    const { changes } = parseRefinementChanges(
      [makeChange({
        inspiration: { alternative_draft: 1, item: { id: 'US-8', title: 'Extra coverage' } },
      })],
      LOSING_DRAFT_META,
    )

    expect(changes).toHaveLength(1)
    expect(changes[0]!.inspiration).toMatchObject({
      draftIndex: 0,
      memberId: 'openai/gpt-5-mini',
      item: { id: 'US-8', label: 'Extra coverage' },
    })
    expect(changes[0]!.attributionStatus).toBe('inspired')
  })

  it('accepts inspiration with a bare string item', () => {
    const { changes } = parseRefinementChanges(
      [makeChange({
        inspiration: { alternative_draft: 2, item: 'Add pink theme toggle' },
      })],
      LOSING_DRAFT_META,
    )

    expect(changes).toHaveLength(1)
    expect(changes[0]!.inspiration).toMatchObject({
      draftIndex: 1,
      memberId: 'anthropic/claude-sonnet-4',
      item: { id: '', label: 'Add pink theme toggle' },
    })
    expect(changes[0]!.attributionStatus).toBe('inspired')
  })

  it('accepts inspiration item with only label (no id)', () => {
    const { changes } = parseRefinementChanges(
      [makeChange({
        inspiration: { alternative_draft: 1, item: { title: 'Better error handling' } },
      })],
      LOSING_DRAFT_META,
    )

    expect(changes).toHaveLength(1)
    expect(changes[0]!.inspiration).toMatchObject({
      draftIndex: 0,
      memberId: 'openai/gpt-5-mini',
      item: { id: '', label: 'Better error handling' },
    })
    expect(changes[0]!.attributionStatus).toBe('inspired')
  })

  it('accepts inspiration item with only id (no label)', () => {
    const { changes } = parseRefinementChanges(
      [makeChange({
        inspiration: { alternative_draft: 1, item: { id: 'US-42' } },
      })],
      LOSING_DRAFT_META,
    )

    expect(changes).toHaveLength(1)
    expect(changes[0]!.inspiration).toMatchObject({
      draftIndex: 0,
      item: { id: 'US-42', label: '' },
    })
    expect(changes[0]!.attributionStatus).toBe('inspired')
  })

  it('accepts inspiration item using name alias for label', () => {
    const { changes } = parseRefinementChanges(
      [makeChange({
        inspiration: { alternative_draft: 1, item: { name: 'Retry logic' } },
      })],
      LOSING_DRAFT_META,
    )

    expect(changes[0]!.inspiration).toMatchObject({
      item: { id: '', label: 'Retry logic' },
    })
    expect(changes[0]!.attributionStatus).toBe('inspired')
  })

  it('accepts inspiration item using text alias for label', () => {
    const { changes } = parseRefinementChanges(
      [makeChange({
        inspiration: { alternative_draft: 1, item: { text: 'Cache invalidation' } },
      })],
      LOSING_DRAFT_META,
    )

    expect(changes[0]!.inspiration).toMatchObject({
      item: { id: '', label: 'Cache invalidation' },
    })
    expect(changes[0]!.attributionStatus).toBe('inspired')
  })

  it('rejects inspiration with null item', () => {
    const { changes } = parseRefinementChanges(
      [makeChange({
        inspiration: { alternative_draft: 1, item: null },
      })],
      LOSING_DRAFT_META,
    )

    expect(changes[0]!.inspiration).toBeNull()
    expect(changes[0]!.attributionStatus).toBe('invalid_unattributed')
  })

  it('rejects inspiration with empty string item', () => {
    const { changes } = parseRefinementChanges(
      [makeChange({
        inspiration: { alternative_draft: 1, item: '   ' },
      })],
      LOSING_DRAFT_META,
    )

    expect(changes[0]!.inspiration).toBeNull()
    expect(changes[0]!.attributionStatus).toBe('invalid_unattributed')
  })

  it('rejects inspiration with empty object item', () => {
    const { changes } = parseRefinementChanges(
      [makeChange({
        inspiration: { alternative_draft: 1, item: {} },
      })],
      LOSING_DRAFT_META,
    )

    expect(changes[0]!.inspiration).toBeNull()
    expect(changes[0]!.attributionStatus).toBe('invalid_unattributed')
  })

  it('rejects inspiration with no alternative_draft', () => {
    const { changes } = parseRefinementChanges(
      [makeChange({
        inspiration: { item: { id: 'US-8', title: 'Extra coverage' } },
      })],
      LOSING_DRAFT_META,
    )

    expect(changes[0]!.inspiration).toBeNull()
    expect(changes[0]!.attributionStatus).toBe('invalid_unattributed')
  })

  it('sets model_unattributed when inspiration is null', () => {
    const { changes } = parseRefinementChanges(
      [makeChange({ inspiration: null })],
      LOSING_DRAFT_META,
    )

    expect(changes[0]!.inspiration).toBeNull()
    expect(changes[0]!.attributionStatus).toBe('model_unattributed')
  })

  it('sets model_unattributed when inspiration is omitted', () => {
    const change = makeChange()
    delete (change as Record<string, unknown>).inspiration
    const { changes } = parseRefinementChanges([change], LOSING_DRAFT_META)

    expect(changes[0]!.inspiration).toBeNull()
    expect(changes[0]!.attributionStatus).toBe('model_unattributed')
  })

  it('preserves detail when both id and label are present', () => {
    const { changes } = parseRefinementChanges(
      [makeChange({
        inspiration: {
          alternative_draft: 1,
          item: { id: 'US-8', title: 'Extra coverage', detail: 'Adds edge case tests' },
        },
      })],
      LOSING_DRAFT_META,
    )

    expect(changes[0]!.inspiration!.item).toEqual({
      id: 'US-8',
      label: 'Extra coverage',
      detail: 'Adds edge case tests',
    })
  })

  it('does not include detail when only label is present', () => {
    const { changes } = parseRefinementChanges(
      [makeChange({
        inspiration: {
          alternative_draft: 1,
          item: { title: 'Extra coverage', description: 'Adds edge case tests' },
        },
      })],
      LOSING_DRAFT_META,
    )

    // 'description' is used as label fallback, not extracted as detail
    expect(changes[0]!.inspiration!.item).toEqual({
      id: '',
      label: 'Extra coverage',
    })
  })

})
