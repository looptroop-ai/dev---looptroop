import jsYaml from 'js-yaml'
import type { PromptPart } from '../opencode/types'
import { repairYamlDuplicateKeys, repairYamlFreeTextScalars, repairYamlIndentation, repairYamlInlineKeys, repairYamlListDashSpace, repairYamlPlainScalarColons, repairYamlSequenceEntryIndent, repairYamlUnclosedQuotes, stripCodeFences } from '@shared/yamlRepair'

const TRANSCRIPT_PREFIX_PATTERN = /^\s*\[(?:assistant|user|system|sys|tool|model|error)(?:\/[^\]]+)?\](?:\s*\[[^\]]+\])?\s*/i

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function stripTranscriptPrefixes(content: string): string {
  return content
    .split('\n')
    .map((line) => line.replace(TRANSCRIPT_PREFIX_PATTERN, ''))
    .join('\n')
    .trim()
}

export function addCandidate(target: string[], seen: Set<string>, value: string | null | undefined) {
  const normalized = value?.trim()
  if (!normalized || seen.has(normalized)) return
  seen.add(normalized)
  target.push(normalized)
}

export function collectStructuredCandidates(
  rawContent: string,
  options?: {
    tags?: string[]
    topLevelHints?: string[]
  },
): string[] {
  const raw = rawContent.trim()
  const stripped = stripTranscriptPrefixes(raw)
  const candidates: string[] = []
  const seen = new Set<string>()

  addCandidate(candidates, seen, raw)
  addCandidate(candidates, seen, stripped)

  for (const source of [raw, stripped]) {
    for (const match of source.matchAll(/```(?:yaml|yml|json|jsonl)?\s*([\s\S]*?)\s*```/gi)) {
      addCandidate(candidates, seen, stripTranscriptPrefixes(match[1] ?? ''))
      addCandidate(candidates, seen, match[1] ?? '')
    }

    for (const tag of options?.tags ?? []) {
      const tagPattern = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'gi')
      for (const match of source.matchAll(tagPattern)) {
        addCandidate(candidates, seen, stripTranscriptPrefixes(match[1] ?? ''))
        addCandidate(candidates, seen, match[1] ?? '')
      }
    }

    if (options?.topLevelHints?.length) {
      const lines = source.split('\n')
      const index = lines.findIndex((line) => {
        const trimmed = line.trim().toLowerCase()
        return options.topLevelHints!.some((hint) => trimmed.startsWith(`${hint.toLowerCase()}:`))
      })
      if (index >= 0) {
        addCandidate(candidates, seen, lines.slice(index).join('\n'))
      }
    }
  }

  return candidates
}

export function collectTaggedCandidates(rawContent: string, tag: string): string[] {
  const raw = rawContent.trim()
  const stripped = stripTranscriptPrefixes(raw)
  const candidates: string[] = []
  const seen = new Set<string>()
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'gi')

  for (const source of [raw, stripped]) {
    for (const match of source.matchAll(pattern)) {
      const inner = match[1] ?? ''
      addCandidate(candidates, seen, inner)
      addCandidate(candidates, seen, stripTranscriptPrefixes(inner))
      for (const nested of collectStructuredCandidates(inner)) {
        addCandidate(candidates, seen, nested)
      }
    }
  }

  // Fallback: if there's an opening tag but no closing tag (truncated output),
  // extract everything after the last opening tag as a candidate
  if (candidates.length === 0) {
    const openPattern = new RegExp(`<${tag}>`, 'gi')
    for (const source of [raw, stripped]) {
      const openMatches = [...source.matchAll(openPattern)]
      if (openMatches.length > 0) {
        const lastOpen = openMatches[openMatches.length - 1]!
        const afterTag = source.slice(lastOpen.index! + lastOpen[0].length)
        addCandidate(candidates, seen, afterTag)
        addCandidate(candidates, seen, stripTranscriptPrefixes(afterTag))
        for (const nested of collectStructuredCandidates(afterTag)) {
          addCandidate(candidates, seen, nested)
        }
      }
    }
  }

  return candidates
}

/** Remove lines that are purely an XML tag — safe because real YAML string values won't be on a line alone as a bare tag */
export function stripSpuriousXmlTags(content: string): string {
  return content
    .split('\n')
    .filter((line) => !/^\s*<\/?[a-zA-Z_][a-zA-Z0-9_-]*\s*\/?\s*>\s*$/.test(line))
    .join('\n')
}

