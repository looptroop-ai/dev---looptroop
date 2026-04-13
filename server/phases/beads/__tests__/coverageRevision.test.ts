import jsYaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { validateBeadsCoverageRevisionOutput } from '../coverageRevision'

function buildBeadsContent() {
  return jsYaml.dump({
    beads: [{
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
    }],
    changes: [],
  }, { lineWidth: 120, noRefs: true }) as string
}

describe.concurrent('beads coverage revision parsing', () => {
  it('infers a missing beads coverage affected_items item_type from a unique bead id', () => {
    const coverageGap = 'Keep the attribution bead visible in the saved metadata.'
    const currentCandidateContent = buildBeadsContent()
    const revised = jsYaml.load(currentCandidateContent) as Record<string, unknown>

    revised.gap_resolutions = [{
      gap: coverageGap,
      action: 'already_covered',
      rationale: 'The existing bead already preserves the needed attribution handling.',
      affected_items: [{
        id: 'bead-1',
        label: 'Validate refinement attribution',
      }],
    }]

    const result = validateBeadsCoverageRevisionOutput(
      jsYaml.dump(revised, { lineWidth: 120, noRefs: true }) as string,
      {
        currentCandidateContent,
        coverageGaps: [coverageGap],
      },
    )

    expect(result.repairApplied).toBe(true)
    expect(result.repairWarnings.join('\n')).toContain('Inferred missing beads coverage affected_items item_type')
    expect(result.gapResolutions[0]?.affectedItems).toEqual([
      {
        itemType: 'bead',
        id: 'bead-1',
        label: 'Validate refinement attribution',
      },
    ])
  })
})
