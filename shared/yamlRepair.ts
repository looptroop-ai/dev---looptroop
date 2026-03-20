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
 * Repair YAML plain scalars that contain `: ` (colon-space).
 *
 * In YAML, a plain scalar value must not contain `: ` because parsers
 * interpret it as a nested mapping entry. Models frequently produce
 * unquoted values like `rationale: some rules: here` which breaks parsing.
 * This function wraps such values in double quotes.
 */
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