export function parseYamlOrJsonCandidate(content: string): unknown {
  const trimmed = content.trim()
  if (!trimmed) return null

  try {
    return JSON.parse(trimmed)
  } catch {
    try {
      return jsYaml.load(trimmed)
    } catch {
      // First repair: strip markdown code fences if present
      const defenced = stripCodeFences(trimmed)
      const effectiveBase = defenced !== trimmed ? defenced.trim() : trimmed

      if (effectiveBase !== trimmed) {
        try {
          return JSON.parse(effectiveBase)
        } catch {
          try {
            return jsYaml.load(effectiveBase)
          } catch { /* fall through to further repairs */ }
        }
      }

      // Earliest repair: split inline keys onto separate lines (prerequisite for all other repairs)
      const inlineRepaired = repairYamlInlineKeys(effectiveBase)
      if (inlineRepaired !== effectiveBase) {
        try {
          return jsYaml.load(inlineRepaired)
        } catch { /* fall through — lines split but further repairs may be needed */ }
      }
      const afterInline = inlineRepaired !== effectiveBase ? inlineRepaired : effectiveBase

      // Pre-processing: strip XML tags, quote fragile free_text values, remove duplicate keys, fix missing list-dash space
      const xmlStripped = stripSpuriousXmlTags(afterInline)
      const freeTextQuoted = repairYamlFreeTextScalars(xmlStripped)
      const dashFixed = repairYamlListDashSpace(freeTextQuoted)
      const base = repairYamlDuplicateKeys(dashFixed)

      // Pre-processing alone might fix it (e.g. duplicate keys or missing dash space were the only issue)
      if (base !== afterInline) {
        try {
          return jsYaml.load(base)
        } catch { /* fall through to targeted repairs */ }
      }

      // Try unclosed-quote repair
      const quoteRepaired = repairYamlUnclosedQuotes(base)
      if (quoteRepaired !== base) {
        try {
          return jsYaml.load(quoteRepaired)
        } catch {
          // Try combined: unclosed-quote + indentation repair
          try {
            return jsYaml.load(repairYamlIndentation(quoteRepaired))
          } catch { /* fall through */ }
        }
      }

      // Try colon-in-scalar repair (most targeted fix)
      const colonRepaired = repairYamlPlainScalarColons(base)
      if (colonRepaired !== base) {
        try {
          return jsYaml.load(colonRepaired)
        } catch {
          // Try combined: colon repair + indentation repair
          try {
            return jsYaml.load(repairYamlIndentation(colonRepaired))
          } catch { /* fall through */ }
        }
      }

      // Try sequence-entry indent repair (fixes dashes drifted after block scalars)
      const seqRepaired = repairYamlSequenceEntryIndent(base)
      if (seqRepaired !== base) {
        try {
          return jsYaml.load(seqRepaired)
        } catch {
          // Try combined: sequence entry + property indentation repair
          try {
            return jsYaml.load(repairYamlIndentation(seqRepaired))
          } catch { /* fall through */ }
        }
      }

      const repaired = repairYamlIndentation(repairYamlUnclosedQuotes(base))
      return jsYaml.load(repaired)
    }
  }
}

function quoteYamlDoubleQuotedScalar(value: string): string {
  return JSON.stringify(value)
}

