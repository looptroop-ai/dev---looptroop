import type { Bead } from './types'

export function verifyBeadsCoverage(
  beads: Bead[],
  _prdContent: string,
): { passed: boolean; gaps: string[] } {
  const gaps: string[] = []

  // Must have at least one bead
  if (beads.length === 0) {
    gaps.push('No beads generated')
    return { passed: false, gaps }
  }

  // Validate no self-dependencies
  for (const bead of beads) {
    if (bead.dependencies.includes(bead.id)) {
      gaps.push(`Bead ${bead.id} has a self-dependency`)
    }
  }

  // Validate no dangling dependency references
  const beadIds = new Set(beads.map(b => b.id))
  for (const bead of beads) {
    for (const dep of bead.dependencies) {
      if (!beadIds.has(dep)) {
        gaps.push(`Bead ${bead.id} depends on non-existent bead ${dep}`)
      }
    }
  }

  // Validate no circular dependencies
  const visited = new Set<string>()
  const recStack = new Set<string>()

  function hasCycle(beadId: string): boolean {
    visited.add(beadId)
    recStack.add(beadId)

    const bead = beads.find(b => b.id === beadId)
    if (bead) {
      for (const dep of bead.dependencies) {
        if (!visited.has(dep)) {
          if (hasCycle(dep)) return true
        } else if (recStack.has(dep)) {
          return true
        }
      }
    }

    recStack.delete(beadId)
    return false
  }

  for (const bead of beads) {
    if (!visited.has(bead.id)) {
      if (hasCycle(bead.id)) {
        gaps.push('Circular dependency detected in bead graph')
        break
      }
    }
  }

  // Check all beads have required fields
  for (const bead of beads) {
    if (!bead.title) gaps.push(`Bead ${bead.id} missing title`)
    if (!bead.description) gaps.push(`Bead ${bead.id} missing description`)
    if (bead.acceptanceCriteria.length === 0) gaps.push(`Bead ${bead.id} missing acceptance criteria`)
    if (bead.tests.length === 0) gaps.push(`Bead ${bead.id} missing tests`)
  }

  return { passed: gaps.length === 0, gaps }
}
