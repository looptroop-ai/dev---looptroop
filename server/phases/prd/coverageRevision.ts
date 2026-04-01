import type { RefinementChange, RefinementChangeItem } from '@shared/refinementChanges'
import { buildPrdUiRefinementDiffArtifactFromChanges } from '@shared/refinementDiffArtifacts'
import type { PromptPart } from '../../opencode/types'
import type { PrdDraftMetrics, StructuredOutputMetadata } from '../../structuredOutput'
import { normalizePrdYamlOutput } from '../../structuredOutput'
import {
  collectStructuredCandidates,
  getValueByAliases,
  isRecord,
  normalizeKey,
  parseYamlOrJsonCandidate,
  unwrapExplicitWrapperRecord,
} from '../../structuredOutput/yamlUtils'
import { validatePrdRefinementOutput } from './refined'

export type PrdCoverageGapResolutionAction = 'updated_prd' | 'already_covered' | 'left_unresolved'

export interface PrdCoverageAffectedItem {
  itemType: 'epic' | 'user_story'
  id: string
  label: string
}

export interface PrdCoverageGapResolution {
  gap: string
  action: PrdCoverageGapResolutionAction
  rationale: string
  affectedItems: PrdCoverageAffectedItem[]
}

export interface ValidatedPrdCoverageRevision {
  refinedContent: string
  priorCandidateContent: string
  changes: RefinementChange[]
  gapResolutions: PrdCoverageGapResolution[]
  metrics: PrdDraftMetrics
  repairApplied: boolean
  repairWarnings: string[]
}

export interface PrdCoverageRevisionArtifact {
  winnerId: string
  refinedContent: string
  winnerDraftContent: string
  changes: RefinementChange[]
  gapResolutions: PrdCoverageGapResolution[]
  draftMetrics: PrdDraftMetrics
  candidateVersion: number
  structuredOutput?: StructuredOutputMetadata
}

function buildItemLookupFromContent(content: string) {
  const normalized = normalizePrdYamlOutput(content, { ticketId: 'lookup', interviewContent: minimalInterviewContent })
  if (!normalized.ok) return new Map<string, RefinementChangeItem>()
  const items = new Map<string, RefinementChangeItem>()
  for (const epic of normalized.value.epics) {
    items.set(`epic\u241f${epic.id}`, { id: epic.id, label: epic.title, detail: epic.objective })
    for (const story of epic.user_stories) {
      items.set(`user_story\u241f${story.id}`, {
        id: story.id,
        label: story.title,
        detail: story.acceptance_criteria[0] || story.implementation_steps[0] || '',
      })
    }
  }
  return items
}

function normalizeAffectedItemType(value: unknown): 'epic' | 'user_story' | null {
  if (typeof value !== 'string') return null
  const normalized = normalizeKey(value)
  if (normalized === 'epic') return 'epic'
  if (normalized === 'userstory' || normalized === 'userstories' || normalized === 'user_story') return 'user_story'
  return null
}

function parseCoverageRevisionRecord(rawContent: string): Record<string, unknown> {
  const candidates = collectStructuredCandidates(rawContent, {
    topLevelHints: ['schema_version', 'artifact', 'gap_resolutions', 'epics'],
  })

  for (const candidate of candidates) {
    try {
      const parsed = unwrapExplicitWrapperRecord(parseYamlOrJsonCandidate(candidate, {
        allowTrailingTerminalNoise: true,
      }), ['prd', 'document', 'output', 'result', 'data'])
      if (isRecord(parsed)) return parsed
    } catch {
      // Keep trying candidates.
    }
  }

  throw new Error('PRD coverage revision output is not a valid YAML/JSON object')
}