export function repairCoverageGapStringList(content: string): {
  content: string
  repairApplied: boolean
  repairWarnings: string[]
} {
  const lines = content.split('\n')
  const repairedLines: string[] = []
  const topLevelKeyPattern = /^[A-Za-z_][A-Za-z0-9_-]*\s*:/
  let activeGapIndent = -1
  let directItemIndent = -1
  let repairApplied = false

  for (const line of lines) {
    const trimmed = line.trim()
    const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0

    if (activeGapIndent >= 0) {
      if (trimmed && !trimmed.startsWith('#') && indent <= activeGapIndent && topLevelKeyPattern.test(trimmed)) {
        activeGapIndent = -1
        directItemIndent = -1
      } else {
        if (indent === directItemIndent && trimmed.startsWith('- ')) {
          const itemValue = trimmed.slice(2).trim()
          if (itemValue && !/^(["']|[>|])/.test(itemValue)) {
            const repairedLine = `${' '.repeat(directItemIndent)}- ${quoteYamlDoubleQuotedScalar(itemValue)}`
            repairedLines.push(repairedLine)
            repairApplied = repairApplied || repairedLine !== line
            continue
          }
        }

        repairedLines.push(line)
        continue
      }
    }

    const gapBlockMatch = line.match(/^(\s*)(gaps|issues)\s*:\s*$/)
    if (gapBlockMatch) {
      activeGapIndent = gapBlockMatch[1]?.length ?? 0
      directItemIndent = activeGapIndent + 2
    }

    repairedLines.push(line)
  }

  return {
    content: repairedLines.join('\n'),
    repairApplied,
    repairWarnings: repairApplied
      ? ['Quoted coverage gap strings to recover malformed YAML scalars.']
      : [],
  }
}

export function maybeUnwrapRecord(
  value: unknown,
  preferredKeys: string[],
  depth: number = 0,
): unknown {
  if (!isRecord(value) || depth > 4) return value

  for (const [key, nested] of Object.entries(value)) {
    if (!preferredKeys.includes(normalizeKey(key))) continue
    return maybeUnwrapRecord(nested, preferredKeys, depth + 1)
  }

  const keys = Object.keys(value)
  if (keys.length === 1) {
    return maybeUnwrapRecord(value[keys[0]!], preferredKeys, depth + 1)
  }

  return value
}

export function unwrapExplicitWrapperRecord(
  value: unknown,
  preferredKeys: string[],
  depth: number = 0,
): unknown {
  if (!isRecord(value) || depth > 4) return value

  for (const [key, nested] of Object.entries(value)) {
    if (!preferredKeys.includes(normalizeKey(key))) continue
    return unwrapExplicitWrapperRecord(nested, preferredKeys, depth + 1)
  }

  return value
}

export function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => typeof entry === 'string' ? entry.trim() : String(entry ?? '').trim())
      .filter((entry) => entry.length > 0)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    if (trimmed.includes('\n')) {
      return trimmed
        .split('\n')
        .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
        .filter(Boolean)
    }
    return [trimmed]
  }
  return []
}

export function toOptionalString(value: unknown): string | undefined {
  const normalized = value instanceof Date
    ? value.toISOString()
    : typeof value === 'string'
      ? value
      : undefined
  if (typeof normalized !== 'string') return undefined
  const trimmed = normalized.trim()
  return trimmed || undefined
}

export function toInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null
  }
  return null
}

export function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null
  if (typeof value !== 'string') return null
  const normalized = normalizeKey(value)
  if (['true', 'yes', 'y', '1'].includes(normalized)) return true
  if (['false', 'no', 'n', '0'].includes(normalized)) return false
  return null
}

export function getValueByAliases(record: Record<string, unknown>, aliases: string[]): unknown {
  for (const [key, value] of Object.entries(record)) {
    if (aliases.includes(normalizeKey(key))) return value
  }
  return undefined
}

export function getNestedRecord(record: Record<string, unknown>, aliases: string[]): Record<string, unknown> {
  const value = getValueByAliases(record, aliases)
  return isRecord(value) ? value : {}
}

export function getRequiredString(record: Record<string, unknown>, aliases: string[], label: string): string {
  const value = getValueByAliases(record, aliases)
  const normalized = value instanceof Date
    ? value.toISOString()
    : typeof value === 'string'
      ? value
      : null
  if (!normalized || !normalized.trim()) {
    throw new Error(`Missing required ${label}`)
  }
  return normalized.trim()
}

export function buildYamlDocument(value: unknown): string {
  return jsYaml.dump(value, { lineWidth: 120, noRefs: true }) as string
}

export function buildJsonlDocument(records: object[]): string {
  return records.map((record) => JSON.stringify(record)).join('\n')
}

export function buildStructuredRetryPrompt(
  baseParts: PromptPart[],
  options: {
    validationError: string
    rawResponse: string
    schemaReminder?: string
  },
): PromptPart[] {
  return [
    ...baseParts,
    {
      type: 'text',
      content: [
        '## Structured Output Retry',
        `Your previous response failed machine validation: ${options.validationError}`,
        'Return only a corrected artifact in the required structured format.',
        options.schemaReminder ? `Schema reminder:\n${options.schemaReminder}` : '',
        'Previous invalid response:',
        '```',
        options.rawResponse.trim() || '[empty response]',
        '```',
      ].filter(Boolean).join('\n\n'),
    },
  ]
}
