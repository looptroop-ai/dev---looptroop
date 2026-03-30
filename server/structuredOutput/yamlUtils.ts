import jsYaml from 'js-yaml'
import type { PromptPart } from '../opencode/types'
import { repairYamlDuplicateKeys, repairYamlFreeTextScalars, repairYamlIndentation, repairYamlInlineKeys, repairYamlListDashSpace, repairYamlNestedMappingChildren, repairYamlPlainScalarColons, repairYamlSequenceEntryIndent, repairYamlTypeUnionScalars, repairYamlUnclosedQuotes, stripCodeFences } from '@shared/yamlRepair'

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

interface ParseYamlOrJsonCandidateOptions {
  nestedMappingChildren?: Record<string, readonly string[]>
  allowTrailingTerminalNoise?: boolean
  repairWarnings?: string[]
}

const TERMINAL_NOISE_WARNING = 'Trimmed trailing terminal noise after the complete structured artifact.'
const ORPHAN_CLOSING_CODE_FENCE_WARNING = 'Trimmed orphan trailing closing code fence after the structured artifact.'
const CANDIDATE_RECOVERY_WARNING = 'Recovered the structured artifact from surrounding transcript or wrapper text before validation.'

function isControlNoiseChar(code: number) {
  return (code >= 0 && code <= 8)
    || code === 11
    || code === 12
    || (code >= 14 && code <= 31)
    || code === 127
}

function readAnsiEscapeSequence(text: string, start: number): number | null {
  if (text.charCodeAt(start) !== 27 || text[start + 1] !== '[') return null
  let cursor = start + 2
  while (cursor < text.length) {
    const code = text.charCodeAt(cursor)
    if (code >= 0x40 && code <= 0x7e) {
      return cursor + 1
    }
    if (!((code >= 0x20 && code <= 0x2f) || (code >= 0x30 && code <= 0x3f))) {
      return null
    }
    cursor += 1
  }
  return null
}

function readBracketedPasteSequence(text: string, start: number): number | null {
  if (text[start] !== '[') return null

  for (const token of ['200', '201']) {
    const prefix = `[${token}~`
    if (text.startsWith(prefix, start)) {
      const end = start + prefix.length
      return text[end] === '[' ? end + 1 : end
    }
  }

  const marker = text[start + 1]
  if (!marker || !/[A-Za-z]/.test(marker)) return null
  if (text[start + 2] !== '~') return null

  const end = start + 3
  return text[end] === '[' ? end + 1 : end
}

function isTerminalNoiseText(text: string): boolean {
  if (!text) return false

  let cursor = 0
  while (cursor < text.length) {
    const escapeEnd = readAnsiEscapeSequence(text, cursor)
    if (escapeEnd !== null) {
      cursor = escapeEnd
      continue
    }

    if (readBracketedPasteSequence(text, cursor) !== null) {
      const bracketEnd = readBracketedPasteSequence(text, cursor)!
      cursor = bracketEnd
      continue
    }

    if (isControlNoiseChar(text.charCodeAt(cursor))) {
      cursor += 1
      continue
    }

    if (!/\s/.test(text[cursor] ?? '')) {
      return false
    }
    cursor += 1
  }

  return true
}

function findBalancedJsonRootEnd(content: string): number | null {
  let index = 0
  while (index < content.length && /\s/.test(content[index] ?? '')) {
    index += 1
  }

  if (index >= content.length) return null

  const start = content[index]!
  if (start === '{' || start === '[') {
    let depth = 0
    let inString = false
    let escaped = false

    for (let cursor = index; cursor < content.length; cursor += 1) {
      const char = content[cursor]!
      if (inString) {
        if (escaped) {
          escaped = false
          continue
        }
        if (char === '\\') {
          escaped = true
          continue
        }
        if (char === '"') {
          inString = false
        }
        continue
      }

      if (char === '"') {
        inString = true
        continue
      }
      if (char === '{' || char === '[') {
        depth += 1
        continue
      }
      if (char === '}' || char === ']') {
        depth -= 1
        if (depth === 0) {
          return cursor + 1
        }
      }
    }
    return null
  }

  if (start === '"') {
    let escaped = false
    for (let cursor = index + 1; cursor < content.length; cursor += 1) {
      const char = content[cursor]!
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === '"') {
        return cursor + 1
      }
    }
    return null
  }

  const primitiveMatch = content.slice(index).match(/^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/)
  if (!primitiveMatch?.[0]) return null
  return index + primitiveMatch[0].length
}

