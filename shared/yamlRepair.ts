/**
 * Repair YAML list items where the dash is not followed by a space.
 *
 * Models sometimes emit `-key: value` instead of `- key: value`.
 * YAML requires a space after the dash for a block sequence entry.
 * This function inserts the missing space.
 */
export function repairYamlListDashSpace(yaml: string): string {
  return yaml
    .split('\n')
    .map((line) => {
      const match = line.match(/^(\s*)-([a-zA-Z_]\w*\s*:.*)$/)
      if (!match) return line
      return `${match[1]}- ${match[2]}`
    })
    .join('\n')
}

/**
 * Repair YAML indentation for list items produced by model output.
 *
 * Models sometimes emit properties within list items at the wrong indent
 * (e.g. 3-space instead of 2-space offset from the dash). This function
 * normalizes property lines so that they sit at dash_indent + 2.
 */
export function repairYamlIndentation(yaml: string): string {
  const lines = yaml.split('\n')
  const result: string[] = []
  const BLOCK_SCALAR_PATTERN = /:\s*[>|][+-]?\s*$/

  // Track the expected indent for properties inside the current list item.
  // Set when we see `- key:` and cleared when we leave that indent context.
  let expectedPropertyIndent = -1
  let dashIndent = -1
  let activeNestedIndent = -1
  let activeBlockScalarIndent = -1

  for (const line of lines) {
    // Blank lines or comment-only lines pass through unchanged
    if (!line.trim() || line.trimStart().startsWith('#')) {
      result.push(line)
      continue
    }

    // Detect list item start: `  - key: value` or `  - key:`
    const dashMatch = line.match(/^(\s*)-\s+([a-z_]+\s*:.*)$/i)
    if (dashMatch) {
      dashIndent = dashMatch[1]!.length
      expectedPropertyIndent = dashIndent + 2
      activeNestedIndent = -1
      activeBlockScalarIndent = BLOCK_SCALAR_PATTERN.test(dashMatch[2]!.trimEnd()) ? dashIndent : -1
      result.push(line)
      continue
    }

    // If we're inside a list item, check bare property lines for indent mismatch
    if (expectedPropertyIndent >= 0) {
      const actualIndent = line.match(/^(\s*)/)?.[1]?.length ?? 0

      if (activeBlockScalarIndent >= 0) {
        if (actualIndent > activeBlockScalarIndent) {
          result.push(line)
          continue
        }
        activeBlockScalarIndent = -1
      }

      if (activeNestedIndent >= 0) {
        if (actualIndent >= activeNestedIndent) {
          result.push(line)
          continue
        }
        if (actualIndent <= expectedPropertyIndent) {
          activeNestedIndent = -1
        }
      }

      const propMatch = line.match(/^(\s*)([a-z_]+\s*:.*)$/i)
      if (propMatch) {
        const isBlockScalar = BLOCK_SCALAR_PATTERN.test(propMatch[2]!.trimEnd())
        if (actualIndent === expectedPropertyIndent && propMatch[2]!.trimEnd().endsWith(':')) {
          activeNestedIndent = actualIndent + 2
          result.push(line)
          continue
        }

        // Only fix if the line is clearly a sibling property of the list item:
        // its indent is close to (but not equal to) the expected indent,
        // and it's deeper than the dash itself. Nested mappings/lists are
        // handled by `activeNestedIndent` above and preserved as-is.
        if (
          actualIndent !== expectedPropertyIndent
          && actualIndent > dashIndent
          && Math.abs(actualIndent - expectedPropertyIndent) <= 2
        ) {
          const repaired = ' '.repeat(expectedPropertyIndent) + propMatch[2]
          if (propMatch[2]!.trimEnd().endsWith(':')) {
            activeNestedIndent = expectedPropertyIndent + 2
          }
          if (isBlockScalar) {
            activeBlockScalarIndent = expectedPropertyIndent
          }
          result.push(repaired)
          continue
        }

        // If indent matches expected or is deeper (nested), pass through
        if (actualIndent >= expectedPropertyIndent) {
          if (isBlockScalar) {
            activeBlockScalarIndent = actualIndent
          }
          result.push(line)
          continue
        }

        // If indent is at or before the dash level, we've left this list item
        expectedPropertyIndent = -1
        dashIndent = -1
        activeNestedIndent = -1
        activeBlockScalarIndent = -1
      }
    }

    result.push(line)
  }

  return result.join('\n')
}

