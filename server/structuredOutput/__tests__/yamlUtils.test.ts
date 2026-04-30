import { describe, expect, it } from 'vitest'
import { buildStructuredRetryPrompt, parseYamlOrJsonCandidate } from '../yamlUtils'

describe.concurrent('buildStructuredRetryPrompt', () => {
  it('keeps retry prompts focused on schema correction only', () => {
    const prompt = buildStructuredRetryPrompt([], {
      validationError: 'missing schema_version',
      rawResponse: 'draft: nope',
    })

    expect(prompt[0]?.content).toContain('## Structured Output Retry')
    expect(prompt[0]?.content).toContain('missing schema_version')
    expect(prompt[0]?.content).not.toContain('Do not use tools.')
  })
})

describe.concurrent('parseYamlOrJsonCandidate', () => {
  it('repairs inline sequence parents before YAML can accept them as plain scalars', () => {
    const repairWarnings: string[] = []

    const parsed = parseYamlOrJsonCandidate(
      'questions: - id: Q01 phase: foundation question: What behavior should the API expose?',
      { repairWarnings },
    ) as {
      questions: Array<{ id: string; phase: string; question: string }>
    }

    expect(repairWarnings).toContain('Repaired inline YAML sequence or mapping syntax before parsing.')
    expect(parsed.questions).toEqual([
      {
        id: 'Q01',
        phase: 'foundation',
        question: 'What behavior should the API expose?',
      },
    ])
  })

  it('quotes header-like list scalars before YAML can accept them as mappings', () => {
    const repairWarnings: string[] = []

    const parsed = parseYamlOrJsonCandidate([
      'api_contracts:',
      '  - Content-Disposition: attachment; filename=synonyms.json',
      'gap_resolutions:',
      '  - gap: keep bead references typed',
      '    action: already_covered',
    ].join('\n'), { repairWarnings }) as {
      api_contracts: string[]
      gap_resolutions: Array<{ gap: string; action: string }>
    }

    expect(repairWarnings).toContain('Quoted YAML plain scalar values containing colon-space before reparsing.')
    expect(parsed.api_contracts).toEqual([
      'Content-Disposition: attachment; filename=synonyms.json',
    ])
    expect(parsed.gap_resolutions[0]).toEqual({
      gap: 'keep bead references typed',
      action: 'already_covered',
    })
  })

  it('repairs doubled single-quote wrappers around colon-containing list scalars', () => {
    const repairWarnings: string[] = []

    const parsed = parseYamlOrJsonCandidate([
      'api_contracts:',
      "  - ''Response includes Content-Disposition: attachment; filename=synonyms.json''",
    ].join('\n'), { repairWarnings }) as {
      api_contracts: string[]
    }

    expect(repairWarnings).toContain('Repaired improperly quoted YAML scalar value.')
    expect(parsed.api_contracts).toEqual([
      'Response includes Content-Disposition: attachment; filename=synonyms.json',
    ])
  })

  it('recovers combined quoted-scalar and colon-scalar near misses in one pass', () => {
    const command = 'node -e "const fs=require(\'fs\');console.error(\'Missing pink tokens: \'+[\'accent\'].join(\',\'))"'
    const repairWarnings: string[] = []

    const parsed = parseYamlOrJsonCandidate([
      'beads:',
      '  - id: bead-1',
      '    title: Preserve visible text across combined parser repairs',
      '    prdRefs:',
      '      - EPIC-1 / US-1',
      '    description: Recover multiple safe YAML near-misses without changing their meaning.',
      '    contextGuidance:',
      '      patterns:',
      '        - Keep parser repairs text-preserving.',
      '      anti_patterns:',
      '        - Do not invent missing fields.',
      '    acceptanceCriteria:',
      "      - 'pink' is accepted as a valid theme value in UIState.",
      '      - Parser preserves the original visible scalar text.',
      '    tests:',
      '      - Combined parser regression covers malformed quoted list items plus command scalars.',
      '    testCommands:',
      `      - ${command}`,
    ].join('\n'), { repairWarnings }) as {
      beads: Array<{
        acceptanceCriteria: string[]
        testCommands: string[]
      }>
    }

    expect(repairWarnings).toContain('Repaired improperly quoted YAML scalar value.')
    expect(parsed.beads[0]?.acceptanceCriteria).toEqual([
      '\'pink\' is accepted as a valid theme value in UIState.',
      'Parser preserves the original visible scalar text.',
    ])
    expect(parsed.beads[0]?.testCommands).toEqual([command])
  })

  it('recovers quoted block-scalar indicators while preserving the emitted body text', () => {
    const repairWarnings: string[] = []

    const parsed = parseYamlOrJsonCandidate([
      'beads:',
      '  - id: bead-1',
      '    title: Recover quoted block scalar indicator',
      '    prdRefs:',
      '      - EPIC-1 / US-1',
      '    description: "|-"',
      '      Edit ui/src/scss/_vars.scss and replace the default token.',
      '      Preserve the emitted body text exactly.',
      '    contextGuidance:',
      '      patterns:',
      '        - Keep parser repairs text-preserving.',
      '      anti_patterns:',
      '        - Do not invent missing fields.',
      '    acceptanceCriteria:',
      '      - Parser accepts the repaired block scalar.',
      '    tests:',
      '      - Structured output parser covers the malformed indicator.',
      '    testCommands:',
      '      - npm run test:server',
    ].join('\n'), { repairWarnings }) as {
      beads: Array<{
        description: string
      }>
    }

    expect(repairWarnings).toContain('Repaired improperly quoted YAML scalar value.')
    expect(parsed.beads[0]?.description).toBe([
      'Edit ui/src/scss/_vars.scss and replace the default token.',
      'Preserve the emitted body text exactly.',
    ].join('\n'))
  })
})
