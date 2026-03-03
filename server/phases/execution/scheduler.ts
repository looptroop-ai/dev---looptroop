import type { Bead } from '../beads/types'

export function getRunnable(beads: Bead[]): Bead[] {
  const completedIds = new Set(beads.filter((b) => b.status === 'completed').map((b) => b.id))

  return beads
    .filter((b) => b.status === 'pending')
    .filter((b) => b.dependencies.every((dep) => completedIds.has(dep)))
    .sort((a, b) => a.priority - b.priority)
}

export function getNextBead(beads: Bead[]): Bead | null {
  const runnable = getRunnable(beads)
  return runnable[0] ?? null
}

export function isAllComplete(beads: Bead[]): boolean {
  return beads.length > 0 && beads.every((b) => b.status === 'completed' || b.status === 'skipped')
}
