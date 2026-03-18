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
