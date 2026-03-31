import { describe, expect, it } from 'vitest'
import { expandBeads, validateBeadExpansion } from '../expand'
import type { Bead, BeadSubset } from '../types'

function buildSubsetBeads(): BeadSubset[] {
  return [
    {
      id: 'bead-1',
      title: 'Validate refinement attribution',
      prdRefs: ['EPIC-1 / US-1'],
      description: 'Preserve explicit inspiration in refinement diffs.',
      contextGuidance: {
        patterns: ['Keep repairs deterministic.'],
        anti_patterns: ['Do not widen the repair scope unnecessarily.'],
      },
      acceptanceCriteria: ['Validate attribution survives refinement'],
      tests: ['Shared tests cover refinement attribution'],
      testCommands: ['npm run test:server'],
    },
    {
      id: 'bead-2',
      title: 'Surface retry metadata',
      prdRefs: ['EPIC-1 / US-2'],
      description: 'Surface refinement retry metadata in the diff viewer.',
      contextGuidance: {
        patterns: ['Keep attribution deterministic.'],
        anti_patterns: ['Do not remove inspiration metadata.'],
      },
      acceptanceCriteria: ['Show retry metadata alongside refinement diffs'],
      tests: ['UI tests show the correct inspiration tooltip'],
      testCommands: ['npm run test:client'],
    },
  ]
}

function buildExpandedBeads(subsets: BeadSubset[] = buildSubsetBeads()): Bead[] {
  return expandBeads(subsets, 'PROJ-1').map((bead, index) => ({
    ...bead,
    id: `proj-1-bead-${index + 1}`,
    issueType: 'task',
    labels: [`ticket:PROJ-1`, `story:US-${index + 1}`],
    dependencies: {
      blocked_by: index === 0 ? [] : [`proj-1-bead-${index}`],
      blocks: [],
    },
    targetFiles: [index === 0 ? 'src/first.ts' : 'src/second.ts'],
  }))
}

describe('validateBeadExpansion', () => {
  it('accepts punctuation and whitespace-only drift in narrative preserved fields', () => {
    const subsets = buildSubsetBeads()
    const expanded = buildExpandedBeads(subsets)
    expanded[0] = {
      ...expanded[0]!,
      title: '  Validate refinement attribution!  ',
      description: 'Preserve explicit   inspiration in refinement diffs!',
      contextGuidance: {
        patterns: ['Keep repairs deterministic'],
        anti_patterns: ['  Do not widen the repair scope unnecessarily! '],
      },
      acceptanceCriteria: [' Validate attribution survives refinement. '],
      tests: ['Shared tests   cover refinement attribution!'],
    }

    const warnings = validateBeadExpansion(subsets, expanded)

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('bead at index 0')
    expect(warnings[0]).toContain('contextGuidance.patterns[0]')
    expect(warnings[0]).toContain('tests[0]')
  })

  it('still fails when prdRefs change', () => {
    const subsets = buildSubsetBeads()
    const expanded = buildExpandedBeads(subsets)
    expanded[0] = {
      ...expanded[0]!,
      prdRefs: ['EPIC-9 / US-9'],
    }

    expect(() => validateBeadExpansion(subsets, expanded)).toThrow(
      'Expanded bead at index 0 changed preserved Part 1 fields or order',
    )
  })

  it('still fails when testCommands change', () => {
    const subsets = buildSubsetBeads()
    const expanded = buildExpandedBeads(subsets)
    expanded[0] = {
      ...expanded[0]!,
      testCommands: ['npm run test:server -- --watch=false'],
    }

    expect(() => validateBeadExpansion(subsets, expanded)).toThrow(
      'Expanded bead at index 0 changed preserved Part 1 fields or order',
    )
  })

  it('still fails when beads are reordered', () => {
    const subsets = buildSubsetBeads()
    const expanded = buildExpandedBeads(subsets).reverse()

    expect(() => validateBeadExpansion(subsets, expanded)).toThrow(
      'Expanded bead at index 0 changed preserved Part 1 fields or order',
    )
  })

  it('still fails on substantive narrative rewrites', () => {
    const subsets = buildSubsetBeads()
    const expanded = buildExpandedBeads(subsets)
    expanded[0] = {
      ...expanded[0]!,
      description: 'Rewrite the refinement pipeline around a new metadata transport.',
    }

    expect(() => validateBeadExpansion(subsets, expanded)).toThrow(
      'Expanded bead at index 0 changed preserved Part 1 fields or order',
    )
  })
})
