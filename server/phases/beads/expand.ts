import type { Bead, BeadSubset } from './types'

/** Extract epicId and storyId from PRD references. */
function derivePrdIds(prdRefs: string[]): { epicId: string; storyId: string } {
  let epicId = ''
  let storyId = ''
  for (const ref of prdRefs) {
    const upper = ref.toUpperCase().trim()
    // Match user story pattern first (US-1-1, US-2-3, etc.)
    if (!storyId && /^US-\d+-\d+$/i.test(upper)) {
      storyId = upper
      // Derive epicId from story if not set
      if (!epicId) {
        const match = upper.match(/^US-(\d+)-/i)
        if (match) epicId = `EPIC-${match[1]}`
      }
    }
    // Match epic pattern (EPIC-1, EPIC-2, etc.)
    if (!epicId && /^EPIC-\d+$/i.test(upper)) {
      epicId = upper
    }
  }
  return { epicId, storyId }
}

export function expandBeads(subsetBeads: BeadSubset[]): Bead[] {
  const now = new Date().toISOString()

  return subsetBeads.map((subset, index) => {
    const { epicId, storyId } = derivePrdIds(subset.prdRefs)
    return {
      ...subset,
      priority: index + 1,
      status: 'pending' as const,
      labels: [],
      dependencies: [],
      targetFiles: [],
      notes: [],
      iteration: 0,
      createdAt: now,
      updatedAt: now,
      beadStartCommit: null,
      estimatedComplexity: 'moderate' as const,
      epicId,
      storyId,
    }
  })
}
