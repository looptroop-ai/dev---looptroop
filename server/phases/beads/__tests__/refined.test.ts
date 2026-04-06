import { describe, expect, it } from 'vitest'
import { validateBeadsRefinementOutput } from '../refined'

function buildBeadsRefinementContent(options: {
  beadOneDescription?: string
  beadTwoDescription?: string
  includeChanges?: boolean
} = {}): string {
  const content = [
    'beads:',
    '  - id: "bead-1"',
    '    title: "Keep existing switcher bead"',
    '    prdRefs: ["EPIC-1", "US-1"]',
    `    description: "${options.beadOneDescription ?? 'Leave the switcher bead unchanged.'}"`,
    '    contextGuidance:',
    '      patterns:',
    '        - "Reuse the current theme switcher."',
    '      anti_patterns:',
    '        - "Do not redesign the menu."',
    '    acceptanceCriteria:',
    '      - "Keep the switcher bead unchanged."',
    '    tests:',
    '      - "Test the unchanged switcher bead."',
    '    testCommands:',
    '      - "npm test -- AppShell"',
    '  - id: "bead-2"',
    '    title: "Update persistence coverage"',
    '    prdRefs: ["EPIC-1", "US-2"]',
    `    description: "${options.beadTwoDescription ?? 'Refresh the persistence coverage details.'}"`,
    '    contextGuidance:',
    '      patterns:',
    '        - "Reuse the existing persistence path."',
    '      anti_patterns:',
    '        - "Do not change the storage key."',
    '    acceptanceCriteria:',
    '      - "Keep persistence coverage explicit."',
    '    tests:',
    '      - "Test persistence coverage."',
    '    testCommands:',
    '      - "npm test -- UIContext"',
  ]

  if (options.includeChanges) {
    content.push(
      'changes:',
      '  - type: modified',
      '    item_type: bead',
      '    before:',
      '      id: "bead-2"',
      '      label: "Update persistence coverage"',
      '      detail: "Refresh the persistence coverage details."',
      '    after:',
      '      id: "bead-2"',
      '      label: "Update persistence coverage"',
      '      detail: "Refresh the persistence coverage details with storage-shape verification."',
    )
  }

  return content.join('\n')
}

describe.concurrent('beads refinement validation', () => {
  it('does not synthesize a title-match modified change when the winner and refined bead are identical', () => {
    const winnerDraftContent = buildBeadsRefinementContent()
    const refinedContent = buildBeadsRefinementContent({
      beadTwoDescription: 'Refresh the persistence coverage details with storage-shape verification.',
      includeChanges: true,
    })

    const result = validateBeadsRefinementOutput(refinedContent, {
      winnerDraftContent,
    })

    expect(result.changes).toHaveLength(1)
    expect(result.changes).toEqual([
      expect.objectContaining({
        type: 'modified',
        before: expect.objectContaining({ id: 'bead-2' }),
        after: expect.objectContaining({ id: 'bead-2' }),
      }),
    ])
    expect(result.changes.find((change) => change.before?.id === 'bead-1' || change.after?.id === 'bead-1')).toBeUndefined()
    expect(result.repairWarnings.join('\n')).not.toContain('bead "bead-1"')
  })
})