function parseGapResolutions(
  rawContent: string,
  coverageGaps: string[],
  currentCandidateContent: string,
  revisedContent: string,
): {
  gapResolutions: PrdCoverageGapResolution[]
  repairWarnings: string[]
} {
  const parsed = parseCoverageRevisionRecord(rawContent)
  const rawGapResolutions = getValueByAliases(parsed, ['gap_resolutions', 'gapresolutions'])
  if (!Array.isArray(rawGapResolutions)) {
    throw new Error('PRD coverage revision output must include a top-level gap_resolutions list')
  }

  const repairWarnings: string[] = []
  const priorItems = buildItemLookupFromContent(currentCandidateContent)
  const revisedItems = buildItemLookupFromContent(revisedContent)
  const resolutions: PrdCoverageGapResolution[] = []

  for (const [index, value] of rawGapResolutions.entries()) {
    if (!isRecord(value)) {
      throw new Error(`PRD coverage gap_resolutions entry at index ${index} is not an object`)
    }

    const gap = typeof getValueByAliases(value, ['gap']) === 'string'
      ? String(getValueByAliases(value, ['gap'])).trim()
      : ''
    if (!gap) {
      throw new Error(`PRD coverage gap_resolutions entry at index ${index} is missing gap`)
    }

    const rawAction = typeof getValueByAliases(value, ['action']) === 'string'
      ? String(getValueByAliases(value, ['action'])).trim()
      : ''
    const normalizedAction = normalizeKey(rawAction)
    let action: PrdCoverageGapResolutionAction | null = null
    if (normalizedAction === 'updatedprd') action = 'updated_prd'
    if (normalizedAction === 'alreadycovered') action = 'already_covered'
    if (normalizedAction === 'leftunresolved') action = 'left_unresolved'
    if (!action) {
      throw new Error(`PRD coverage gap_resolutions entry for "${gap}" has unsupported action "${rawAction}"`)
    }

    const rationale = typeof getValueByAliases(value, ['rationale']) === 'string'
      ? String(getValueByAliases(value, ['rationale'])).trim()
      : ''
    if (!rationale) {
      throw new Error(`PRD coverage gap_resolutions entry for "${gap}" is missing rationale`)
    }

    const rawAffectedItems = getValueByAliases(value, ['affected_items', 'affecteditems'])
    const affectedItems = Array.isArray(rawAffectedItems)
      ? rawAffectedItems.flatMap((item, itemIndex) => {
          if (!isRecord(item)) {
            throw new Error(`PRD coverage affected_items entry at gap "${gap}" index ${itemIndex} is not an object`)
          }
          const itemType = normalizeAffectedItemType(getValueByAliases(item, ['item_type', 'itemtype']))
          if (!itemType) {
            throw new Error(`PRD coverage affected_items entry at gap "${gap}" index ${itemIndex} is missing item_type`)
          }
          const id = typeof getValueByAliases(item, ['id']) === 'string'
            ? String(getValueByAliases(item, ['id'])).trim()
            : ''
          const label = typeof getValueByAliases(item, ['label', 'title']) === 'string'
            ? String(getValueByAliases(item, ['label', 'title'])).trim()
            : ''
          if (!id || !label) {
            throw new Error(`PRD coverage affected_items entry at gap "${gap}" index ${itemIndex} requires id and label`)
          }

          const lookupKey = `${itemType}\u241f${id}`
          const canonical = revisedItems.get(lookupKey) ?? priorItems.get(lookupKey)
          if (!canonical) {
            throw new Error(`PRD coverage affected_items entry at gap "${gap}" references unknown ${itemType} ${id}`)
          }
          if (canonical.label !== label) {
            repairWarnings.push(`Canonicalized affected_items label for ${itemType} ${id} from "${label}" to "${canonical.label}".`)
          }

          return [{
            itemType,
            id,
            label: canonical.label,
          } satisfies PrdCoverageAffectedItem]
        })
      : []

    resolutions.push({
      gap,
      action,
      rationale,
      affectedItems,
    })
  }

  const normalizedCoverageGaps = coverageGaps.map((gap) => gap.trim()).filter(Boolean)
  const seen = new Set<string>()
  for (const resolution of resolutions) {
    if (!normalizedCoverageGaps.includes(resolution.gap)) {
      throw new Error(`PRD coverage gap_resolutions entry references unknown gap "${resolution.gap}"`)
    }
    if (seen.has(resolution.gap)) {
      throw new Error(`PRD coverage gap_resolutions contains duplicate entry for "${resolution.gap}"`)
    }
    seen.add(resolution.gap)
  }

  const missingGaps = normalizedCoverageGaps.filter((gap) => !seen.has(gap))
  if (missingGaps.length > 0) {
    throw new Error(`PRD coverage gap_resolutions must include exactly one entry per gap. Missing: ${missingGaps.join(' | ')}`)
  }

  return { gapResolutions: resolutions, repairWarnings }
}

export function validatePrdCoverageRevisionOutput(
  rawContent: string,
  options: {
    ticketId: string
    interviewContent: string
    currentCandidateContent: string
    coverageGaps: string[]
  },
): ValidatedPrdCoverageRevision {
  const validatedRefinement = validatePrdRefinementOutput(rawContent, {
    ticketId: options.ticketId,
    interviewContent: options.interviewContent,
    winnerDraftContent: options.currentCandidateContent,
  })
  const parsedGapResolutions = parseGapResolutions(
    rawContent,
    options.coverageGaps,
    validatedRefinement.winnerDraftContent,
    validatedRefinement.refinedContent,
  )

  return {
    refinedContent: validatedRefinement.refinedContent,
    priorCandidateContent: validatedRefinement.winnerDraftContent,
    changes: validatedRefinement.changes,
    gapResolutions: parsedGapResolutions.gapResolutions,
    metrics: validatedRefinement.metrics,
    repairApplied: validatedRefinement.repairApplied || parsedGapResolutions.repairWarnings.length > 0,
    repairWarnings: [...validatedRefinement.repairWarnings, ...parsedGapResolutions.repairWarnings],
  }
}

