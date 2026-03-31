import path from 'node:path'
import type { Bead, BeadDependencies, BeadSubset } from './types'

export interface BeadExpansionCandidate {
  id: string
  issueType: string
  labels: string[]
  dependencies: Pick<BeadDependencies, 'blocked_by'> & Partial<Pick<BeadDependencies, 'blocks'>>
  targetFiles: string[]
}

/** Extract epicId and storyId from PRD references for label generation. */
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

function deriveLabels(epicId: string, storyId: string, externalRef: string): string[] {
  const labels: string[] = []
  if (externalRef) labels.push(`ticket:${externalRef}`)
  if (epicId) labels.push(`epic:${epicId}`)
  if (storyId) labels.push(`story:${storyId}`)
  return labels
}

export function expandBeads(subsetBeads: BeadSubset[], externalRef: string = ''): Bead[] {
  const now = new Date().toISOString()

  return subsetBeads.map((subset, index) => {
    const { epicId, storyId } = derivePrdIds(subset.prdRefs)
    const labels = deriveLabels(epicId, storyId, externalRef)
    return {
      ...subset,
      priority: index + 1,
      status: 'pending' as const,
      issueType: 'task',
      externalRef,
      labels,
      dependencies: { blocked_by: [], blocks: [] },
      targetFiles: [],
      notes: '',
      iteration: 1,
      createdAt: now,
      updatedAt: now,
      completedAt: '',
      startedAt: '',
      beadStartCommit: null,
    }
  })
}

function compareExactStringArrays(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function normalizeNarrativeText(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!?]+$/u, '')
}

function collectNarrativeStringDrift(fieldPath: string, left: string, right: string): string[] | null {
  if (left === right) return []
  return normalizeNarrativeText(left) === normalizeNarrativeText(right) ? [fieldPath] : null
}

function collectNarrativeArrayDrift(fieldPath: string, left: string[], right: string[]): string[] | null {
  if (left.length !== right.length) return null
  const driftPaths: string[] = []
  for (let index = 0; index < left.length; index += 1) {
    const itemDrift = collectNarrativeStringDrift(`${fieldPath}[${index}]`, left[index] ?? '', right[index] ?? '')
    if (itemDrift == null) return null
    driftPaths.push(...itemDrift)
  }
  return driftPaths
}

function collectPreservedFieldDrift(subset: BeadSubset, bead: Bead): string[] | null {
  if (!compareExactStringArrays(subset.prdRefs, bead.prdRefs)) {
    return null
  }
  if (!compareExactStringArrays(subset.testCommands, bead.testCommands)) {
    return null
  }

  const driftPaths: string[] = []
  const titleDrift = collectNarrativeStringDrift('title', subset.title, bead.title)
  if (titleDrift == null) return null
  driftPaths.push(...titleDrift)

  const descriptionDrift = collectNarrativeStringDrift('description', subset.description, bead.description)
  if (descriptionDrift == null) return null
  driftPaths.push(...descriptionDrift)

  const patternDrift = collectNarrativeArrayDrift(
    'contextGuidance.patterns',
    subset.contextGuidance.patterns,
    bead.contextGuidance.patterns,
  )
  if (patternDrift == null) return null
  driftPaths.push(...patternDrift)

  const antiPatternDrift = collectNarrativeArrayDrift(
    'contextGuidance.anti_patterns',
    subset.contextGuidance.anti_patterns,
    bead.contextGuidance.anti_patterns,
  )
  if (antiPatternDrift == null) return null
  driftPaths.push(...antiPatternDrift)

  const acceptanceCriteriaDrift = collectNarrativeArrayDrift(
    'acceptanceCriteria',
    subset.acceptanceCriteria,
    bead.acceptanceCriteria,
  )
  if (acceptanceCriteriaDrift == null) return null
  driftPaths.push(...acceptanceCriteriaDrift)

  const testsDrift = collectNarrativeArrayDrift('tests', subset.tests, bead.tests)
  if (testsDrift == null) return null
  driftPaths.push(...testsDrift)

  return driftPaths
}

