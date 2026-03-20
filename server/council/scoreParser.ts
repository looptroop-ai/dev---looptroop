/**
 * Parse a numerical score from an AI voter response for a specific draft.
 * Looks for common patterns: "Score: X/20", "X/20", "Rating: X", JSON scores,
 * or bare numbers on a line. Returns null when the score cannot be parsed.
 */
export function parseScore(response: string, draftLabel: string, category: string): number | null {
  // Try to isolate the section for this draft
  const draftSection = extractDraftSection(response, draftLabel)
  const text = draftSection ?? response

  // Try to find score specifically for this category
  const catScore = parseCategoryScore(text, category)
  if (catScore !== null) return clampScore(catScore)

  // Try generic patterns in the draft section
  const genericScore = parseGenericScore(text)
  if (genericScore !== null) return clampScore(genericScore)

  return null
}

function extractDraftSection(response: string, draftLabel: string): string | null {
  // Match "Draft N" sections (e.g., "Draft 1:", "## Draft 1", "**Draft 1**")
  const draftNum = draftLabel.match(/\d+/)?.[0]
  if (!draftNum) return null
  const nextNum = String(Number(draftNum) + 1)
  const pattern = new RegExp(
    `(?:^|\\n)\\s*(?:#{1,3}\\s*)?(?:\\*{1,2})?Draft\\s+${draftNum}\\b[^]*?(?=(?:^|\\n)\\s*(?:#{1,3}\\s*)?(?:\\*{1,2})?Draft\\s+${nextNum}\\b|$)`,
    'i',
  )
  const match = response.match(pattern)
  return match ? match[0] : null
}

function parseCategoryScore(text: string, category: string): number | null {
  // Escape category for regex, allow partial match on first word(s)
  const catWords = category.split(/[\s/]+/).filter(w => w.length > 2).slice(0, 3)
  const catPattern = catWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^\\n]*')

  // Pattern: "Category ... : X/20" or "Category ... : X" or "Category ... X/20"
  const re = new RegExp(`${catPattern}[^\\n]*?[:\\-]?\\s*(\\d{1,2})\\s*(?:/\\s*20)?`, 'i')
  const match = text.match(re)
  if (match?.[1]) {
    const val = Number(match[1])
    if (val >= 0 && val <= 20) return val
  }
  return null
}

function parseGenericScore(text: string): number | null {
  // Try "Score: X/20" or "X/20"
  const scoreSlash = text.match(/\bscore\s*:\s*(\d{1,2})\s*\/\s*20/i)
    ?? text.match(/\brating\s*:\s*(\d{1,2})\s*\/\s*20/i)
    ?? text.match(/(\d{1,2})\s*\/\s*20/)
  if (scoreSlash?.[1]) {
    const val = Number(scoreSlash[1])
    if (val >= 0 && val <= 20) return val
  }

  // Try "Score: X" or "Rating: X"
  const scoreLabel = text.match(/\b(?:score|rating)\s*:\s*(\d{1,2})\b/i)
  if (scoreLabel?.[1]) {
    const val = Number(scoreLabel[1])
    if (val >= 0 && val <= 20) return val
  }

  // Try JSON-like { "score": X }
  const jsonScore = text.match(/"score"\s*:\s*(\d{1,2})/i)
  if (jsonScore?.[1]) {
    const val = Number(jsonScore[1])
    if (val >= 0 && val <= 20) return val
  }

  return null
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(20, Math.round(score)))
}