export function buildPrdCoverageRevisionArtifact(
  winnerId: string,
  candidateVersion: number,
  revision: ValidatedPrdCoverageRevision,
  structuredOutput?: StructuredOutputMetadata,
): PrdCoverageRevisionArtifact {
  const normalizedWinnerId = winnerId.trim()
  if (!normalizedWinnerId) {
    throw new Error('PRD coverage revision artifact is missing winnerId')
  }

  return {
    winnerId: normalizedWinnerId,
    refinedContent: revision.refinedContent,
    winnerDraftContent: revision.priorCandidateContent,
    changes: revision.changes,
    gapResolutions: revision.gapResolutions,
    draftMetrics: revision.metrics,
    candidateVersion,
    ...(structuredOutput ? { structuredOutput } : {}),
  }
}

export function buildPrdCoverageRevisionUiDiff(revisionArtifact: PrdCoverageRevisionArtifact) {
  return buildPrdUiRefinementDiffArtifactFromChanges({
    winnerId: revisionArtifact.winnerId,
    changes: revisionArtifact.changes,
    winnerDraftContent: revisionArtifact.winnerDraftContent,
    refinedContent: revisionArtifact.refinedContent,
    losingDrafts: [],
  })
}

function stripLegacyTopLevelKeysFromYaml(rawResponse: string): string {
  const candidates = [rawResponse.trim()]
  for (const candidate of candidates) {
    try {
      const parsed = parseCoverageRevisionRecord(candidate)
      delete parsed.changes
      delete parsed.gap_resolutions
      delete parsed.gapResolutions
      return JSON.stringify(parsed, null, 2)
    } catch {
      // fall through to regex cleanup
    }
  }

  return rawResponse.trim()
    .replace(/\nchanges:\n(?: {2,}.*\n?)*/u, '')
    .replace(/\ngap_resolutions:\n(?: {2,}.*\n?)*/u, '')
    .trim()
}

export function buildPrdCoverageRevisionRetryPrompt(
  baseParts: PromptPart[],
  params: {
    validationError: string
    rawResponse: string
  },
): PromptPart[] {
  const sanitizedRawResponse = stripLegacyTopLevelKeysFromYaml(params.rawResponse)

  return [
    ...baseParts,
    {
      type: 'text',
      content: [
        '## PRD Coverage Resolution Structured Output Retry',
        `Your previous response failed validation: ${params.validationError}`,
        '',
        'Return only one corrected YAML artifact.',
        'Requirements:',
        '- Use the exact PRD schema.',
        '- Include a top-level `changes` list that fully accounts for the diff between the current PRD candidate and the revised PRD candidate.',
        '- Include a top-level `gap_resolutions` list with exactly one entry per provided coverage gap.',
        '- Preserve epic IDs and user story IDs unless the revised candidate contains a genuinely new item.',
        '- If a gap was already covered, keep the PRD unchanged for that gap and record `action: already_covered`.',
        '- Use `affected_items` only for epic or user_story references. Leave it empty when no epic/story mapping applies.',
        '',
        'Previous invalid response:',
        '```',
        sanitizedRawResponse || '[empty response]',
        '```',
      ].join('\n'),
    },
  ]
}

const minimalInterviewContent = [
  'schema_version: 1',
  'ticket_id: LOOKUP',
  'artifact: interview',
  'status: approved',
  'generated_by:',
  '  winner_model: lookup',
  '  generated_at: 2026-01-01T00:00:00.000Z',
  'questions:',
  '  - id: Q01',
  '    phase: Foundation',
  '    prompt: "Lookup placeholder"',
  '    source: compiled',
  '    answer_type: free_text',
  '    options: []',
  '    answer:',
  '      skipped: false',
  '      selected_option_ids: []',
  '      free_text: "Lookup placeholder"',
  '      answered_by: user',
  '      answered_at: 2026-01-01T00:00:00.000Z',
  'follow_up_rounds: []',
  'summary:',
  '  goals: []',
  '  constraints: []',
  '  non_goals: []',
  '  final_free_form_answer: ""',
  'approval:',
  '  approved_by: ""',
  '  approved_at: ""',
].join('\n')