/**
 * Repair inconsistent sequence entry indentation.
 *
 * Models sometimes emit the first `- ` in a sequence at one indent level,
 * then drift subsequent entries by 1-3 spaces (typically after a block
 * scalar like `>-`). This function normalizes all sibling dashes to match
 * the indent of the first entry in each sequence.
 */
export function repairYamlSequenceEntryIndent(yaml: string): string {
  const lines = yaml.split('\n')
  const result: string[] = []
  const BLOCK_SCALAR_PATTERN = /:\s*[>|][+-]?\s*$/
  const DASH_LINE = /^(\s*)-(\s+.*)$/
  const BARE_KEY = /^[a-z_][\w_-]*\s*:\s*$/i
  const MAX_SIBLING_DELTA = 3

  // Sorted array of anchor indents for known sequence levels.
  const anchors: number[] = []
  let blockScalarBaseIndent = -1

  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) {
      result.push(line)
      continue
    }

    const actualIndent = (line.match(/^(\s*)/) ?? [''])[0].length

    // Block scalar continuation — skip
    if (blockScalarBaseIndent >= 0) {
      if (actualIndent > blockScalarBaseIndent) {
        result.push(line)
        continue
      }
      blockScalarBaseIndent = -1
    }

    // Bare mapping key (e.g. "questions:") — reset deeper anchors
    if (BARE_KEY.test(trimmed) && !DASH_LINE.test(line)) {
      while (anchors.length > 0 && anchors[anchors.length - 1]! > actualIndent) {
        anchors.pop()
      }
      result.push(line)
      continue
    }

    const dashMatch = line.match(DASH_LINE)
    if (dashMatch) {
      const dashIndent = dashMatch[1]!.length
      const rest = dashMatch[2]!

      // Find closest anchor within MAX_SIBLING_DELTA
      let bestAnchor: number | null = null
      let bestDelta = MAX_SIBLING_DELTA + 1
      for (const anchor of anchors) {
        const delta = Math.abs(dashIndent - anchor)
        if (delta <= MAX_SIBLING_DELTA && delta < bestDelta) {
          bestAnchor = anchor
          bestDelta = delta
        }
      }

      if (bestAnchor !== null) {
        // Sibling — normalize to anchor and pop any deeper anchors
        while (anchors.length > 0 && anchors[anchors.length - 1]! > bestAnchor) {
          anchors.pop()
        }
        if (dashIndent !== bestAnchor) {
          result.push(' '.repeat(bestAnchor) + '-' + rest)
        } else {
          result.push(line)
        }
      } else {
        // New sequence level
        anchors.push(dashIndent)
        result.push(line)
      }

      // Track block scalar on dash line
      if (BLOCK_SCALAR_PATTERN.test(rest.trimEnd())) {
        blockScalarBaseIndent = bestAnchor ?? dashIndent
      }
      continue
    }

    // Non-dash line — track block scalars
    if (BLOCK_SCALAR_PATTERN.test(trimmed)) {
      blockScalarBaseIndent = actualIndent
    }

    result.push(line)
  }

  return result.join('\n')
}

/**
 * Remove exact-duplicate mapping keys from YAML.
 *
 * Models sometimes emit the same key-value pair twice within a mapping, or
 * repeat a block key like `options:` with the same nested list. This function
 * removes exact duplicates (same key + same full line text) while preserving
 * entries with different values (those are ambiguous and should be left for
 * js-yaml to error on). When the duplicate key opens a nested block, the
 * duplicate block contents are removed as well so they do not get merged into
 * the first key during YAML parsing.
 */
