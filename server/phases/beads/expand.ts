import type { Bead, BeadSubset } from './types'

export function expandBeads(subsetBeads: BeadSubset[]): Bead[] {
  const now = new Date().toISOString()

  return subsetBeads.map((subset, index) => ({
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
    epicId: '',
    storyId: '',
  }))
}
