import { describe, expect, it } from 'vitest'
import { getSupplementalArtifacts } from '../supplementalArtifacts'

describe.concurrent('getSupplementalArtifacts', () => {
  it('describes the two-step beads finalization flow during REFINING_BEADS', () => {
    expect(getSupplementalArtifacts('REFINING_BEADS')).toContainEqual(
      expect.objectContaining({
        id: 'final-beads-draft',
        description: 'Semantic blueprint consolidated from the winning draft with the strongest ideas from the losing drafts.',
      }),
    )
  })

  it('describes the coverage-stage beads artifact as review plus final expansion', () => {
    expect(getSupplementalArtifacts('VERIFYING_BEADS_COVERAGE')).toContainEqual(
      expect.objectContaining({
        id: 'refined-beads',
        description: 'Latest blueprint candidate under coverage review, then expanded into execution-ready beads before approval.',
      }),
    )
  })
})