function isProjectRelativePath(filePath: string): boolean {
  if (!filePath.trim()) return false
  if (path.isAbsolute(filePath)) return false
  if (/^[A-Za-z]:[\\/]/.test(filePath)) return false
  const normalized = path.posix.normalize(filePath.replace(/\\/g, '/'))
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    return false
  }
  return true
}

export function validateBeadExpansion(subsetBeads: BeadSubset[], expandedBeads: Bead[]): string[] {
  if (expandedBeads.length !== subsetBeads.length) {
    throw new Error(`Expanded bead count ${expandedBeads.length} does not match refined blueprint count ${subsetBeads.length}`)
  }

  const idToIndex = new Map(expandedBeads.map((bead, index) => [bead.id, index] as const))
  const repairWarnings: string[] = []

  for (const [index, bead] of expandedBeads.entries()) {
    const subset = subsetBeads[index]
    if (!subset) {
      throw new Error(`Expanded bead at index ${index} has no matching refined blueprint bead`)
    }

    const preservedFieldDrift = collectPreservedFieldDrift(subset, bead)
    if (preservedFieldDrift == null) {
      throw new Error(`Expanded bead at index ${index} changed preserved Part 1 fields or order`)
    }
    if (preservedFieldDrift.length > 0) {
      repairWarnings.push(
        `Restored preserved Part 1 narrative fields from the refined blueprint for expanded bead at index ${index} (${subset.id}) after punctuation/whitespace-only drift in: ${preservedFieldDrift.join(', ')}.`,
      )
    }

    if (!bead.issueType.trim()) {
      throw new Error(`Expanded bead ${bead.id} is missing issueType`)
    }

    if (!Array.isArray(bead.labels) || bead.labels.length === 0 || bead.labels.some((label) => !label.trim())) {
      throw new Error(`Expanded bead ${bead.id} must include at least one non-empty label`)
    }

    if (!Array.isArray(bead.targetFiles) || bead.targetFiles.length === 0) {
      throw new Error(`Expanded bead ${bead.id} must include at least one target file`)
    }

    for (const targetFile of bead.targetFiles) {
      if (!isProjectRelativePath(targetFile)) {
        throw new Error(`Expanded bead ${bead.id} has invalid target file path "${targetFile}"`)
      }
    }

    for (const dependencyId of bead.dependencies.blocked_by) {
      const dependencyIndex = idToIndex.get(dependencyId)
      if (dependencyIndex == null) {
        throw new Error(`Expanded bead ${bead.id} depends on unknown bead ${dependencyId}`)
      }
      if (dependencyIndex >= index) {
        throw new Error(`Expanded bead ${bead.id} is blocked by later bead ${dependencyId}`)
      }
    }
  }

  return repairWarnings
}

export function hydrateExpandedBeads(
  subsetBeads: BeadSubset[],
  expandedBeads: BeadExpansionCandidate[],
  externalRef: string = '',
): Bead[] {
  const now = new Date().toISOString()
  const blocksById = new Map<string, string[]>()

  for (const bead of expandedBeads) {
    blocksById.set(bead.id, [])
  }

  for (const bead of expandedBeads) {
    for (const dependencyId of bead.dependencies.blocked_by) {
      blocksById.set(dependencyId, [...(blocksById.get(dependencyId) ?? []), bead.id])
    }
  }

  return subsetBeads.map((subset, index) => {
    const expanded = expandedBeads[index]
    if (!expanded) {
      throw new Error(`Missing expanded bead fields for refined blueprint bead ${subset.id}`)
    }

    return {
      ...subset,
      id: expanded.id,
      priority: index + 1,
      status: 'pending' as const,
      issueType: expanded.issueType,
      externalRef,
      labels: expanded.labels,
      dependencies: {
        blocked_by: [...expanded.dependencies.blocked_by],
        blocks: [...(blocksById.get(expanded.id) ?? [])],
      },
      targetFiles: [...expanded.targetFiles],
      notes: '',
      iteration: 1,
      createdAt: now,
      updatedAt: now,
      completedAt: '',
      startedAt: '',
      beadStartCommit: null,
    }
  })
}
