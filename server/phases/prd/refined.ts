import jsYaml from 'js-yaml'
import type {
  RefinementChange,
  RefinementChangeAttributionStatus,
  RefinementChangeItem,
} from '@shared/refinementChanges'
import type { PromptPart } from '../../opencode/types'
import type {
  PrdDocument,
  PrdDraftMetrics,
  StructuredOutputMetadata,
} from '../../structuredOutput'
import { getPrdDraftMetrics, normalizePrdYamlOutput } from '../../structuredOutput'
import { normalizeKey } from '../../structuredOutput/yamlUtils'

type PrdRefinementItemType = 'epic' | 'user_story'

interface NormalizedPrdRefinementItem extends RefinementChangeItem {
  itemType: PrdRefinementItemType
}

export interface ValidatedPrdRefinement {
  document: PrdDocument
  metrics: PrdDraftMetrics
  refinedContent: string
  winnerDraftContent: string
  changes: RefinementChange[]
  repairApplied: boolean
  repairWarnings: string[]
}

export interface PrdRefinedArtifact {
  winnerId: string
  refinedContent: string
  winnerDraftContent: string
  changes?: RefinementChange[]
  structuredOutput?: StructuredOutputMetadata
  draftMetrics: PrdDraftMetrics
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function buildItemKey(item: Pick<NormalizedPrdRefinementItem, 'itemType' | 'id' | 'label'>): string {
  return `${item.itemType}\u241f${item.id}\u241f${item.label}`
}

function buildItemIdentityKey(item: Pick<NormalizedPrdRefinementItem, 'itemType' | 'id'>): string {
  return `${item.itemType}\u241f${item.id}`
}

function normalizePrdItemType(value: unknown): PrdRefinementItemType | null {
  if (typeof value !== 'string') return null
  const normalized = normalizeKey(value)
  if (normalized === 'epic') return 'epic'
  if (normalized === 'userstory' || normalized === 'userstories' || normalized === 'user_story') return 'user_story'
  return null
}

function buildDocumentItems(document: PrdDocument): NormalizedPrdRefinementItem[] {
  const items: NormalizedPrdRefinementItem[] = []

  for (const epic of document.epics) {
    items.push({
      itemType: 'epic',
      id: epic.id,
      label: epic.title,
      ...(epic.objective ? { detail: epic.objective } : {}),
    })

    for (const story of epic.user_stories) {
      const detail = story.acceptance_criteria[0] || story.implementation_steps[0] || ''
      items.push({
        itemType: 'user_story',
        id: story.id,
        label: story.title,
        ...(detail ? { detail } : {}),
      })
    }
  }

  return items
}

function buildItemLookup(items: NormalizedPrdRefinementItem[]) {
  const byKey = new Map<string, NormalizedPrdRefinementItem>()
  const byIdentityKey = new Map<string, NormalizedPrdRefinementItem[]>()
  const byId = new Map<string, NormalizedPrdRefinementItem[]>()

  for (const item of items) {
    byKey.set(buildItemKey(item), item)

    const identityKey = buildItemIdentityKey(item)
    const identityMatches = byIdentityKey.get(identityKey) ?? []
    identityMatches.push(item)
    byIdentityKey.set(identityKey, identityMatches)

    const idMatches = byId.get(item.id) ?? []
    idMatches.push(item)
    byId.set(item.id, idMatches)
  }

  return { byKey, byIdentityKey, byId }
}

function cloneCanonicalItem(item: NormalizedPrdRefinementItem): RefinementChangeItem {
  return item.detail
    ? { id: item.id, label: item.label, detail: item.detail }
    : { id: item.id, label: item.label }
}

function normalizeArtifactStructuredOutput(value: unknown): StructuredOutputMetadata | undefined {
  if (!isRecord(value)) return undefined

  const repairApplied = typeof value.repairApplied === 'boolean' ? value.repairApplied : false
  const repairWarnings = Array.isArray(value.repairWarnings)
    ? value.repairWarnings.filter((warning): warning is string => typeof warning === 'string')
    : []
  const autoRetryCount = typeof value.autoRetryCount === 'number' && Number.isInteger(value.autoRetryCount)
    ? value.autoRetryCount
    : 0
  const validationError = typeof value.validationError === 'string' && value.validationError.trim()
    ? value.validationError
    : undefined

  return {
    repairApplied,
    repairWarnings,
    autoRetryCount,
    ...(validationError ? { validationError } : {}),
  }
}

function normalizeDraftMetrics(value: unknown): PrdDraftMetrics | null {
  if (!isRecord(value)) return null

  const epicCount = typeof value.epicCount === 'number' && Number.isInteger(value.epicCount)
    ? value.epicCount
    : null
  const userStoryCount = typeof value.userStoryCount === 'number' && Number.isInteger(value.userStoryCount)
    ? value.userStoryCount
    : null

  if (epicCount == null || userStoryCount == null) {
    return null
  }

  return { epicCount, userStoryCount }
}

function deriveDraftMetricsFromRefinedContent(content: string): PrdDraftMetrics | null {
  try {
    const parsed = jsYaml.load(content)
    if (!isRecord(parsed) || !Array.isArray(parsed.epics)) {
      return null
    }

    const epicCount = parsed.epics.length
    const userStoryCount = parsed.epics.reduce((sum, epic) => {
      if (!isRecord(epic) || !Array.isArray(epic.user_stories)) {
        return sum
      }
      return sum + epic.user_stories.length
    }, 0)

    return { epicCount, userStoryCount }
  } catch {
    return null
  }
}

function inferPrdItemType(
  change: RefinementChange,
  winnerLookup: ReturnType<typeof buildItemLookup>,
  finalLookup: ReturnType<typeof buildItemLookup>,
): PrdRefinementItemType | null {
  const candidates: PrdRefinementItemType[] = [change.before, change.after]
    .filter((item): item is RefinementChangeItem => Boolean(item))
    .flatMap((item) => {
      const matches: PrdRefinementItemType[] = []
      if (item.label) {
        for (const lookup of [winnerLookup, finalLookup]) {
          for (const itemType of ['epic', 'user_story'] as const) {
            const candidate = lookup.byKey.get(buildItemKey({ itemType, id: item.id, label: item.label }))
            if (candidate) matches.push(candidate.itemType)
          }
        }
      }

      if (matches.length > 0) return matches

      const idMatches = [
        ...(winnerLookup.byId.get(item.id) ?? []),
        ...(finalLookup.byId.get(item.id) ?? []),
      ]
      if (idMatches.length === 1) {
        return [idMatches[0]!.itemType]
      }

      if (/^epic-/i.test(item.id)) return ['epic']
      if (/^us-/i.test(item.id)) return ['user_story']
      return []
    })

  const unique = [...new Set<PrdRefinementItemType>(candidates)]
  return unique.length === 1 ? unique[0]! : null
}

function normalizePrdChangeItem(
  item: RefinementChangeItem | null | undefined,
  itemType: PrdRefinementItemType,
  lookup: ReturnType<typeof buildItemLookup>,
): RefinementChangeItem | null {
  if (!item) return null

  const canonical = lookup.byKey.get(buildItemKey({ itemType, id: item.id, label: item.label }))
  return canonical ? cloneCanonicalItem(canonical) : item
}

function normalizeAttributionStatus(
  status: RefinementChangeAttributionStatus | undefined,
  inspiration: RefinementChange['inspiration'] | null,
): RefinementChangeAttributionStatus {
  if (
    status === 'inspired'
    || status === 'model_unattributed'
    || status === 'synthesized_unattributed'
    || status === 'invalid_unattributed'
  ) {
    return status
  }

  return inspiration ? 'inspired' : 'model_unattributed'
}

function validateChangeCoverage(
  winnerItems: NormalizedPrdRefinementItem[],
  finalItems: NormalizedPrdRefinementItem[],
  usedBeforeKeys: Set<string>,
  usedAfterKeys: Set<string>,
) {
  const winnerKeySet = new Set(winnerItems.map(buildItemKey))
  const finalKeySet = new Set(finalItems.map(buildItemKey))
  const expectedBeforeKeys = [...winnerKeySet].filter((key) => !finalKeySet.has(key))
  const expectedAfterKeys = [...finalKeySet].filter((key) => !winnerKeySet.has(key))

  const missingBefore = expectedBeforeKeys.filter((key) => !usedBeforeKeys.has(key))
  const missingAfter = expectedAfterKeys.filter((key) => !usedAfterKeys.has(key))
  const extraBefore = [...usedBeforeKeys].filter((key) => !winnerKeySet.has(key) || finalKeySet.has(key))
  const extraAfter = [...usedAfterKeys].filter((key) => !finalKeySet.has(key) || winnerKeySet.has(key))

  if (missingBefore.length > 0 || missingAfter.length > 0 || extraBefore.length > 0 || extraAfter.length > 0) {
    throw new Error('PRD refinement changes do not fully and exactly account for the diff between the winning draft and the final output.')
  }
}

export function validatePrdRefinementOutput(
  rawContent: string,
  options: {
    ticketId: string
    interviewContent: string
    winnerDraftContent: string
    losingDraftMeta?: Array<{ memberId: string }>
  },
): ValidatedPrdRefinement {
  const winnerResult = normalizePrdYamlOutput(options.winnerDraftContent, {
    ticketId: options.ticketId,
    interviewContent: options.interviewContent,
  })
  if (!winnerResult.ok) {
    throw new Error(`Winning PRD draft is invalid: ${winnerResult.error}`)
  }

  const refinementResult = normalizePrdYamlOutput(rawContent, {
    ticketId: options.ticketId,
    interviewContent: options.interviewContent,
    losingDraftMeta: options.losingDraftMeta,
  })
  if (!refinementResult.ok) {
    throw new Error(refinementResult.error)
  }

  const { changes = [], ...refinedDocument } = refinementResult.value
  if (changes.length === 0) {
    return {
      document: refinedDocument,
      metrics: getPrdDraftMetrics(refinedDocument),
      refinedContent: refinementResult.normalizedContent,
      winnerDraftContent: winnerResult.normalizedContent,
      changes: [],
      repairApplied: refinementResult.repairApplied,
      repairWarnings: [...refinementResult.repairWarnings],
    }
  }

  const winnerDocument = winnerResult.value
  const winnerItems = buildDocumentItems(winnerDocument)
  const finalItems = buildDocumentItems(refinedDocument)
  const winnerLookup = buildItemLookup(winnerItems)
  const finalLookup = buildItemLookup(finalItems)
  const winnerKeySet = new Set(winnerItems.map(buildItemKey))
  const finalKeySet = new Set(finalItems.map(buildItemKey))
  const usedBeforeKeys = new Set<string>()
  const usedAfterKeys = new Set<string>()
  const repairWarnings = [...refinementResult.repairWarnings]
  const validatedChanges: RefinementChange[] = []
  let repairApplied = refinementResult.repairApplied

  for (const [index, change] of changes.entries()) {
    let itemType = normalizePrdItemType(change.itemType)
    if (!itemType) {
      const inferredItemType = inferPrdItemType(change, winnerLookup, finalLookup)
      if (!inferredItemType) {
        throw new Error(`PRD refinement change at index ${index} is missing item_type and no unique repair candidate was found`)
      }
      itemType = inferredItemType
      repairApplied = true
      repairWarnings.push(`Inferred missing PRD refinement item_type at index ${index} as ${itemType}.`)
    }

    const before = normalizePrdChangeItem(change.before, itemType, winnerLookup)
    const after = normalizePrdChangeItem(change.after, itemType, finalLookup)

    if (change.type === 'modified') {
      if (!before || !after) {
        throw new Error(`PRD refinement change at index ${index} with type modified must include populated before and after items`)
      }
      if (before.id !== after.id) {
        throw new Error(`PRD refinement change at index ${index} with type modified must preserve the same id`)
      }
    } else if (change.type === 'added') {
      if (before !== null || !after) {
        throw new Error(`PRD refinement change at index ${index} with type added must use before: null and a populated after`)
      }
    } else if (change.type === 'removed') {
      if (!before || after !== null) {
        throw new Error(`PRD refinement change at index ${index} with type removed must use after: null and a populated before`)
      }
    }

    if (before && after && buildItemKey({ itemType, ...before }) === buildItemKey({ itemType, ...after })) {
      const changeKey = buildItemKey({ itemType, ...before })
      if (winnerKeySet.has(changeKey) && finalKeySet.has(changeKey)) {
        repairApplied = true
        repairWarnings.push(`Dropped no-op PRD refinement modified change at index ${index} because the winning and final records are identical.`)
        continue
      }
    }

    if (before) {
      const beforeKey = buildItemKey({ itemType, ...before })
      if (!winnerKeySet.has(beforeKey)) {
        throw new Error(`PRD refinement change.before at index ${index} does not match any item from the winning draft`)
      }
      if (usedBeforeKeys.has(beforeKey)) {
        throw new Error(`PRD refinement change.before at index ${index} reuses a winning-draft item already referenced by another change`)
      }
      usedBeforeKeys.add(beforeKey)
    }

    if (after) {
      const afterKey = buildItemKey({ itemType, ...after })
      if (!finalKeySet.has(afterKey)) {
        throw new Error(`PRD refinement change.after at index ${index} does not match any item from the refined final draft`)
      }
      if (usedAfterKeys.has(afterKey)) {
        throw new Error(`PRD refinement change.after at index ${index} reuses a refined final item already referenced by another change`)
      }
      usedAfterKeys.add(afterKey)
    }

    let inspiration = change.inspiration ?? null
    let attributionStatus = normalizeAttributionStatus(change.attributionStatus, inspiration)
    if (inspiration) {
      const losingDraft = options.losingDraftMeta?.[inspiration.draftIndex]
      if (!losingDraft) {
        const draftNumber = inspiration.draftIndex + 1
        inspiration = null
        attributionStatus = 'invalid_unattributed'
        repairApplied = true
        repairWarnings.push(`Cleared out-of-range PRD refinement inspiration at index ${index} because alternative draft ${draftNumber} does not exist.`)
      } else {
        inspiration = {
          ...inspiration,
          memberId: losingDraft.memberId,
        }
        attributionStatus = 'inspired'
      }
    } else if (attributionStatus === 'inspired') {
      attributionStatus = 'model_unattributed'
    }

    validatedChanges.push({
      type: change.type,
      itemType,
      before,
      after,
      inspiration,
      attributionStatus,
    })
  }

  validateChangeCoverage(winnerItems, finalItems, usedBeforeKeys, usedAfterKeys)

  return {
    document: refinedDocument,
    metrics: getPrdDraftMetrics(refinedDocument),
    refinedContent: refinementResult.normalizedContent,
    winnerDraftContent: winnerResult.normalizedContent,
    changes: validatedChanges,
    repairApplied,
    repairWarnings,
  }
}

export function buildPrdRefinedArtifact(
  winnerId: string,
  winnerDraftContent: string,
  refinement: ValidatedPrdRefinement,
  structuredOutput?: StructuredOutputMetadata,
): PrdRefinedArtifact {
  const normalizedWinnerId = winnerId.trim()
  if (!normalizedWinnerId) {
    throw new Error('PRD refined artifact is missing winnerId')
  }

  return {
    winnerId: normalizedWinnerId,
    refinedContent: refinement.refinedContent,
    winnerDraftContent,
    ...(structuredOutput ? { structuredOutput } : {}),
    draftMetrics: refinement.metrics,
  }
}

export function parsePrdRefinedArtifact(content: string): PrdRefinedArtifact {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('PRD refined artifact is not valid JSON')
  }

