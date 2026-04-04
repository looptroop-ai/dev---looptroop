import { describe, expect, it } from 'vitest'
import { getSupplementalArtifacts } from '../supplementalArtifacts'

describe.concurrent('getSupplementalArtifacts', () => {
  it('describes the two-step beads finalization flow during REFINING_BEADS', () => {
    expect(getSupplementalArtifacts('REFINING_BEADS')).toContainEqual(
      expect.objectContaining({
        id: 'final-beads-draft',
        description: 'Part 1 merges the strongest ideas from losing drafts into the winning blueprint. Part 2 expands the refined plan into execution-ready beads by adding IDs, issue types, labels, dependencies, and target files, while the app attaches companion metadata.',
      }),
    )
  })
})
