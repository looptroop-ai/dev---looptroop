export interface CoverageGapMatch {
  gap: string
  repairWarning: string | null
}

function normalizeCoverageGapForMatching(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/[\u2018\u2019\u201A\u201B]/gu, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/gu, '"')
    .replace(/[`'"]/gu, '')
    .replace(/\s+/gu, ' ')
}

export function matchCoverageGapReference(
  rawGap: string,
  coverageGaps: string[],
  warningPrefix: string,
): CoverageGapMatch | null {
  const gap = rawGap.trim()
  if (!gap) return null

  if (coverageGaps.includes(gap)) {
    return { gap, repairWarning: null }
  }

  const normalizedGap = normalizeCoverageGapForMatching(gap)
  const matches = coverageGaps.filter((candidate) => normalizeCoverageGapForMatching(candidate) === normalizedGap)
  if (matches.length !== 1) return null

  return {
    gap: matches[0]!,
    repairWarning: `${warningPrefix} coverage gap reference from "${gap}" to provided gap text.`,
  }
}