export function repairYamlDuplicateKeys(yaml: string): string {
  const lines = yaml.split('\n')
  const result: string[] = []
  const BLOCK_SCALAR_PATTERN = /:\s*[>|][+-]?\s*$/

  // Map from effective indent level → Map<key_name, full_line_text>
  const seenByIndent = new Map<number, Map<string, string>>()

  // When >= 0, we are skipping nested lines of a removed duplicate mapping
  // block (for example a duplicate `options:` plus its list items).
  let skipNestedBlockIndent = -1

  // When >= 0, we are skipping continuation lines of a removed block-scalar duplicate
  let skipBlockScalarIndent = -1

  for (const line of lines) {
    const trimmed = line.trim()
    const lineIndent = line.match(/^(\s*)/)?.[1]?.length ?? 0

    if (skipNestedBlockIndent >= 0) {
      if (!trimmed || trimmed.startsWith('#')) {
        continue
      }
      if (lineIndent > skipNestedBlockIndent) {
        continue
      }
      skipNestedBlockIndent = -1
    }

    // If we're skipping block-scalar continuation of a removed duplicate
    if (skipBlockScalarIndent >= 0) {
      if (lineIndent > skipBlockScalarIndent) {
        continue // skip continuation line
      }
      skipBlockScalarIndent = -1
    }

    // Blank / comment lines pass through
    if (!trimmed || trimmed.startsWith('#')) {
      result.push(line)
      continue
    }

    // When indentation decreases, deeper mapping contexts are closed
    for (const level of [...seenByIndent.keys()]) {
      if (level > lineIndent) {
        seenByIndent.delete(level)
      }
    }

    // List item with key: `  - key: value`
    // Each list item starts a fresh mapping at effectiveIndent = dashIndent + 2
    const listItemKeyMatch = line.match(/^(\s*)-\s+([A-Za-z_][\w_-]*)\s*:(.*)$/)
    if (listItemKeyMatch) {
      const dashIndent = listItemKeyMatch[1]!.length
      const effectiveIndent = dashIndent + 2
      const key = listItemKeyMatch[2]!

      // New list item → fresh mapping context
      seenByIndent.delete(effectiveIndent)
      for (const level of [...seenByIndent.keys()]) {
        if (level > effectiveIndent) {
          seenByIndent.delete(level)
        }
      }

      const map = new Map<string, string>()
      map.set(key, line)
      seenByIndent.set(effectiveIndent, map)

      result.push(line)
      continue
    }

    // Bare mapping key: `key: value` or `  key: value`
    const keyMatch = line.match(/^(\s*)([A-Za-z_][\w_-]*)\s*:(.*)$/)
    if (keyMatch) {
      const key = keyMatch[2]!

      if (!seenByIndent.has(lineIndent)) {
        seenByIndent.set(lineIndent, new Map())
      }
      const seenAtLevel = seenByIndent.get(lineIndent)!

      const previousLine = seenAtLevel.get(key)
      if (previousLine !== undefined && previousLine === line) {
        // Exact duplicate — skip this line
        if (BLOCK_SCALAR_PATTERN.test(trimmed)) {
          skipBlockScalarIndent = lineIndent
        } else {
          const valuePortion = keyMatch[3]?.trim() ?? ''
          if (!valuePortion || valuePortion.startsWith('#')) {
            skipNestedBlockIndent = lineIndent
          }
        }
        continue
      }

      seenAtLevel.set(key, line)
    }

    result.push(line)
  }

  return result.join('\n')
}

/**
 * Quote one-line `free_text` scalar values.
 *
 * `free_text` fields are always string-typed in our structured artifacts, but
 * models often emit them as plain YAML scalars. Those are fragile: values that
 * start with backticks, look like booleans, or contain `: ` can all break YAML
 * parsing or coerce to the wrong type. This repair wraps any non-empty
 * one-line plain `free_text:` value in double quotes while preserving block
 * scalars and already-quoted values.
 */
export function repairYamlFreeTextScalars(yaml: string): string {
  const lines = yaml.split('\n')
  const result: string[] = []
  const BLOCK_SCALAR_PATTERN = /:\s*[>|][+-]?\s*$/
  const SAFE_VALUE_START = /^["'|>&*!#]/

  let insideBlockScalar = false
  let blockScalarBaseIndent = -1

  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) {
      result.push(line)
      continue
    }

    const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0
    if (insideBlockScalar) {
      if (indent > blockScalarBaseIndent) {
        result.push(line)
        continue
      }
      insideBlockScalar = false
      blockScalarBaseIndent = -1
    }

    if (BLOCK_SCALAR_PATTERN.test(trimmed)) {
      insideBlockScalar = true
      blockScalarBaseIndent = indent
      result.push(line)
      continue
    }

    const freeTextMatch = line.match(/^(\s*(?:-\s+)?free_text\s*:\s*)(.+)$/)
    if (!freeTextMatch) {
      result.push(line)
      continue
    }

    const prefix = freeTextMatch[1]!
    const value = freeTextMatch[2]!
    if (SAFE_VALUE_START.test(value)) {
      result.push(line)
      continue
    }

    result.push(`${prefix}${JSON.stringify(value)}`)
  }

  return result.join('\n')
}

