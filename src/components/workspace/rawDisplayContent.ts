function formatReadableRawKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? key : JSON.stringify(key)
}

function formatReadableRawScalar(value: string | number | boolean | null): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value)
}

const EMBEDDED_YAML_ARTIFACT_KEYS = new Set([
  'beads',
  'beadsContent',
  'candidateContent',
  'content',
  'coverageBaselineContent',
  'coverageReviewContent',
  'draftContent',
  'fromContent',
  'fullAnswers',
  'interview',
  'interviewContent',
  'originalContent',
  'prd',
  'prdContent',
  'raw',
  'rawContent',
  'refinedContent',
  'revisionContent',
  'toContent',
  'winnerContent',
  'winnerDraftContent',
].map((key) => key.toLowerCase()))

function looksLikeYamlWithFoldedScalars(value: string): boolean {
  return /^\s*(?:-\s*)?(?:"[^"]+"|'[^']+'|[^:#\n][^:\n]*?)\s*:\s*>[+-]?\s*$/m.test(value)
}

function shouldNormalizeEmbeddedYamlString(key: string, value: string): boolean {
  return EMBEDDED_YAML_ARTIFACT_KEYS.has(key.toLowerCase()) && looksLikeYamlWithFoldedScalars(value)
}

function formatReadableRawMultilineString(value: string, indent: number, normalizeEmbeddedYaml = false): string[] {
  const displayValue = normalizeEmbeddedYaml ? normalizeFoldedYamlScalarsForDisplay(value) : value
  const prefix = ' '.repeat(indent)
  return displayValue.split('\n').map((line) => `${prefix}${line}`)
}

function formatReadableRawArrayEntry(entry: unknown, indent: number): string[] {
  const prefix = ' '.repeat(indent)
  if (
    typeof entry === 'string'
    || typeof entry === 'number'
    || typeof entry === 'boolean'
    || entry === null
  ) {
    if (typeof entry === 'string' && entry.includes('\n')) {
      return [`${prefix}- |-`, ...formatReadableRawMultilineString(entry, indent + 2)]
    }
    return [`${prefix}- ${formatReadableRawScalar(entry)}`]
  }

  const nestedLines = formatReadableRawJsonValue(entry, indent + 2)
  const nestedPrefix = ' '.repeat(indent + 2)
  const [firstLine, ...rest] = nestedLines
  if (!firstLine) return [`${prefix}-`]
  return [`${prefix}- ${firstLine.startsWith(nestedPrefix) ? firstLine.slice(nestedPrefix.length) : firstLine.trimStart()}`, ...rest]
}

function formatReadableRawJsonValue(value: unknown, indent = 0): string[] {
  const prefix = ' '.repeat(indent)
  if (typeof value === 'string') {
    if (!value.includes('\n')) return [`${prefix}${formatReadableRawScalar(value)}`]
    return [`${prefix}|-`, ...formatReadableRawMultilineString(value, indent + 2)]
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return [`${prefix}${formatReadableRawScalar(value)}`]
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${prefix}[]`]
    return value.flatMap((entry) => formatReadableRawArrayEntry(entry, indent))
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return [`${prefix}{}`]
    return entries.flatMap(([key, entry]) => {
      const formattedKey = formatReadableRawKey(key)
      if (Array.isArray(entry) && entry.length === 0) return [`${prefix}${formattedKey}: []`]
      if (
        typeof entry === 'string'
        || typeof entry === 'number'
        || typeof entry === 'boolean'
        || entry === null
      ) {
        if (typeof entry === 'string' && entry.includes('\n')) {
          return [
            `${prefix}${formattedKey}: |-`,
            ...formatReadableRawMultilineString(entry, indent + 2, shouldNormalizeEmbeddedYamlString(key, entry)),
          ]
        }
        return [`${prefix}${formattedKey}: ${formatReadableRawScalar(entry)}`]
      }
      if (entry && typeof entry === 'object' && !Array.isArray(entry) && Object.keys(entry as Record<string, unknown>).length === 0) {
        return [`${prefix}${formattedKey}: {}`]
      }
      return [`${prefix}${formattedKey}:`, ...formatReadableRawJsonValue(entry, indent + 2)]
    })
  }
  return [`${prefix}${String(value)}`]
}

function valueContainsEmbeddedNewline(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return value.includes('\n')
  if (!value || typeof value !== 'object' || depth > 12) return false
  if (Array.isArray(value)) return value.some((entry) => valueContainsEmbeddedNewline(entry, depth + 1))
  return Object.values(value as Record<string, unknown>).some((entry) => valueContainsEmbeddedNewline(entry, depth + 1))
}

function getLeadingSpaceCount(value: string): number {
  return value.match(/^ */)?.[0].length ?? 0
}

function foldPlainYamlScalarLines(lines: string[], indent: number, scalarStyle: string): string | null {
  const contentLines = lines.map((line) => {
    if (line.trim().length === 0) return ''
    return line.slice(indent).trimEnd()
  })

  if (contentLines.length === 0 || contentLines.some((line) => !line || /^\s/.test(line))) {
    return null
  }

  const folded = contentLines.join(' ')
  return scalarStyle === '>-' ? folded : `${folded}\n`
}

function normalizeFoldedYamlScalarsForDisplay(content: string): string {
  const lines = content.split('\n')
  const output: string[] = []
  let changed = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    const headerMatch = line.match(/^(\s*(?:-\s*)?(?:"[^"]+"|'[^']+'|[^:#\n][^:\n]*?)\s*:\s*)(>[+-]?)\s*$/)
    if (!headerMatch) {
      output.push(line)
      continue
    }

    const headerIndent = getLeadingSpaceCount(line)
    const blockLines: string[] = []
    let blockIndent: number | null = null
    let cursor = index + 1
    while (cursor < lines.length) {
      const blockLine = lines[cursor]!
      if (blockLine.trim().length === 0) {
        blockLines.push(blockLine)
        cursor += 1
        continue
      }

      const lineIndent = getLeadingSpaceCount(blockLine)
      if (blockIndent === null) {
        if (lineIndent <= headerIndent) break
        blockIndent = lineIndent
      }
      if (lineIndent < blockIndent) break

      blockLines.push(blockLine)
      cursor += 1
    }

    if (blockIndent === null) {
      output.push(line)
      continue
    }

    const foldedValue = foldPlainYamlScalarLines(blockLines, blockIndent, headerMatch[2]!)
    if (foldedValue === null) {
      output.push(line, ...blockLines)
      index = cursor - 1
      continue
    }

    output.push(`${headerMatch[1]}${JSON.stringify(foldedValue)}`)
    changed = true
    index = cursor - 1
  }

  return changed ? output.join('\n') : content
}

export function buildReadableRawDisplayContent(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) return content
  if (trimmed[0] !== '{' && trimmed[0] !== '[') return normalizeFoldedYamlScalarsForDisplay(content)

  try {
    const parsed = JSON.parse(content) as unknown
    if (!valueContainsEmbeddedNewline(parsed)) return content
    return formatReadableRawJsonValue(parsed).join('\n')
  } catch {
    return content
  }
}
