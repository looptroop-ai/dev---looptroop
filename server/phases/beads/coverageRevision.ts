import { buildBeadsUiRefinementDiffArtifact } from '@shared/refinementDiffArtifacts'
import type { PromptPart } from '../../opencode/types'
import { normalizeBeadsJsonlOutput, type StructuredOutputMetadata } from '../../structuredOutput'
import {
  collectStructuredCandidates,
  getValueByAliases,
  isRecord,
  normalizeKey,
  parseYamlOrJsonCandidate,
  unwrapExplicitWrapperRecord,
} from '../../structuredOutput/yamlUtils'
import type { Bead } from './types'

export type BeadsCoverageGapResolutionAction = 'updated_beads' | 'already_covered' | 'left_unresolved'

export interface BeadsCoverageAffectedItem {
  itemType: 'bead'
  id: string
  label: string
}

export interface BeadsCoverageGapResolution {
  gap: string
  action: BeadsCoverageGapResolutionAction
  rationale: string
  affectedItems: BeadsCoverageAffectedItem[]
}

export interface ValidatedBeadsCoverageRevision {
  refinedContent: string
  priorCandidateContent: string
  gapResolutions: BeadsCoverageGapResolution[]
  repairApplied: boolean
  repairWarnings: string[]
}

export interface BeadsCoverageRevisionArtifact {
  winnerId: string
  refinedContent: string
  winnerDraftContent: string
  gapResolutions: BeadsCoverageGapResolution[]
  candidateVersion: number
  structuredOutput?: StructuredOutputMetadata
  uiRefinementDiff: ReturnType<typeof buildBeadsUiRefinementDiffArtifact>
}

function buildJsonl(beads: Bead[]): string {
  return beads.map((bead) => JSON.stringify(bead)).join('\n')
}

function parseBeadsJsonl(content: string): Bead[] {
  const normalized = normalizeBeadsJsonlOutput(content)
  if (!normalized.ok) {
    throw new Error(normalized.error)
  }
  return normalized.value
}

function parseCoverageRevisionRecord(rawContent: string): Record<string, unknown> {
  const candidates = collectStructuredCandidates(rawContent, {
    topLevelHints: ['beads', 'gap_resolutions'],
  })

  for (const candidate of candidates) {
    try {
      const parsed = unwrapExplicitWrapperRecord(parseYamlOrJsonCandidate(candidate, {
        allowTrailingTerminalNoise: true,
      }), ['document', 'output', 'result', 'data'])

      if (isRecord(parsed) && Array.isArray(getValueByAliases(parsed, ['beads']))) {
        return parsed
      }
    } catch {
      // Keep trying candidates.
    }
  }

  throw new Error('Beads coverage revision output is not a valid YAML/JSON object')
}

function canonicalizeRevisedBeads(currentCandidateBeads: Bead[], revisedBeads: Bead[]): Bead[] {
  const currentById = new Map(currentCandidateBeads.map((bead) => [bead.id, bead] as const))
  const now = new Date().toISOString()
  const hydrated = revisedBeads.map((bead, index) => {
    const current = currentById.get(bead.id)
    return {
      ...bead,
      priority: index + 1,
      status: current?.status ?? 'pending',
      externalRef: current?.externalRef ?? bead.externalRef,
      notes: current?.notes ?? '',
      iteration: current?.iteration ?? 1,
      createdAt: current?.createdAt ?? now,
      updatedAt: current?.updatedAt ?? (current ? current.updatedAt : now),
      completedAt: current?.completedAt ?? '',
      startedAt: current?.startedAt ?? '',
      beadStartCommit: current?.beadStartCommit ?? null,
      dependencies: {
        blocked_by: [...bead.dependencies.blocked_by],
        blocks: [],
      },
    } satisfies Bead
  })

  const blocksById = new Map(hydrated.map((bead) => [bead.id, [] as string[]] as const))
  for (const bead of hydrated) {
    for (const dependencyId of bead.dependencies.blocked_by) {
      blocksById.set(dependencyId, [...(blocksById.get(dependencyId) ?? []), bead.id])
    }
  }

  return hydrated.map((bead) => ({
    ...bead,
    dependencies: {
      blocked_by: [...bead.dependencies.blocked_by],
      blocks: [...(blocksById.get(bead.id) ?? [])],
    },
  }))
}

