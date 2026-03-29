import type { RefinementChange } from '@shared/refinementChanges'
import type { Bead, BeadSubset } from '../phases/beads/types'
import { looksLikePromptEcho } from '../lib/promptEcho'
import type { StructuredOutputResult, RelevantFilesOutputEntry, RelevantFilesOutputPayload } from './types'
import {
  isRecord,
  collectStructuredCandidates,
  collectTaggedCandidates,
  maybeUnwrapRecord,
  parseYamlOrJsonCandidate,
  toStringArray,
  getValueByAliases,
  getRequiredString,
  buildYamlDocument,
  buildJsonlDocument,
} from './yamlUtils'
import { parseRefinementChanges } from './refinementChanges'

export interface BeadDraftMetrics {
  beadCount: number
  totalTestCount: number
  totalAcceptanceCriteriaCount: number
}

function normalizeBeadSubsetEntry(value: unknown, index: number): BeadSubset {
  if (!isRecord(value)) throw new Error(`Bead at index ${index} is not an object`)

  const idValue = getValueByAliases(value, ['id', 'beadid', 'bead_id'])
  const id = typeof idValue === 'string' && idValue.trim()
    ? idValue.trim()
    : `bead-${index + 1}`

  const subset: BeadSubset = {
    id,
    title: getRequiredString(value, ['title', 'name'], `bead title at index ${index}`),
    prdRefs: toStringArray(getValueByAliases(value, ['prdrefs', 'prd_refs', 'prdreferences', 'prd_references'])),
    description: getRequiredString(value, ['description', 'details'], `bead description at index ${index}`),
    contextGuidance: getRequiredString(value, ['contextguidance', 'context_guidance', 'architecturalguidance', 'guidance'], `bead context guidance at index ${index}`),
    acceptanceCriteria: toStringArray(getValueByAliases(value, ['acceptancecriteria', 'acceptance_criteria'])),
    tests: toStringArray(getValueByAliases(value, ['tests', 'testcases', 'test_cases'])),
    testCommands: toStringArray(getValueByAliases(value, ['testcommands', 'test_commands', 'commands'])),
  }

  if (subset.acceptanceCriteria.length === 0) {
    throw new Error(`Bead ${subset.id} is missing acceptance criteria`)
  }
  if (subset.tests.length === 0) {
    throw new Error(`Bead ${subset.id} is missing tests`)
  }
  if (subset.testCommands.length === 0) {
    throw new Error(`Bead ${subset.id} is missing test commands`)
  }

  return subset
}