  if (!isRecord(parsed)) {
    throw new Error('PRD refined artifact payload is invalid')
  }

  const winnerId = typeof parsed.winnerId === 'string' ? parsed.winnerId.trim() : ''
  const refinedContent = typeof parsed.refinedContent === 'string' ? parsed.refinedContent : ''
  const winnerDraftContent = typeof parsed.winnerDraftContent === 'string' ? parsed.winnerDraftContent : ''
  const changes = Array.isArray(parsed.changes) ? parsed.changes as RefinementChange[] : []
  const structuredOutput = normalizeArtifactStructuredOutput(parsed.structuredOutput)
  const draftMetrics = normalizeDraftMetrics(parsed.draftMetrics) ?? deriveDraftMetricsFromRefinedContent(refinedContent)

  if (!refinedContent.trim()) {
    throw new Error('PRD refined artifact is missing refinedContent')
  }
  if (!draftMetrics) {
    throw new Error('PRD refined artifact is missing draftMetrics')
  }

  return {
    winnerId,
    refinedContent,
    winnerDraftContent,
    changes,
    structuredOutput,
    draftMetrics,
  }
}

export function requirePrdRefinedArtifact(content: string | null | undefined): PrdRefinedArtifact {
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('No validated refined PRD found')
  }

  return parsePrdRefinedArtifact(content)
}