function buildBeadLookup(beads: Bead[]) {
  return new Map(
    beads
      .filter((bead) => bead.id.trim() && bead.title.trim())
      .map((bead) => [bead.id, bead] as const),
  )
}

function parseGapResolutions(
  parsed: Record<string, unknown>,
  coverageGaps: string[],
  currentCandidateBeads: Bead[],
  revisedBeads: Bead[],
): {
  gapResolutions: BeadsCoverageGapResolution[]
  repairWarnings: string[]
} {
  const rawGapResolutions = getValueByAliases(parsed, ['gap_resolutions', 'gapresolutions'])
  if (!Array.isArray(rawGapResolutions)) {
    throw new Error('Beads coverage revision output must include a top-level gap_resolutions list')
  }

  const repairWarnings: string[] = []
  const priorLookup = buildBeadLookup(currentCandidateBeads)
  const revisedLookup = buildBeadLookup(revisedBeads)
  const resolutions: BeadsCoverageGapResolution[] = []

  for (const [index, value] of rawGapResolutions.entries()) {
    if (!isRecord(value)) {
      throw new Error(`Beads coverage gap_resolutions entry at index ${index} is not an object`)
    }

    const gap = typeof getValueByAliases(value, ['gap']) === 'string'
      ? String(getValueByAliases(value, ['gap'])).trim()
      : ''
    if (!gap) {
      throw new Error(`Beads coverage gap_resolutions entry at index ${index} is missing gap`)
    }

    const rawAction = typeof getValueByAliases(value, ['action']) === 'string'
      ? String(getValueByAliases(value, ['action'])).trim()
      : ''
    const normalizedAction = normalizeKey(rawAction)
    let action: BeadsCoverageGapResolutionAction | null = null
    if (normalizedAction === 'updatedbeads' || normalizedAction === 'updatedplan') action = 'updated_beads'
    if (normalizedAction === 'alreadycovered') action = 'already_covered'
    if (normalizedAction === 'leftunresolved') action = 'left_unresolved'
    if (!action) {
      throw new Error(`Beads coverage gap_resolutions entry for "${gap}" has unsupported action "${rawAction}"`)
    }

    const rationale = typeof getValueByAliases(value, ['rationale']) === 'string'
      ? String(getValueByAliases(value, ['rationale'])).trim()
      : ''
    if (!rationale) {
      throw new Error(`Beads coverage gap_resolutions entry for "${gap}" is missing rationale`)
    }

    const rawAffectedItems = getValueByAliases(value, ['affected_items', 'affecteditems'])
    const affectedItems = Array.isArray(rawAffectedItems)
      ? rawAffectedItems.flatMap((item, itemIndex) => {
          if (!isRecord(item)) {
            throw new Error(`Beads coverage affected_items entry at gap "${gap}" index ${itemIndex} is not an object`)
          }
          const itemType = normalizeKey(String(getValueByAliases(item, ['item_type', 'itemtype']) ?? ''))
          if (itemType !== 'bead') {
            throw new Error(`Beads coverage affected_items entry at gap "${gap}" index ${itemIndex} must use item_type bead`)
          }
          const id = typeof getValueByAliases(item, ['id']) === 'string'
            ? String(getValueByAliases(item, ['id'])).trim()
            : ''
          const label = typeof getValueByAliases(item, ['label', 'title']) === 'string'
            ? String(getValueByAliases(item, ['label', 'title'])).trim()
            : ''
          if (!id || !label) {
            throw new Error(`Beads coverage affected_items entry at gap "${gap}" index ${itemIndex} requires id and label`)
          }

          const canonical = revisedLookup.get(id) ?? priorLookup.get(id)
          if (!canonical) {
            throw new Error(`Beads coverage affected_items entry at gap "${gap}" references unknown bead ${id}`)
          }
          if (canonical.title !== label) {
            repairWarnings.push(`Canonicalized affected_items label for bead ${id} from "${label}" to "${canonical.title}".`)
          }

          return [{
            itemType: 'bead',
            id,
            label: canonical.title,
          } satisfies BeadsCoverageAffectedItem]
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
      throw new Error(`Beads coverage gap_resolutions entry references unknown gap "${resolution.gap}"`)
    }
    if (seen.has(resolution.gap)) {
      throw new Error(`Beads coverage gap_resolutions contains duplicate entry for "${resolution.gap}"`)
    }
    seen.add(resolution.gap)
  }

  const missingGaps = normalizedCoverageGaps.filter((gap) => !seen.has(gap))
  if (missingGaps.length > 0) {
    throw new Error(`Beads coverage gap_resolutions must include exactly one entry per gap. Missing: ${missingGaps.join(' | ')}`)
  }

  return { gapResolutions: resolutions, repairWarnings }
}

export function validateBeadsCoverageRevisionOutput(
  rawContent: string,
  options: {
    currentCandidateContent: string
    coverageGaps: string[]
  },
): ValidatedBeadsCoverageRevision {
  const parsed = parseCoverageRevisionRecord(rawContent)
  const currentCandidateBeads = parseBeadsJsonl(options.currentCandidateContent)
  const rawBeads = getValueByAliases(parsed, ['beads'])
  if (!Array.isArray(rawBeads)) {
    throw new Error('Beads coverage revision output must include a top-level beads list')
  }

  const normalizedRevision = normalizeBeadsJsonlOutput(rawBeads.map((bead) => JSON.stringify(bead)).join('\n'))
  if (!normalizedRevision.ok) {
    throw new Error(normalizedRevision.error)
  }

  const canonicalBeads = canonicalizeRevisedBeads(currentCandidateBeads, normalizedRevision.value)
  const refinedContent = buildJsonl(canonicalBeads)
  const parsedGapResolutions = parseGapResolutions(
    parsed,
    options.coverageGaps,
    currentCandidateBeads,
    canonicalBeads,
  )

  return {
    refinedContent,
    priorCandidateContent: options.currentCandidateContent,
    gapResolutions: parsedGapResolutions.gapResolutions,
    repairApplied: normalizedRevision.repairApplied || parsedGapResolutions.repairWarnings.length > 0,
    repairWarnings: [...normalizedRevision.repairWarnings, ...parsedGapResolutions.repairWarnings],
  }
}

export function buildBeadsCoverageRevisionArtifact(
  winnerId: string,
  candidateVersion: number,
  revision: ValidatedBeadsCoverageRevision,
  structuredOutput?: StructuredOutputMetadata,
  prdContent?: string,
): BeadsCoverageRevisionArtifact {
  const normalizedWinnerId = winnerId.trim()
  if (!normalizedWinnerId) {
    throw new Error('Beads coverage revision artifact is missing winnerId')
  }

  const uiRefinementDiff = buildBeadsUiRefinementDiffArtifact({
    winnerId: normalizedWinnerId,
    winnerDraftContent: revision.priorCandidateContent,
    refinedContent: revision.refinedContent,
    prdContent,
  })

  return {
    winnerId: normalizedWinnerId,
    refinedContent: revision.refinedContent,
    winnerDraftContent: revision.priorCandidateContent,
    gapResolutions: revision.gapResolutions,
    candidateVersion,
    ...(structuredOutput ? { structuredOutput } : {}),
    uiRefinementDiff,
  }
}

function stripLegacyTopLevelKeysFromYaml(rawResponse: string): string {
  const candidates = [rawResponse.trim()]
  for (const candidate of candidates) {
    try {
      const parsed = parseCoverageRevisionRecord(candidate)
      delete parsed.gap_resolutions
      delete parsed.gapResolutions
      return JSON.stringify(parsed, null, 2)
    } catch {
      // fall through to regex cleanup
    }
  }

  return rawResponse.trim()
    .replace(/\ngap_resolutions:\n(?: {2,}.*\n?)*/u, '')
    .trim()
}

export function buildBeadsCoverageRevisionRetryPrompt(
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
        '## Beads Coverage Resolution Structured Output Retry',
        `Your previous response failed validation: ${params.validationError}`,
        '',
        'Return only one corrected YAML artifact.',
        'Requirements:',
        '- Use a top-level `beads` list of full execution-ready bead records.',
        '- Include a top-level `gap_resolutions` list with exactly one entry per provided coverage gap.',
        '- Preserve existing bead order and IDs unless a provided gap requires a concrete change.',
        '- Use `affected_items` only for bead references. Leave it empty when no bead mapping applies.',
        '',
        'Previous invalid response:',
        '```yaml',
        sanitizedRawResponse || '[empty response]',
        '```',
      ].join('\n'),
    },
  ]
}