function stripTrailingTerminalNoiseFromBalancedJson(content: string): string | null {
  const rootEnd = findBalancedJsonRootEnd(content)
  if (rootEnd === null || rootEnd >= content.length) return null

  const remainder = content.slice(rootEnd)
  if (!isTerminalNoiseText(remainder)) return null

  return content.slice(0, rootEnd).trimEnd()
}

function stripTrailingTerminalNoiseLines(content: string): string | null {
  const lines = content.split('\n')
  let end = lines.length

  while (end > 0 && lines[end - 1]?.trim() === '') {
    end -= 1
  }

  let cursor = end
  while (cursor > 0) {
    const trimmed = lines[cursor - 1]?.trim() ?? ''
    if (!trimmed || !isTerminalNoiseText(trimmed)) {
      break
    }
    cursor -= 1
  }

  if (cursor === end) return null

  const stripped = lines.slice(0, cursor).join('\n').trimEnd()
  return stripped || null
}

function stripTrailingInlineTerminalNoise(content: string): string | null {
  for (let start = content.length - 1; start >= 0; start -= 1) {
    const code = content.charCodeAt(start)
    if (!isControlNoiseChar(code) && code !== 27 && content[start] !== '[') continue

    const suffix = content.slice(start)
    if (!isTerminalNoiseText(suffix)) continue

    const stripped = content.slice(0, start).trimEnd()
    if (!stripped) continue

    const lastChar = stripped[stripped.length - 1]
    if (!lastChar || !/["'}\]\w.-]/.test(lastChar)) continue

    return stripped
  }

  return null
}

function buildTrailingTerminalNoiseVariants(content: string): string[] {
  const variants: string[] = []
  const seen = new Set<string>()

  const addVariant = (value: string | null) => {
    const normalized = value?.trim()
    if (!normalized || normalized === content || seen.has(normalized)) return
    seen.add(normalized)
    variants.push(normalized)
  }

  addVariant(stripTrailingTerminalNoiseFromBalancedJson(content))
  addVariant(stripTrailingInlineTerminalNoise(content))
  addVariant(stripTrailingTerminalNoiseLines(content))

  return variants
}

function stripTrailingClosingCodeFenceLine(content: string): string | null {
  const lines = content.split('\n')
  let end = lines.length

  while (end > 0 && lines[end - 1]?.trim() === '') {
    end -= 1
  }

  if (end === 0) return null

  const lastLine = lines[end - 1]?.trim() ?? ''
  if (!/^```$/.test(lastLine)) return null

  for (let index = 0; index < end - 1; index += 1) {
    if (/^```(?:yaml|yml|json|jsonl)?\s*$/i.test(lines[index]?.trim() ?? '')) {
      return null
    }
  }

  const stripped = lines.slice(0, end - 1).join('\n').trimEnd()
  return stripped || null
}

export function parseYamlOrJsonCandidate(
  content: string,
  options?: ParseYamlOrJsonCandidateOptions,
): unknown {
  const applyNestedMappingRepair = (value: string): string => options?.nestedMappingChildren
    ? repairYamlNestedMappingChildren(value, options.nestedMappingChildren)
    : value
  const trimmed = content.trim()
  if (!trimmed) return null

  const tryParseCandidate = (candidate: string, allowTrailingNoiseVariants = true): unknown => {
    try {
      return JSON.parse(candidate)
    } catch {
      if (allowTrailingNoiseVariants && options?.allowTrailingTerminalNoise) {
        for (const variant of buildTrailingTerminalNoiseVariants(candidate)) {
          try {
            const parsed = tryParseCandidate(variant, false)
            options.repairWarnings?.push(TERMINAL_NOISE_WARNING)
            return parsed
          } catch { /* try the next stripped-noise variant */ }
        }
      }

      const repairedTrimmed = applyNestedMappingRepair(candidate)
      if (repairedTrimmed !== candidate) {
        try {
          return jsYaml.load(repairedTrimmed)
        } catch { /* fall through to the original input and later repairs */ }
      }

      try {
        return jsYaml.load(candidate)
      } catch {
        // First repair: strip markdown code fences if present
        const defenced = stripCodeFences(candidate)
        const effectiveBase = defenced !== candidate ? defenced.trim() : candidate

        if (effectiveBase !== candidate) {
          try {
            return tryParseCandidate(effectiveBase, allowTrailingNoiseVariants)
          } catch { /* fall through to further repairs */ }
        }

        // Earliest repair: split inline keys onto separate lines (prerequisite for all other repairs)
        const inlineRepaired = repairYamlInlineKeys(effectiveBase)
        if (inlineRepaired !== effectiveBase) {
          const nestedInlineRepaired = applyNestedMappingRepair(inlineRepaired)
          if (nestedInlineRepaired !== inlineRepaired) {
            try {
              return jsYaml.load(nestedInlineRepaired)
            } catch { /* fall through — later repairs may still be needed */ }
          }
          try {
            return jsYaml.load(inlineRepaired)
          } catch { /* fall through — lines split but further repairs may be needed */ }
        }
        const afterInline = inlineRepaired !== effectiveBase ? inlineRepaired : effectiveBase

        // Pre-processing: strip XML tags, quote fragile free_text values, remove duplicate keys, fix missing list-dash space
        const xmlStripped = stripSpuriousXmlTags(afterInline)
        const freeTextQuoted = repairYamlFreeTextScalars(xmlStripped)
        const dashFixed = repairYamlListDashSpace(freeTextQuoted)
        const deduped = repairYamlDuplicateKeys(dashFixed)
        const base = applyNestedMappingRepair(deduped)

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

        const unionRepaired = repairYamlTypeUnionScalars(base)
        if (unionRepaired !== base) {
          try {
            return jsYaml.load(unionRepaired)
          } catch {
            try {
              return jsYaml.load(repairYamlIndentation(unionRepaired))
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

  const orphanClosingFenceStripped = stripTrailingClosingCodeFenceLine(trimmed)
  const variants = orphanClosingFenceStripped ? [trimmed, orphanClosingFenceStripped] : [trimmed]
  let lastError: unknown = null

  for (let index = 0; index < variants.length; index += 1) {
    try {
      const parsed = tryParseCandidate(variants[index]!)
      if (index > 0) {
        options?.repairWarnings?.push(ORPHAN_CLOSING_CODE_FENCE_WARNING)
      }
      return parsed
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to parse structured artifact candidate')
}

export function appendStructuredCandidateRecoveryWarning(
  repairWarnings: string[],
  rawContent: string,
  candidate: string,
) {
  if (candidate !== rawContent.trim() && !repairWarnings.includes(CANDIDATE_RECOVERY_WARNING)) {
    repairWarnings.push(CANDIDATE_RECOVERY_WARNING)
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
  const normalizeEntry = (entry: unknown): string => {
    if (entry instanceof Date) return entry.toISOString()
    if (typeof entry === 'string') return entry.trim()
    if (entry === null || entry === undefined) return ''
    if (typeof entry === 'object') {
      return (jsYaml.dump(entry, { lineWidth: 120, noRefs: true }) as string).trim()
    }
    return String(entry).trim()
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeEntry(entry))
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

export function toOrdinalInteger(value: unknown): number | null {
  const direct = toInteger(value)
  if (direct != null) return direct

  const normalized = toOptionalString(value)
  if (!normalized) return null

  const labeledMatch = normalized.match(/(?:^|[^a-z0-9])(?:alternative\s*draft|draft)(?:\s*#?\s*|[^0-9]+)(\d+)(?:$|[^a-z0-9])/i)
  if (labeledMatch?.[1]) {
    const parsed = Number(labeledMatch[1])
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null
  }

  const fallbackMatch = normalized.match(/\b(\d+)\b/)
  if (!fallbackMatch?.[1]) return null
  const parsed = Number(fallbackMatch[1])
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null
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
    doNotUseTools?: boolean
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
        options.doNotUseTools ? 'Do not use tools.' : '',
        options.schemaReminder ? `Schema reminder:\n${options.schemaReminder}` : '',
        'Previous invalid response:',
        '```',
        options.rawResponse.trim() || '[empty response]',
        '```',
      ].filter(Boolean).join('\n\n'),
    },
  ]
}
