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
 * Models sometimes emit the same key-value pair twice within a mapping.
 * This function removes exact duplicates (same key + same full line text)
 * while preserving entries with different values (those are ambiguous and
 * should be left for js-yaml to error on).
 */
export function repairYamlDuplicateKeys(yaml: string): string {
  const lines = yaml.split('\n')
  const result: string[] = []
  const BLOCK_SCALAR_PATTERN = /:\s*[>|][+-]?\s*$/

  // Map from effective indent level → Map<key_name, full_line_text>
  const seenByIndent = new Map<number, Map<string, string>>()

  // When >= 0, we are skipping continuation lines of a removed block-scalar duplicate
  let skipBlockScalarIndent = -1

  for (const line of lines) {
    const trimmed = line.trim()

    // Blank / comment lines pass through
    if (!trimmed || trimmed.startsWith('#')) {
      result.push(line)
      continue
    }

    const lineIndent = line.match(/^(\s*)/)?.[1]?.length ?? 0

    // If we're skipping block-scalar continuation of a removed duplicate
    if (skipBlockScalarIndent >= 0) {
      if (lineIndent > skipBlockScalarIndent) {
        continue // skip continuation line
      }
      skipBlockScalarIndent = -1
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
