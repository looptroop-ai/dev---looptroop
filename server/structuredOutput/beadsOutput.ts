import jsYaml from 'js-yaml'
import type { RefinementChange } from '@shared/refinementChanges'
import type { Bead, BeadSubset, BeadContextGuidance, BeadDependencies } from '../phases/beads/types'
import { looksLikePromptEcho } from '../lib/promptEcho'
import type { StructuredOutputResult, RelevantFilesOutputEntry, RelevantFilesOutputPayload } from './types'
import {
  isRecord,
  collectStructuredCandidates,
  collectTaggedCandidates,
  maybeUnwrapRecord,
  appendStructuredCandidateRecoveryWarning,
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

function cleanString(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function normalizeGuidanceItems(value: unknown, label: string): string[] {
  const items = toStringArray(value).map(cleanString).filter(Boolean)
  if (items.length === 0) {
    throw new Error(`Bead context guidance is missing ${label}`)
  }
  return items
}

/** Parse a multi-line string with Patterns: and Anti-patterns: sections into arrays. */
function parseGuidanceStringToObject(guidance: string): { patterns: string[]; anti_patterns: string[] } | null {
  const patternsMatch = guidance.match(/^\s*patterns\s*:\s*\n?([\s\S]*?)(?=^\s*anti[-\s_]*patterns\s*:|$)/im)
  const antiPatternsMatch = guidance.match(/^\s*anti[-\s_]*patterns\s*:\s*\n?([\s\S]*?)$/im)

  if (!patternsMatch && !antiPatternsMatch) return null

  const parseItems = (text: string) =>
    text.split('\n')
      .map(line => line.replace(/^\s*-\s*/, '').trim())
      .filter(Boolean)

  return {
    patterns: patternsMatch?.[1] ? parseItems(patternsMatch[1]) : [],
    anti_patterns: antiPatternsMatch?.[1] ? parseItems(antiPatternsMatch[1]) : [],
  }
}

function normalizeContextGuidance(
  value: unknown,
  index: number,
  repairWarnings: string[],
): BeadContextGuidance {
  if (typeof value === 'string') {
    const guidance = value.trim()
    if (!guidance) {
      throw new Error(`Bead context guidance at index ${index} is empty`)
    }

    const parsed = parseGuidanceStringToObject(guidance)
    if (parsed && parsed.patterns.length > 0 && parsed.anti_patterns.length > 0) {
      repairWarnings.push(`Canonicalized string context guidance at index ${index} into patterns/anti_patterns object.`)
      return parsed
    }

    // Try inline repair: "Patterns: X Anti-patterns: Y"
    const inlineMatch = guidance.match(/^\s*patterns\s*:\s*(.+?)\s+anti[-\s_]*patterns\s*:\s*(.+)\s*$/is)
    if (inlineMatch) {
      const patterns = cleanString(inlineMatch[1] ?? '')
      const antiPatterns = cleanString(inlineMatch[2] ?? '')
      if (patterns && antiPatterns) {
        repairWarnings.push(`Canonicalized inline string context guidance at index ${index} into patterns/anti_patterns object.`)
        return { patterns: [patterns], anti_patterns: [antiPatterns] }
      }
    }

    throw new Error(`Bead context guidance at index ${index} must include both Patterns and Anti-patterns sections`)
  }

  if (!isRecord(value)) {
    throw new Error(`Bead context guidance at index ${index} must be a string or object`)
  }

  const patterns = normalizeGuidanceItems(
    getValueByAliases(value, ['patterns', 'pattern']),
    'patterns',
  )
  const antiPatterns = normalizeGuidanceItems(
    getValueByAliases(value, ['antipatterns', 'anti_patterns', 'anti-patterns', 'anti_patterns_list']),
    'anti-patterns',
  )

  return { patterns, anti_patterns: antiPatterns }
}

function normalizeDependencies(value: unknown): BeadDependencies {
  if (!value) return { blocked_by: [], blocks: [] }

  if (isRecord(value)) {
    return {
      blocked_by: toStringArray(getValueByAliases(value, ['blockedby', 'blocked_by'])),
      blocks: toStringArray(getValueByAliases(value, ['blocks'])),
    }
  }

  // Legacy flat array format — treat as blocked_by
  if (Array.isArray(value)) {
    return {
      blocked_by: toStringArray(value),
      blocks: [],
    }
  }

  return { blocked_by: [], blocks: [] }
}

function normalizeBeadSubsetEntry(value: unknown, index: number, repairWarnings: string[]): BeadSubset {
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
    contextGuidance: normalizeContextGuidance(
      getValueByAliases(value, ['contextguidance', 'context_guidance', 'architecturalguidance', 'guidance']),
      index,
      repairWarnings,
    ),
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

      const subsets = entries.map((entry, index) => normalizeBeadSubsetEntry(entry, index, repairWarnings))

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
        if (subset.contextGuidance.patterns.length === 0 || subset.contextGuidance.anti_patterns.length === 0) {
          throw new Error(`Bead "${subset.id}" contextGuidance must include both patterns and anti_patterns`)
        }
      }

      const normalizedContent = buildYamlDocument({ beads: subsets })
      const valueWithChanges = parsedRefinementChanges.changes.length > 0
        ? Object.assign(subsets, { changes: parsedRefinementChanges.changes })
        : subsets
      appendStructuredCandidateRecoveryWarning(repairWarnings, rawContent, candidate)
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

function normalizeNotesField(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.filter(item => typeof item === 'string').join('\n')
  return ''
}

function normalizeBeadRecord(value: unknown, index: number, repairWarnings: string[]): Bead {
  if (!isRecord(value)) throw new Error(`Bead JSONL entry at index ${index} is not an object`)

  const dependencies = normalizeDependencies(getValueByAliases(value, ['dependencies']))

  const normalizedGuidance = normalizeContextGuidance(
    getValueByAliases(value, ['contextguidance', 'context_guidance']),
    index,
    repairWarnings,
  )

  const rawStatus = typeof getValueByAliases(value, ['status']) === 'string'
    ? String(getValueByAliases(value, ['status'])).trim()
    : 'pending'
  // Map legacy status values to architecture spec
  const status = (rawStatus === 'completed' ? 'done'
    : rawStatus === 'failed' ? 'error'
    : rawStatus === 'skipped' ? 'done'
    : rawStatus) as Bead['status']

  const bead: Bead = {
    id: getRequiredString(value, ['id'], `bead id at index ${index}`),
    title: getRequiredString(value, ['title'], `bead title at index ${index}`),
    prdRefs: toStringArray(getValueByAliases(value, ['prdrefs', 'prd_refs', 'prdreferences', 'prd_references'])),
    description: getRequiredString(value, ['description'], `bead description at index ${index}`),
    contextGuidance: normalizedGuidance,
    acceptanceCriteria: toStringArray(getValueByAliases(value, ['acceptancecriteria', 'acceptance_criteria'])),
    tests: toStringArray(getValueByAliases(value, ['tests'])),
    testCommands: toStringArray(getValueByAliases(value, ['testcommands', 'test_commands'])),
    priority: Number(getValueByAliases(value, ['priority']) ?? index + 1),
    status,
    issueType: typeof getValueByAliases(value, ['issuetype', 'issue_type']) === 'string'
      ? String(getValueByAliases(value, ['issuetype', 'issue_type'])).trim()
      : 'task',
    externalRef: typeof getValueByAliases(value, ['externalref', 'external_ref']) === 'string'
      ? String(getValueByAliases(value, ['externalref', 'external_ref'])).trim()
      : '',
    labels: toStringArray(getValueByAliases(value, ['labels'])),
    dependencies,
    targetFiles: toStringArray(getValueByAliases(value, ['targetfiles', 'target_files'])),
    notes: normalizeNotesField(getValueByAliases(value, ['notes'])),
    iteration: Number(getValueByAliases(value, ['iteration']) ?? 1),
    createdAt: typeof getValueByAliases(value, ['createdat', 'created_at']) === 'string'
      ? String(getValueByAliases(value, ['createdat', 'created_at'])).trim()
      : '',
    updatedAt: typeof getValueByAliases(value, ['updatedat', 'updated_at']) === 'string'
      ? String(getValueByAliases(value, ['updatedat', 'updated_at'])).trim()
      : '',
    completedAt: typeof getValueByAliases(value, ['completedat', 'completed_at']) === 'string'
      ? String(getValueByAliases(value, ['completedat', 'completed_at'])).trim()
      : '',
    startedAt: typeof getValueByAliases(value, ['startedat', 'started_at']) === 'string'
      ? String(getValueByAliases(value, ['startedat', 'started_at'])).trim()
      : '',
    beadStartCommit: typeof getValueByAliases(value, ['beadstartcommit', 'bead_start_commit']) === 'string'
      ? String(getValueByAliases(value, ['beadstartcommit', 'bead_start_commit'])).trim() || null
      : null,
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

      const beads = parsedEntries.map((entry, index) => normalizeBeadRecord(entry, index, repairWarnings))
      const beadIds = new Set<string>()
      for (const bead of beads) {
        if (beadIds.has(bead.id)) throw new Error(`Duplicate bead id: ${bead.id}`)
        beadIds.add(bead.id)
        if (bead.dependencies.blocked_by.includes(bead.id) || bead.dependencies.blocks.includes(bead.id)) {
          throw new Error(`Bead ${bead.id} has a self-dependency`)
        }
        for (const dependency of bead.dependencies.blocked_by) {
          if (!beadIds.has(dependency) && !beads.some((candidateBead) => candidateBead.id === dependency)) {
            throw new Error(`Bead ${bead.id} depends on unknown bead ${dependency}`)
          }
        }
      }

      for (const bead of beads) {
        if (bead.contextGuidance.patterns.length === 0 || bead.contextGuidance.anti_patterns.length === 0) {
          throw new Error(`Bead ${bead.id} contextGuidance must include both patterns and anti_patterns`)
        }
      }
      appendStructuredCandidateRecoveryWarning(repairWarnings, rawContent, candidate)

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

function isExactTaggedRelevantFilesEnvelope(rawContent: string, candidate: string): boolean {
  const trimmed = rawContent.trim()
  const match = trimmed.match(/^<RELEVANT_FILES_RESULT>\s*([\s\S]*?)\s*<\/RELEVANT_FILES_RESULT>$/)
  if (!match) return false

  return (match[1] ?? '').trim() === candidate.trim()
}

function parsesAsPlainYamlOrJson(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed) return false

  try {
    JSON.parse(trimmed)
    return true
  } catch {
    try {
      jsYaml.load(trimmed)
      return true
    } catch {
      return false
    }
  }
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
      appendStructuredCandidateRecoveryWarning(repairWarnings, rawContent, candidate)

      return {
        ok: true,
        value: payload,
        normalizedContent: buildYamlDocument(payload),
        repairApplied: repairWarnings.length > 0 || (
          !parsesAsPlainYamlOrJson(candidate)
          || (candidate !== rawContent.trim() && !isExactTaggedRelevantFilesEnvelope(rawContent, candidate))
        ),
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
