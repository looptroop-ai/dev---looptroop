import type {
  RefinementChange,
  RefinementChangeAttributionStatus,
  RefinementChangeInspiration,
  RefinementChangeItem,
  RefinementChangeType,
} from '@shared/refinementChanges'
import { isRecord, normalizeKey, getValueByAliases, toOrdinalInteger, toOptionalString } from './yamlUtils'

function normalizeRefinementChangeType(value: unknown): RefinementChangeType | null {
  const raw = toOptionalString(value)
  if (!raw) return null
  const normalized = normalizeKey(raw)
  if (normalized === 'modified') return 'modified'
  if (normalized === 'added') return 'added'
  if (normalized === 'removed') return 'removed'
  return null
}

function normalizeRefinementChangeItem(value: unknown): RefinementChangeItem | null {
  if (!isRecord(value)) return null
  const id = toOptionalString(getValueByAliases(value, ['id']))
  const label = toOptionalString(getValueByAliases(value, ['title', 'label', 'name']))
  if (!id || !label) return null
  const detail = toOptionalString(getValueByAliases(value, ['detail', 'description', 'objective']))
  return { id, label, ...(detail ? { detail } : {}) }
}

// Lenient parser for inspiration items — mirrors how interviewOutput.ts
// normalizeInterviewInspirationQuestion accepts strings and partial objects.
// Unlike normalizeRefinementChangeItem (used for before/after), this does NOT
// require both id and label — models frequently omit one or output a bare string.
function normalizeInspirationItem(value: unknown): RefinementChangeItem | null {
  if (typeof value === 'string') {
    const label = value.trim()
    if (!label) return null
    return { id: '', label }
  }

  if (!isRecord(value)) return null

  const id = toOptionalString(getValueByAliases(value, ['id'])) ?? ''
  const label = toOptionalString(
    getValueByAliases(value, ['title', 'label', 'name', 'text', 'content', 'description']),
  ) ?? ''
  if (!id && !label) return null

  const detail = id && label
    ? toOptionalString(getValueByAliases(value, ['detail', 'description', 'objective']))
    : undefined

  return { id, label, ...(detail ? { detail } : {}) }
}

function normalizeRefinementInspiration(
  value: unknown,
  losingDraftMeta?: Array<{ memberId: string }>,
): RefinementChangeInspiration | null {
  if (!isRecord(value)) return null

  const altDraft = toOrdinalInteger(getValueByAliases(value, ['alternative_draft', 'alternativedraft', 'draft', 'draft_index', 'draftindex']))
  const rawItem = getValueByAliases(value, ['item', 'bead', 'epic', 'story'])
  const item = normalizeInspirationItem(rawItem)

  if (altDraft == null || !item) return null

  const draftIndex = altDraft - 1
  let memberId = toOptionalString(getValueByAliases(value, ['member_id', 'memberid', 'memberId'])) ?? ''
  if (losingDraftMeta && draftIndex >= 0 && draftIndex < losingDraftMeta.length) {
    memberId = losingDraftMeta[draftIndex]!.memberId
  }

  return { draftIndex, memberId, item }
}

export function parseRefinementChanges(
  rawChanges: unknown,
  losingDraftMeta?: Array<{ memberId: string }>,
): {
  changes: RefinementChange[]
  repairWarnings: string[]
} {
  if (!Array.isArray(rawChanges)) {
    return { changes: [], repairWarnings: [] }
  }

  const changes: RefinementChange[] = []
  const repairWarnings: string[] = []

  for (let index = 0; index < rawChanges.length; index += 1) {
    const entry = rawChanges[index]
    if (!isRecord(entry)) {
      repairWarnings.push(`Skipped non-object refinement change at index ${index}.`)
      continue
    }

    const type = normalizeRefinementChangeType(getValueByAliases(entry, ['type', 'change_type']))
    if (!type) {
      repairWarnings.push(`Skipped refinement change at index ${index} with invalid type.`)
      continue
    }

    const itemType = toOptionalString(getValueByAliases(entry, ['item_type', 'itemtype', 'itemType'])) ?? undefined

    const rawBefore = getValueByAliases(entry, ['before'])
    const rawAfter = getValueByAliases(entry, ['after'])
    const before = rawBefore === null ? null : normalizeRefinementChangeItem(rawBefore)
    const after = rawAfter === null ? null : normalizeRefinementChangeItem(rawAfter)

    const rawInspiration = getValueByAliases(entry, ['inspiration', 'inspired_by'])
    const inspiration = rawInspiration === null || rawInspiration === undefined
      ? null
      : normalizeRefinementInspiration(rawInspiration, losingDraftMeta)
    const attributionStatus: RefinementChangeAttributionStatus = inspiration
      ? 'inspired'
      : rawInspiration === null || rawInspiration === undefined
        ? 'model_unattributed'
        : 'invalid_unattributed'

    changes.push({
      type,
      ...(itemType ? { itemType } : {}),
      before: before ?? null,
      after: after ?? null,
      inspiration: inspiration ?? null,
      attributionStatus,
    })
  }

  return { changes, repairWarnings }
}