/**
 * Repair YAML plain scalars that contain `: ` (colon-space).
 *
 * In YAML, a plain scalar value must not contain `: ` because parsers
 * interpret it as a nested mapping entry. Models frequently produce
 * unquoted values like `rationale: some rules: here` which breaks parsing.
 * This function wraps such values in double quotes.
 */
/**
 * Strip markdown code fences wrapping YAML/JSON content.
 *
 * Models sometimes wrap their entire structured output in ```yaml ... ```
 * or similar fences. Returns the inner content if wrapped, or the input
 * unchanged if not wrapped.
 */
export function stripCodeFences(content: string): string {
  const trimmed = content.trim()
  const openMatch = trimmed.match(/^```(?:yaml|yml|json|jsonl)?\s*\n/)
  if (!openMatch) return content
  const closeMatch = trimmed.match(/\n\s*```\s*$/)
  if (!closeMatch) return content
  return trimmed.slice(openMatch[0].length, closeMatch.index!)
}

/**
 * Repair YAML where multiple mapping keys appear on a single line.
 *
 * Models sometimes emit all keys inline, e.g.:
 *   batch_number: 4 progress: current: 4 total: 17 is_final_free_form: false
 * This function splits them onto separate lines with correct indentation,
 * handling both flat siblings and nested mappings.
 */
export function repairYamlInlineKeys(yaml: string): string {
  const lines = yaml.split('\n')
  const result: string[] = []
  const BLOCK_SCALAR_PATTERN = /:\s*[>|][+-]?\s*$/

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      result.push(line)
      continue
    }

    // Skip block scalar indicators
    if (BLOCK_SCALAR_PATTERN.test(trimmed)) {
      result.push(line)
      continue
    }

    const indent = (line.match(/^(\s*)/) ?? [''])[0]
    const hasDash = /^\s*-\s+/.test(line)
    const content = hasDash ? line.replace(/^\s*-\s+/, '') : trimmed
    const dashPrefix = hasDash ? (line.match(/^(\s*-\s+)/) ?? [''])[1]! : ''

    const tokens = tokenizeInlineKeys(content)
    if (!tokens || tokens.length <= 1) {
      result.push(line)
      continue
    }

    // Build nested structure from flat tokens
    const structured = buildNestedStructure(tokens)

    // Emit onto separate lines
    const baseIndent = hasDash ? indent + '  ' : indent
    for (let i = 0; i < structured.length; i++) {
      const entry = structured[i]!
      const linePrefix = i === 0 && hasDash ? dashPrefix : baseIndent
      if ('children' in entry) {
        result.push(`${linePrefix}${entry.key}:`)
        const nestedIndent = baseIndent + '  '
        for (const child of entry.children) {
          result.push(`${nestedIndent}${child.key}: ${child.value}`)
        }
      } else {
        result.push(`${linePrefix}${entry.key}: ${entry.value}`)
      }
    }
  }

  return result.join('\n')
}

interface InlineKVToken { key: string; value: string }
interface InlineKVLeaf { key: string; value: string }
interface InlineKVParent { key: string; children: InlineKVToken[] }
type InlineKVEntry = InlineKVLeaf | InlineKVParent

/**
 * Tokenize text into key-value pairs. Returns null if the text
 * doesn't look like inline YAML keys (e.g. it's a normal value with spaces).
 */