function stripLegacyTopLevelChangesFromYaml(rawResponse: string): string {
  const trimmed = rawResponse.trim()
  if (!trimmed) return trimmed

  try {
    const parsed = jsYaml.load(trimmed)
    if (isRecord(parsed) && 'changes' in parsed) {
      const sanitized = { ...parsed }
      delete sanitized.changes
      return jsYaml.dump(sanitized, { lineWidth: -1, noRefs: true }).trim()
    }
  } catch {
    // Preserve the original response when it cannot be parsed safely.
  }

  return trimmed.replace(/\nchanges:\n(?: {2,}.*\n?)*/u, '').trim()
}

export function buildPrdRefinementRetryPrompt(
  baseParts: PromptPart[],
  params: {
    validationError: string
    rawResponse: string
  },
): PromptPart[] {
  const sanitizedRawResponse = stripLegacyTopLevelChangesFromYaml(params.rawResponse)

  return [
    ...baseParts,
    {
      type: 'text',
      content: [
        '## PRD Refinement Structured Output Retry',
        `Your previous response failed validation: ${params.validationError}`,
        '',
        'Return only one corrected YAML artifact.',
        'Requirements:',
        '- Use the exact PROM10 PRD schema.',
        '- Preserve epic IDs and user story IDs unless the final draft contains a genuinely new item.',
        '- Do not wrap the PRD in another object.',
        '- Do not include prose, commentary, markdown fences, or extra top-level keys.',
        '',
        '## Previous Invalid Response',
        '```yaml',
        sanitizedRawResponse,
        '```',
      ].join('\n'),
    },
  ]
}