export function normalizeBeadSubsetYamlOutput(
  rawContent: string,
  losingDraftMeta?: Array<{ memberId: string }>,
): StructuredOutputResult<BeadSubset[] & { changes?: RefinementChange[] }> {
  const repairWarnings: string[] = []
  const candidates = collectStructuredCandidates(rawContent, {
    topLevelHints: ['beads', 'tasks', 'items'],
  })
  let lastError = 'No bead subset content found'

  for (const candidate of candidates) {
    try {
      const rawParsed = parseYamlOrJsonCandidate(candidate)

      // Extract changes before unwrapping (unwrapping would lose the changes key)
      let rawChanges: unknown
      if (isRecord(rawParsed)) {
        rawChanges = getValueByAliases(rawParsed, ['changes'])
        if (rawChanges !== undefined) {
          delete (rawParsed as Record<string, unknown>).changes
        }
      }
      const parsedRefinementChanges = parseRefinementChanges(rawChanges, losingDraftMeta)
      repairWarnings.push(...parsedRefinementChanges.repairWarnings)

      const parsed = maybeUnwrapRecord(rawParsed, [
        'beads',
        'tasks',
        'items',
        'issues',
        'workitems',
        'work_items',
      ])
      const entries = Array.isArray(parsed)
        ? parsed
        : isRecord(parsed)
          ? Array.isArray(getValueByAliases(parsed, ['beads', 'tasks', 'items', 'issues']))
            ? getValueByAliases(parsed, ['beads', 'tasks', 'items', 'issues']) as unknown[]
            : []
          : []

      if (entries.length === 0) {
        throw new Error('Bead subset output is empty')
      }

      const subsets = entries.map((entry, index) => normalizeBeadSubsetEntry(entry, index))

      // Detect and repair duplicate bead IDs
      const seenIds = new Set<string>()
      for (const subset of subsets) {
        if (seenIds.has(subset.id)) {
          const originalId = subset.id
          let counter = 2
          while (seenIds.has(`${originalId}-${counter}`)) counter++
          subset.id = `${originalId}-${counter}`
          repairWarnings.push(`Renumbered duplicate bead id "${originalId}" to "${subset.id}".`)
        }
        seenIds.add(subset.id)
      }

      // Warn about beads with empty prdRefs
      for (const subset of subsets) {
        if (subset.prdRefs.length === 0) {
          repairWarnings.push(`Bead "${subset.id}" has no PRD references (prdRefs is empty).`)
        }
      }

      const normalizedContent = buildYamlDocument({ beads: subsets })
      const valueWithChanges = parsedRefinementChanges.changes.length > 0
        ? Object.assign(subsets, { changes: parsedRefinementChanges.changes })
        : subsets
      return {
        ok: true,
        value: valueWithChanges,
        normalizedContent,
        repairApplied: candidate !== rawContent.trim() || repairWarnings.length > 0,
        repairWarnings,
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    ok: false,
    error: looksLikePromptEcho(rawContent)
      ? 'Bead subset output echoed the prompt instead of returning structured bead YAML'
      : lastError,
    repairApplied: false,
    repairWarnings,
  }
}

function parseJsonLines(content: string): unknown[] {
  const trimmed = content.trim()
  if (!trimmed) return []

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed)
    return Array.isArray(parsed) ? parsed : []
  }

  return trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function normalizeBeadRecord(value: unknown, index: number): Bead {
  if (!isRecord(value)) throw new Error(`Bead JSONL entry at index ${index} is not an object`)

  const dependenciesValue = getValueByAliases(value, ['dependencies'])
  const blockedBy = isRecord(dependenciesValue)
    ? toStringArray(getValueByAliases(dependenciesValue, ['blockedby', 'blocked_by']))
    : toStringArray(dependenciesValue)
  const bead: Bead = {
    id: getRequiredString(value, ['id'], `bead id at index ${index}`),
    title: getRequiredString(value, ['title'], `bead title at index ${index}`),
    prdRefs: toStringArray(getValueByAliases(value, ['prdrefs', 'prd_refs', 'prdreferences', 'prd_references'])),
    description: getRequiredString(value, ['description'], `bead description at index ${index}`),
    contextGuidance: typeof getValueByAliases(value, ['contextguidance', 'context_guidance']) === 'string'
      ? String(getValueByAliases(value, ['contextguidance', 'context_guidance'])).trim()
      : '',
    acceptanceCriteria: toStringArray(getValueByAliases(value, ['acceptancecriteria', 'acceptance_criteria'])),
    tests: toStringArray(getValueByAliases(value, ['tests'])),
    testCommands: toStringArray(getValueByAliases(value, ['testcommands', 'test_commands'])),
    priority: Number(getValueByAliases(value, ['priority']) ?? index + 1),
    status: (typeof getValueByAliases(value, ['status']) === 'string'
      ? String(getValueByAliases(value, ['status'])).trim()
      : 'pending') as Bead['status'],
    labels: toStringArray(getValueByAliases(value, ['labels'])),
    dependencies: [...new Set(blockedBy)],
    targetFiles: toStringArray(getValueByAliases(value, ['targetfiles', 'target_files'])),
    notes: toStringArray(getValueByAliases(value, ['notes'])),
    iteration: Number(getValueByAliases(value, ['iteration']) ?? 1),
    createdAt: typeof getValueByAliases(value, ['createdat', 'created_at']) === 'string'
      ? String(getValueByAliases(value, ['createdat', 'created_at'])).trim()
      : '',
    updatedAt: typeof getValueByAliases(value, ['updatedat', 'updated_at']) === 'string'
      ? String(getValueByAliases(value, ['updatedat', 'updated_at'])).trim()
      : '',
    beadStartCommit: typeof getValueByAliases(value, ['beadstartcommit', 'bead_start_commit']) === 'string'
      ? String(getValueByAliases(value, ['beadstartcommit', 'bead_start_commit'])).trim() || null
      : null,
    estimatedComplexity: (typeof getValueByAliases(value, ['estimatedcomplexity', 'estimated_complexity']) === 'string'
      ? String(getValueByAliases(value, ['estimatedcomplexity', 'estimated_complexity'])).trim()
      : 'moderate') as Bead['estimatedComplexity'],
    epicId: typeof getValueByAliases(value, ['epicid', 'epic_id']) === 'string'
      ? String(getValueByAliases(value, ['epicid', 'epic_id'])).trim()
      : '',
    storyId: typeof getValueByAliases(value, ['storyid', 'story_id']) === 'string'
      ? String(getValueByAliases(value, ['storyid', 'story_id'])).trim()
      : '',
  }

  if (!Number.isInteger(bead.priority) || bead.priority <= 0) {
    throw new Error(`Bead ${bead.id} has invalid priority`)
  }
  if (bead.acceptanceCriteria.length === 0) {
    throw new Error(`Bead ${bead.id} is missing acceptance criteria`)
  }
  if (bead.tests.length === 0) {
    throw new Error(`Bead ${bead.id} is missing tests`)
  }

  return bead
}

export function normalizeBeadsJsonlOutput(rawContent: string): StructuredOutputResult<Bead[]> {
  const repairWarnings: string[] = []
  const candidates = collectStructuredCandidates(rawContent)
  let lastError = 'No beads JSONL content found'

  for (const candidate of candidates) {
    try {
      const parsedEntries = parseJsonLines(candidate)
      if (parsedEntries.length === 0) throw new Error('Beads JSONL output is empty')

      const beads = parsedEntries.map((entry, index) => normalizeBeadRecord(entry, index))
      const beadIds = new Set<string>()
      for (const bead of beads) {
        if (beadIds.has(bead.id)) throw new Error(`Duplicate bead id: ${bead.id}`)
        beadIds.add(bead.id)
        if (bead.dependencies.includes(bead.id)) {
          throw new Error(`Bead ${bead.id} has a self-dependency`)
        }
        for (const dependency of bead.dependencies) {
          if (!beadIds.has(dependency) && !beads.some((candidateBead) => candidateBead.id === dependency)) {
            throw new Error(`Bead ${bead.id} depends on unknown bead ${dependency}`)
          }
        }
      }

      return {
        ok: true,
        value: beads,
        normalizedContent: buildJsonlDocument(beads),
        repairApplied: candidate !== rawContent.trim() || repairWarnings.length > 0,
        repairWarnings,
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    ok: false,
    error: looksLikePromptEcho(rawContent)
      ? 'Beads JSONL output echoed the prompt instead of returning bead records'
      : lastError,
    repairApplied: false,
    repairWarnings,
  }
}

/** Truncate YAML content to only complete file entries when the last entry is incomplete (truncated output) */
function truncateToCompleteFileEntries(content: string): string | null {
  const lines = content.split('\n')
  // Find all `  - path:` item boundaries (list items under files:)
  const itemStarts: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (/^\s+-\s+(path|filepath|file_path|file)\s*:/.test(lines[i]!)) {
      itemStarts.push(i)
    }
  }
  // Need at least 2 items to truncate the last one
  if (itemStarts.length < 2) return null
  // Keep everything up to (but not including) the last item
  const cutoff = itemStarts[itemStarts.length - 1]!
  const truncated = lines.slice(0, cutoff).join('\n').trimEnd()
  return truncated || null
}

export function normalizeRelevantFilesOutput(rawContent: string): StructuredOutputResult<RelevantFilesOutputPayload> {
  const repairWarnings: string[] = []
  const candidates = collectTaggedCandidates(rawContent, 'RELEVANT_FILES_RESULT')

  // Also try structured candidates as fallback
  const fallbackCandidates = collectStructuredCandidates(rawContent, {
    topLevelHints: ['file_count', 'files'],
  })
  const allCandidates = [...candidates, ...fallbackCandidates]
  const seen = new Set<string>()
  const uniqueCandidates = allCandidates.filter((c) => {
    if (seen.has(c)) return false
    seen.add(c)
    return true
  })

  let lastError = 'No relevant files content found'

  for (const candidate of uniqueCandidates) {
    try {
      if (looksLikePromptEcho(candidate)) {
        throw new Error('Relevant files output echoed the prompt instead of returning a <RELEVANT_FILES_RESULT> artifact')
      }

      let yamlParsed: unknown
      try {
        yamlParsed = parseYamlOrJsonCandidate(candidate)
      } catch (parseErr) {
        // Truncation recovery: trim the last incomplete file entry and retry
        const truncated = truncateToCompleteFileEntries(candidate)
        if (truncated) {
          try {
            yamlParsed = parseYamlOrJsonCandidate(truncated)
            repairWarnings.push('Truncated incomplete last file entry to recover from malformed YAML.')
          } catch {
            throw parseErr
          }
        } else {
          throw parseErr
        }
      }

      const parsed = maybeUnwrapRecord(yamlParsed, [
        'relevantfilesresult',
        'relevant_files_result',
        'relevantfiles',
        'relevant_files',
        'payload',
        'result',
        'output',
        'data',
        'artifact',
      ])
      if (!isRecord(parsed)) throw new Error('Relevant files output is not a YAML/JSON object')

      const rawFiles = getValueByAliases(parsed, ['files'])
      if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
        throw new Error('Relevant files output is missing files list')
      }

      const files: RelevantFilesOutputEntry[] = rawFiles.map((entry: unknown, index: number) => {
        if (!isRecord(entry)) throw new Error(`Relevant file at index ${index} is not an object`)

        const path = getRequiredString(entry, ['path', 'filepath', 'file_path', 'file'], `file path at index ${index}`)
        const rationale = typeof getValueByAliases(entry, ['rationale', 'reason', 'why']) === 'string'
          ? String(getValueByAliases(entry, ['rationale', 'reason', 'why'])).trim()
          : ''
        const relevance = typeof getValueByAliases(entry, ['relevance']) === 'string'
          ? String(getValueByAliases(entry, ['relevance'])).trim().toLowerCase()
          : 'medium'
        const likelyAction = typeof getValueByAliases(entry, ['likelyaction', 'likely_action', 'action']) === 'string'
          ? String(getValueByAliases(entry, ['likelyaction', 'likely_action', 'action'])).trim().toLowerCase()
          : 'read'
        const content = typeof getValueByAliases(entry, ['content', 'contents', 'code', 'source', 'snippet', 'excerpt']) === 'string'
          ? String(getValueByAliases(entry, ['content', 'contents', 'code', 'source', 'snippet', 'excerpt']))
          : ''
        const contentPreview = typeof getValueByAliases(entry, ['content_preview', 'contentpreview', 'preview', 'signatures']) === 'string'
          ? String(getValueByAliases(entry, ['content_preview', 'contentpreview', 'preview', 'signatures']))
          : ''

        return { path, rationale, relevance, likely_action: likelyAction, content, content_preview: contentPreview || content }
      })

      const payload: RelevantFilesOutputPayload = {
        file_count: files.length,
        files,
      }

      return {
        ok: true,
        value: payload,
        normalizedContent: buildYamlDocument(payload),
        repairApplied: candidate !== rawContent.trim(),
        repairWarnings,
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    ok: false,
    error: looksLikePromptEcho(rawContent)
      ? 'Relevant files output echoed the prompt instead of returning a <RELEVANT_FILES_RESULT> artifact'
      : lastError,
    repairApplied: false,
    repairWarnings: [],
  }
}