function tokenizeInlineKeys(text: string): InlineKVToken[] | null {
  const KEY_PATTERN = /([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*/g
  const keyMatches: Array<{ key: string; start: number; valueStart: number }> = []

  let m: RegExpExecArray | null
  while ((m = KEY_PATTERN.exec(text)) !== null) {
    keyMatches.push({ key: m[1]!, start: m.index, valueStart: m.index + m[0].length })
  }

  if (keyMatches.length < 2) return null
  // Text must begin with a key
  if (keyMatches[0]!.start !== 0) return null

  const tokens: InlineKVToken[] = []
  for (let i = 0; i < keyMatches.length; i++) {
    const km = keyMatches[i]!
    const nextStart = i + 1 < keyMatches.length ? keyMatches[i + 1]!.start : text.length
    tokens.push({ key: km.key, value: text.slice(km.valueStart, nextStart).trim() })
  }

  // Validate: all non-empty values must be simple (number, boolean, quoted, single word)
  for (const token of tokens) {
    if (token.value && !isInlineSimpleValue(token.value)) return null
  }

  return tokens
}

/**
 * Group flat tokens into a nested structure.
 * A key with an empty value is treated as a parent whose children are the
 * following keys. Children end when a key's naming style changes (compound
 * vs simple) or when another parent key is encountered.
 */
function buildNestedStructure(tokens: InlineKVToken[]): InlineKVEntry[] {
  const result: InlineKVEntry[] = []
  let i = 0

  while (i < tokens.length) {
    const token = tokens[i]!

    if (token.value === '' && i + 1 < tokens.length) {
      // Parent key — collect children
      const children: InlineKVToken[] = []
      const firstChildStyle = nameHasUnderscore(tokens[i + 1]!.key)
      i++

      while (i < tokens.length) {
        if (tokens[i]!.value === '') break // another parent
        const childStyle = nameHasUnderscore(tokens[i]!.key)
        if (children.length > 0 && childStyle !== firstChildStyle) break
        children.push(tokens[i]!)
        i++
      }

      if (children.length > 0) {
        result.push({ key: token.key, children })
      } else {
        result.push({ key: token.key, value: '' })
        // don't increment i — it was already moved past the parent
      }
    } else {
      result.push({ key: token.key, value: token.value })
      i++
    }
  }

  return result
}

function nameHasUnderscore(name: string): boolean {
  return name.includes('_')
}

function isInlineSimpleValue(text: string): boolean {
  if (/^-?\d+(\.\d+)?$/.test(text)) return true
  if (/^(true|false|yes|no|null|~)$/i.test(text)) return true
  if (/^"[^"]*"$/.test(text) || /^'[^']*'$/.test(text)) return true
  if (/^[^\s:]+$/.test(text)) return true
  return false
}

export function repairYamlPlainScalarColons(yaml: string): string {
  const lines = yaml.split('\n')
  const result: string[] = []

  const BLOCK_SCALAR_PATTERN = /:\s*[>|][+-]?\s*$/
  // Skip values that are already safe: quoted, block scalar, flow, anchor, tag, or comment
  const SAFE_VALUE_START = /^["'[{>|&*!#]/

  let insideBlockScalar = false
  let blockScalarBaseIndent = -1

  for (const line of lines) {
    const trimmed = line.trim()

    // Blank / comment lines pass through
    if (!trimmed || trimmed.startsWith('#')) {
      result.push(line)
      continue
    }

    // Track block-scalar continuation: any line indented deeper than the key
    if (insideBlockScalar) {
      const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0
      if (indent > blockScalarBaseIndent) {
        result.push(line)
        continue
      }
      // Left the block scalar
      insideBlockScalar = false
      blockScalarBaseIndent = -1
    }

    // Match `key: value` — capture indent+key vs value
    // Works for both top-level and nested keys, including list item first keys
    const mappingMatch = line.match(/^(\s*(?:-\s+)?)([A-Za-z_][\w_-]*\s*:\s+)(.+)$/)
    if (mappingMatch) {
      const prefix = mappingMatch[1]! + mappingMatch[2]!
      const value = mappingMatch[3]!

      // Detect block scalar indicator on this line
      if (BLOCK_SCALAR_PATTERN.test(line.trimEnd())) {
        insideBlockScalar = true
        blockScalarBaseIndent = (line.match(/^(\s*)/)?.[1]?.length ?? 0)
        result.push(line)
        continue
      }

      // Skip already-safe values
      if (SAFE_VALUE_START.test(value)) {
        result.push(line)
        continue
      }

      // Check if the value contains a problematic `: ` or ends with `:`
      if (/:\s/.test(value) || value.endsWith(':')) {
        const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        result.push(`${prefix}"${escaped}"`)
        continue
      }
    }

    // Bare `key:` with block scalar on next line
    if (BLOCK_SCALAR_PATTERN.test(trimmed)) {
      insideBlockScalar = true
      blockScalarBaseIndent = (line.match(/^(\s*)/)?.[1]?.length ?? 0)
    }

    result.push(line)
  }

  return result.join('\n')
}

/**
 * Repair YAML values with unclosed double-quotes.
 *
 * Models sometimes emit `key: "value` without a closing `"`. The YAML parser
 * then treats all subsequent lines as part of the quoted scalar, swallowing
 * sibling keys and list items. This function detects unclosed double-quoted
 * values and appends a closing `"` when the next non-blank line is clearly a
 * separate YAML structural element (a list item, sibling key, code fence,
 * document marker, or EOF).
 */
export function repairYamlUnclosedQuotes(yaml: string): string {
  const lines = yaml.split('\n')
  const result: string[] = []
  const BLOCK_SCALAR_PATTERN = /:\s*[>|][+-]?\s*$/
  // Match `key: "value` with optional leading `- ` for list item first keys
  const QUOTED_VALUE_PATTERN = /^(\s*(?:-\s+)?[A-Za-z_][\w_-]*\s*:\s+)"(.*)$/

  let insideBlockScalar = false
  let blockScalarBaseIndent = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const trimmed = line.trim()

    // Blank / comment lines pass through
    if (!trimmed || trimmed.startsWith('#')) {
      result.push(line)
      continue
    }

    const lineIndent = (line.match(/^(\s*)/) ?? [''])[0].length

    // Block-scalar continuation tracking
    if (insideBlockScalar) {
      if (lineIndent > blockScalarBaseIndent) {
        result.push(line)
        continue
      }
      insideBlockScalar = false
      blockScalarBaseIndent = -1
    }

    // Detect block scalar indicator — skip these lines from quote repair
    if (BLOCK_SCALAR_PATTERN.test(trimmed)) {
      insideBlockScalar = true
      blockScalarBaseIndent = lineIndent
      result.push(line)
      continue
    }

    const quotedMatch = line.match(QUOTED_VALUE_PATTERN)
    if (quotedMatch) {
      const valueAfterOpenQuote = quotedMatch[2]!
      // If the value has an even number of unescaped double-quotes after the
      // opening one, the total is odd — meaning the opening quote is unclosed.
      if (countUnescapedDoubleQuotes(valueAfterOpenQuote) % 2 === 0) {
        const nextLine = findNextNonBlankLine(lines, i + 1)
        if (nextLine === null || looksLikeYamlStructuralLine(nextLine, lineIndent)) {
          result.push(line + '"')
          continue
        }
      }
    }

    result.push(line)
  }

  return result.join('\n')
}

function countUnescapedDoubleQuotes(value: string): number {
  let count = 0
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '"') continue
    let backslashes = 0
    for (let j = i - 1; j >= 0 && value[j] === '\\'; j--) {
      backslashes++
    }
    if (backslashes % 2 === 0) count++
  }
  return count
}

function findNextNonBlankLine(lines: string[], startIndex: number): string | null {
  for (let i = startIndex; i < lines.length; i++) {
    if (lines[i]!.trim()) return lines[i]!
  }
  return null
}

function looksLikeYamlStructuralLine(line: string, currentIndent: number): boolean {
  const trimmed = line.trim()
  const lineIndent = (line.match(/^(\s*)/) ?? [''])[0].length

  // New list item at same or lesser indent (with some tolerance)
  if (/^\s*-\s+\S/.test(line) && lineIndent <= currentIndent + 2) return true

  // Mapping key at same or lesser indent
  if (/^\s*[A-Za-z_][\w_-]*\s*:/.test(line) && lineIndent <= currentIndent) return true

  // Code fence
  if (trimmed.startsWith('```')) return true

  // YAML document markers
  if (trimmed === '---' || trimmed === '...') return true

  return false
}
