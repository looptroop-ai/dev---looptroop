import type { Bead, BeadSubset } from './types'

/** Extract epicId and storyId from PRD references. */
function derivePrdIds(prdRefs: string[]): { epicId: string; storyId: string } {
  let epicId = ''
  let storyId = ''
  for (const ref of prdRefs) {
    const normalized = ref.toUpperCase().trim()
    const storyMatch = normalized.match(/\bUS-\d+(?:-\d+)?\b/)
    if (!storyId && storyMatch?.[0]) {
      storyId = storyMatch[0]
      const epicFromStory = storyId.match(/^US-(\d+)-/i)
      if (!epicId && epicFromStory?.[1]) {
        epicId = `EPIC-${epicFromStory[1]}`
      }
    }

    const epicMatch = normalized.match(/\bEPIC-\d+\b/)
    if (!epicId && epicMatch?.[0]) {
      epicId = epicMatch[0]
    }
  }
  return { epicId, storyId }
}

function deriveLabels(epicId: string, storyId: string): string[] {
  const labels: string[] = []
  if (epicId) labels.push(`epic:${epicId}`)
  if (storyId) labels.push(`story:${storyId}`)
  return labels
}

export function expandBeads(subsetBeads: BeadSubset[]): Bead[] {
  const now = new Date().toISOString()

  return subsetBeads.map((subset, index) => {
    const { epicId, storyId } = derivePrdIds(subset.prdRefs)
    const labels = deriveLabels(epicId, storyId)
    return {
      ...subset,
      priority: index + 1,
      status: 'pending' as const,
      labels,
      dependencies: [],
      targetFiles: [],
      notes: [],
      iteration: 1,
      createdAt: now,
      updatedAt: now,
      beadStartCommit: null,
      estimatedComplexity: 'moderate' as const,
      epicId,
      storyId,
    }
  })
}
