import { describe, expect, it } from 'vitest'
import jsYaml from 'js-yaml'
import { repairYamlDuplicateKeys, repairYamlFreeTextScalars, repairYamlIndentation, repairYamlInlineKeys, repairYamlListDashSpace, repairYamlNestedMappingChildren, repairYamlPlainScalarColons, repairYamlQuotedScalarFragments, repairYamlReservedIndicatorScalars, repairYamlSequenceEntryIndent, repairYamlUnclosedQuotes, stripCodeFences } from '../yamlRepair'

describe.concurrent('repairYamlListDashSpace', () => {
  it.each([
    ['correctly formatted list items', ['questions:', '  - id: Q01', '    phase: Foundation', '    question: "What problem are we solving?"'].join('\n')],
    ['top-level mapping keys', ['file_count: 2', 'files:', '  - path: a.ts'].join('\n')],
  ])('passes through %s unchanged', (_, yaml) => {
    expect(repairYamlListDashSpace(yaml)).toBe(yaml)
  })

  it.each([
    [
      'first list item with parent key',
      ['questions:', '  -id: Q01', '    phase: Foundation', '    question: "What problem are we solving?"'].join('\n'),
      ['questions:', '  - id: Q01', '    phase: Foundation', '    question: "What problem are we solving?"'].join('\n'),
    ],
    [
      'any field name, not just id',
      ['  -phase: Foundation', '  -question: "What?"', '  -rationale: "Because"', '  -path: server/app.ts'].join('\n'),
      ['  - phase: Foundation', '  - question: "What?"', '  - rationale: "Because"', '  - path: server/app.ts'].join('\n'),
    ],
    [
      'mixed correct and incorrect items',
      ['questions:', '  -id: Q01', '    phase: Foundation', '  - id: Q02', '    phase: Structure'].join('\n'),
      ['questions:', '  - id: Q01', '    phase: Foundation', '  - id: Q02', '    phase: Structure'].join('\n'),
    ],
    [
      'top-level list with missing dash space',
      ['-id: Q01', '  phase: Foundation'].join('\n'),
      ['- id: Q01', '  phase: Foundation'].join('\n'),
    ],
  ])('inserts space after dash — %s', (_, input, expected) => {
    expect(repairYamlListDashSpace(input)).toBe(expected)
  })

  it('produces valid YAML after repair', () => {
    const input = ['questions:', '  -id: Q01', '    phase: Foundation', '    question: "What problem are we solving?"', '  - id: Q02', '    phase: Structure', '    question: "What features are needed?"'].join('\n')
    const repaired = repairYamlListDashSpace(input)
    const parsed = jsYaml.load(repaired) as { questions: { id: string; phase: string; question: string }[] }
    expect(parsed.questions).toHaveLength(2)
    expect(parsed.questions[0]!.id).toBe('Q01')
    expect(parsed.questions[1]!.id).toBe('Q02')
  })
})

describe('repairYamlIndentation', () => {
  it.each([
    ['correctly indented YAML', ['questions:', '  - id: Q01', '    phase: Foundation', '    question: "What problem are we solving?"', '  - id: Q02', '    phase: Structure', '    question: "Which users should we support?"'].join('\n')],
    ['nested lists', ['items:', '  - id: Q01', '    tags:', '      - alpha', '      - beta', '    question: "Nested test?"'].join('\n')],
  ])('passes through %s unchanged', (_, yaml) => {
    expect(repairYamlIndentation(yaml)).toBe(yaml)
  })

  it.each([
    [
      '3-space indent to 4-space',
      ['questions:', '  - id: Q01', '   phase: Foundation', '   question: "What problem are we solving?"'].join('\n'),
      ['questions:', '  - id: Q01', '    phase: Foundation', '    question: "What problem are we solving?"'].join('\n'),
    ],
    [
      'mixed indent across multiple items',
      ['questions:', '  - id: Q01', '    phase: Foundation', '    question: "First question?"', '  - id: Q02', '   phase: Structure', '   question: "Second question?"', '  - id: Q03', '     phase: Assembly', '     question: "Third question?"'].join('\n'),
      ['questions:', '  - id: Q01', '    phase: Foundation', '    question: "First question?"', '  - id: Q02', '    phase: Structure', '    question: "Second question?"', '  - id: Q03', '    phase: Assembly', '    question: "Third question?"'].join('\n'),
    ],
    [
      'top-level list items',
      ['- id: Q01', ' phase: Foundation', ' question: "Top-level list?"'].join('\n'),
      ['- id: Q01', '  phase: Foundation', '  question: "Top-level list?"'].join('\n'),
    ],
  ])('normalizes %s', (_, input, expected) => {
    expect(repairYamlIndentation(input)).toBe(expected)
  })
})

describe('repairYamlNestedMappingChildren', () => {
  it('passes through valid nested mappings unchanged', () => {
    const yaml = [
      'generated_by:',
      '  winner_model: openai/gpt-5.4',
      '  generated_at: "2026-03-25T18:20:00Z"',
      'questions:',
      '  - id: Q01',
    ].join('\n')

    expect(repairYamlNestedMappingChildren(yaml, {
      generated_by: ['winner_model', 'generated_at', 'canonicalization'],
    })).toBe(yaml)
  })

  it('repairs dedented known child keys under a bare wrapper key', () => {
    const input = [
      'generated_by:',
      'winner_model: openai/gpt-5.4',
      'generated_at: "2026-03-25T18:20:00Z"',
      'canonicalization: server_normalized',
      'questions:',
      '  - id: Q01',
    ].join('\n')

    const expected = [
      'generated_by:',
      '  winner_model: openai/gpt-5.4',
      '  generated_at: "2026-03-25T18:20:00Z"',
      '  canonicalization: server_normalized',
      'questions:',
      '  - id: Q01',
    ].join('\n')

    expect(repairYamlNestedMappingChildren(input, {
      generated_by: ['winner_model', 'generated_at', 'canonicalization'],
    })).toBe(expected)
  })

  it('stops before an unknown sibling mapping key', () => {
    const input = [
      'generated_by:',
      'winner_model: openai/gpt-5.4',
      'questions:',
      '  - id: Q01',
    ].join('\n')

    const expected = [
      'generated_by:',
      '  winner_model: openai/gpt-5.4',
      'questions:',
      '  - id: Q01',
    ].join('\n')

    expect(repairYamlNestedMappingChildren(input, {
      generated_by: ['winner_model', 'generated_at'],
    })).toBe(expected)
  })

  it('preserves block scalars and list continuations under repaired child keys', () => {
    const input = [
      'answer:',
      'skipped: false',
      'selected_option_ids:',
      '- opt1',
      '- opt2',
      'free_text: >-',
      '  Risk-first planning matters.',
      'answered_by: ai_skip',
      'answered_at: "2026-03-25T18:20:00Z"',
      'questions:',
      '  - id: Q01',
    ].join('\n')

    const repaired = repairYamlNestedMappingChildren(input, {
      answer: ['skipped', 'selected_option_ids', 'free_text', 'answered_by', 'answered_at'],
    })

    expect(repaired).toBe([
      'answer:',
      '  skipped: false',
      '  selected_option_ids:',
      '    - opt1',
      '    - opt2',
      '  free_text: >-',
      '    Risk-first planning matters.',
      '  answered_by: ai_skip',
      '  answered_at: "2026-03-25T18:20:00Z"',
      'questions:',
      '  - id: Q01',
    ].join('\n'))

    const parsed = jsYaml.load(repaired) as {
      answer: {
        skipped: boolean
        selected_option_ids: string[]
        free_text: string
        answered_by: string
        answered_at: string
      }
    }
    expect(parsed.answer.selected_option_ids).toEqual(['opt1', 'opt2'])
    expect(parsed.answer.free_text).toBe('Risk-first planning matters.')
  })

  it('does not guess unknown child keys into nested mappings', () => {
    const input = [
      'generated_by:',
      'winner_model: openai/gpt-5.4',
      'extra_field: not whitelisted',
    ].join('\n')

    const repaired = repairYamlNestedMappingChildren(input, {
      generated_by: ['winner_model', 'generated_at'],
    })

    expect(repaired).toBe([
      'generated_by:',
      '  winner_model: openai/gpt-5.4',
      'extra_field: not whitelisted',
    ].join('\n'))
  })
})

describe('stripCodeFences', () => {
  it.each([
    ['yaml', '```yaml\nquestions:\n  - id: Q01\n```', 'questions:\n  - id: Q01'],
    ['yml', '```yml\nkey: value\n```', 'key: value'],
    ['json', '```json\n{"key": "value"}\n```', '{"key": "value"}'],
    ['jsonl', '```jsonl\n{"a":1}\n{"b":2}\n```', '{"a":1}\n{"b":2}'],
    ['bare (no language tag)', '```\nquestions:\n  - id: Q01\n```', 'questions:\n  - id: Q01'],
    ['leading/trailing whitespace', '  \n```yaml\nquestions:\n  - id: Q01\n```  \n  ', 'questions:\n  - id: Q01'],
    ['internal indentation', '```yaml\nquestions:\n  - id: Q01\n    phase: foundation\n    question: "What?"\n```', 'questions:\n  - id: Q01\n    phase: foundation\n    question: "What?"'],
  ])('strips %s wrapper', (_tag, input, expected) => {
    expect(stripCodeFences(input)).toBe(expected)
  })

  it.each([
    ['no fences present', 'questions:\n  - id: Q01'],
    ['only opening fence', '```yaml\nquestions:\n  - id: Q01'],
    ['only closing fence', 'questions:\n  - id: Q01\n```'],
    ['fences mid-content', ['questions:', '  - id: Q01', '    question: "See this code:"', '```yaml', 'example: true', '```', '  - id: Q02'].join('\n')],
  ])('returns unchanged when %s', (_label, input) => {
    expect(stripCodeFences(input)).toBe(input)
  })
})

describe('repairYamlDuplicateKeys', () => {
  it('removes consecutive exact duplicate key-value', () => {
    const input = [
      'files:',
      '  - path: server/workflow/executionEngine.ts',
      '    rationale: "The execution engine drives phase orchestration."',
      '    relevance: high',
      '    likely_action: modify',
      '    likely_action: modify',
      '    content_preview: |',
      '      class ExecutionEngine {',
      '      }',
    ].join('\n')

    const expected = [
      'files:',
      '  - path: server/workflow/executionEngine.ts',
      '    rationale: "The execution engine drives phase orchestration."',
      '    relevance: high',
      '    likely_action: modify',
      '    content_preview: |',
      '      class ExecutionEngine {',
      '      }',
    ].join('\n')

    expect(repairYamlDuplicateKeys(input)).toBe(expected)
    // Verify repaired output parses
    const parsed = jsYaml.load(repairYamlDuplicateKeys(input)) as { files: { likely_action?: string }[] }
    expect(parsed.files[0]!.likely_action).toBe('modify')
  })

  it('does NOT remove duplicate key with different values', () => {
    const input = [
      '    likely_action: modify',
      '    likely_action: read',
    ].join('\n')

    expect(repairYamlDuplicateKeys(input)).toBe(input)
  })

  it('removes duplicate mapping blocks together with their nested lines', () => {
    const input = [
      'questions:',
      '  - id: Q25',
      '    answer_type: single_choice',
      '    options:',
      '      - id: opt1',
      '        label: "Strict signatures, no allowlist"',
      '      - id: opt2',
      '        label: "Strict signatures with allowlist"',
      '      - id: opt3',
      '        label: "Conservative low-false-positive only"',
      '      - id: opt4',
      '        label: "Warn only, never block"',
      '    options:',
      '      - id: opt1',
      '        label: "Strict signatures, no allowlist"',
      '      - id: opt2',
      '        label: "Strict signatures with allowlist"',
      '      - id: opt3',
      '        label: "Conservative low-false-positive only"',
      '      - id: opt4',
      '        label: "Warn only, never block"',
    ].join('\n')

    const expected = [
      'questions:',
      '  - id: Q25',
      '    answer_type: single_choice',
      '    options:',
      '      - id: opt1',
      '        label: "Strict signatures, no allowlist"',
      '      - id: opt2',
      '        label: "Strict signatures with allowlist"',
      '      - id: opt3',
      '        label: "Conservative low-false-positive only"',
      '      - id: opt4',
      '        label: "Warn only, never block"',
    ].join('\n')

    expect(repairYamlDuplicateKeys(input)).toBe(expected)

    const parsed = jsYaml.load(repairYamlDuplicateKeys(input)) as {
      questions: Array<{ options?: Array<{ id: string; label: string }> }>
    }
    expect(parsed.questions[0]!.options).toHaveLength(4)
    expect(parsed.questions[0]!.options?.map((option) => option.id)).toEqual(['opt1', 'opt2', 'opt3', 'opt4'])
  })

})

describe('repairYamlFreeTextScalars', () => {
  it.each([
    {
      label: 'begin with backticks',
      input: ['answer:', '  free_text: `language` comes from the file extension', '  answered_by: user'].join('\n'),
      expectedContains: 'free_text: "`language` comes from the file extension"',
      expectedValue: '`language` comes from the file extension',
      inputShouldThrow: true,
    },
    {
      label: 'containing colon-space',
      input: ['answer:', '  free_text: Log type: structured execution trace', '  answered_by: user'].join('\n'),
      expectedContains: 'free_text: "Log type: structured execution trace"',
      expectedValue: 'Log type: structured execution trace',
      inputShouldThrow: false,
    },
  ])('quotes plain free_text values that $label', ({ input, expectedContains, expectedValue, inputShouldThrow }) => {
    if (inputShouldThrow) expect(() => jsYaml.load(input)).toThrow()
    const repaired = repairYamlFreeTextScalars(input)
    expect(repaired).toContain(expectedContains)
    const parsed = jsYaml.load(repaired) as { answer: { free_text: string } }
    expect(parsed.answer.free_text).toBe(expectedValue)
  })

  it('preserves block-scalar free_text values unchanged', () => {
    const input = [
      'answer:',
      '  free_text: |-',
      '    `language` comes from the file extension',
      '    log type: structured execution trace',
      '  answered_by: user',
    ].join('\n')

    expect(repairYamlFreeTextScalars(input)).toBe(input)
  })

  it('converts malformed multiline single-quoted free_text values into block scalars', () => {
    const input = [
      'answer:',
      "  free_text: 'No human approval checkpoint. Strategy generation and validation should",
      '    happen automatically between PRD approval and bead drafting. This follows the',
      '    user\'s non-goal of "Add human approval step" and keeps the phase deterministic.\'',
      '  answered_by: ai_skip',
    ].join('\n')

    const repaired = repairYamlFreeTextScalars(input)
    expect(repaired).toContain('free_text: |-')

    const parsed = jsYaml.load(repaired) as { answer: { free_text: string; answered_by: string } }
    expect(parsed.answer.free_text).toContain('No human approval checkpoint.')
    expect(parsed.answer.free_text).toContain('user\'s non-goal of "Add human approval step"')
    expect(parsed.answer.answered_by).toBe('ai_skip')
  })
})

describe('repairYamlQuotedScalarFragments', () => {
  it('repairs list scalars with a leading quoted fragment and trailing text', () => {
    const input = [
      'acceptanceCriteria:',
      "  - 'pink' is accepted as a valid theme value in UIState.",
    ].join('\n')

    const repaired = repairYamlQuotedScalarFragments(input)
    expect(repaired).toBe([
      'acceptanceCriteria:',
      '  - "\'pink\' is accepted as a valid theme value in UIState."',
    ].join('\n'))

    const parsed = jsYaml.load(repaired) as { acceptanceCriteria: string[] }
    expect(parsed.acceptanceCriteria).toEqual([
      '\'pink\' is accepted as a valid theme value in UIState.',
    ])
  })

  it('repairs mapping values with the same malformed quoted-fragment pattern', () => {
    const input = 'description: "pink" remains a supported theme in UIState.'
    const repaired = repairYamlQuotedScalarFragments(input)

    expect(repaired).toBe('description: "\\"pink\\" remains a supported theme in UIState."')

    const parsed = jsYaml.load(repaired) as { description: string }
    expect(parsed.description).toBe('"pink" remains a supported theme in UIState.')
  })

  it('preserves inner quotes and trailing comments when wrapping the full scalar', () => {
    const input = 'description: "pink" remains the "marketing" label in UIState. # preserve comment'
    const repaired = repairYamlQuotedScalarFragments(input)

    expect(repaired).toBe('description: "\\"pink\\" remains the \\"marketing\\" label in UIState." # preserve comment')

    const parsed = jsYaml.load(repaired) as { description: string }
    expect(parsed.description).toBe('"pink" remains the "marketing" label in UIState.')
  })

  it('leaves already-valid fully quoted scalars unchanged', () => {
    const input = 'description: "\'pink\' is accepted as a valid theme value in UIState."'
    expect(repairYamlQuotedScalarFragments(input)).toBe(input)
  })

  it('unquotes block-scalar indicators when deeper-indented continuation lines follow', () => {
    const input = [
      'beads:',
      '  - id: bead-1',
      '    description: "|-"',
      '      Edit ui/src/scss/_vars.scss and replace the default token.',
      '      Preserve the emitted body text exactly.',
      '    contextGuidance:',
      '      patterns:',
      '        - Keep parser repairs text-preserving.',
      '      anti_patterns:',
      '        - Do not invent missing fields.',
    ].join('\n')

    const repaired = repairYamlQuotedScalarFragments(input)
    expect(repaired).toBe([
      'beads:',
      '  - id: bead-1',
      '    description: |-',
      '      Edit ui/src/scss/_vars.scss and replace the default token.',
      '      Preserve the emitted body text exactly.',
      '    contextGuidance:',
      '      patterns:',
      '        - Keep parser repairs text-preserving.',
      '      anti_patterns:',
      '        - Do not invent missing fields.',
    ].join('\n'))

    const parsed = jsYaml.load(repaired) as {
      beads: Array<{ description: string }>
    }
    expect(parsed.beads[0]?.description).toBe([
      'Edit ui/src/scss/_vars.scss and replace the default token.',
      'Preserve the emitted body text exactly.',
    ].join('\n'))
  })

  it('leaves quoted block-scalar indicators unchanged when no deeper continuation lines follow', () => {
    const input = [
      'description: "|-"',
      'contextGuidance: keep-literal',
    ].join('\n')

    expect(repairYamlQuotedScalarFragments(input)).toBe(input)
  })
})

describe('repairYamlPlainScalarColons', () => {
  it.each([
    ['YAML without colon-space in values', ['file_count: 2', 'files:', '  - path: src/app.ts', '    rationale: Entry point for the app.', '    relevance: high'].join('\n')],
    ['already-quoted values', 'key: "hello world: foo bar"'],
  ])('passes through %s unchanged', (_, yaml) => {
    expect(repairYamlPlainScalarColons(yaml)).toBe(yaml)
  })

  it.each([
    ['containing colon-space', 'key: hello world: foo bar', 'key: "hello world: foo bar"'],
    ['ending with colon', 'key: hello world:', 'key: "hello world:"'],
  ])('quotes plain scalar values %s', (_, input, expected) => {
    expect(repairYamlPlainScalarColons(input)).toBe(expected)
  })

  it('escapes double quotes in values being wrapped', () => {
    expect(repairYamlPlainScalarColons('key: value with "quotes" and: colons')).toBe('key: "value with \\"quotes\\" and: colons"')
  })

  it('repairs list item first key with colon in value', () => {
    const yaml = ['files:', '  - path: server/machines/ticketMachine.ts', '    rationale: Many rules are state-machine rules: completion truth gates, non-completion for idle.', '    relevance: high'].join('\n')
    const repaired = repairYamlPlainScalarColons(yaml)
    expect(repaired).toContain('"Many rules are state-machine rules: completion truth gates, non-completion for idle."')
    const parsed = jsYaml.load(repaired) as { files: { rationale?: string }[] }
    expect(parsed.files[0]!.rationale).toBe('Many rules are state-machine rules: completion truth gates, non-completion for idle.')
  })

  it('repairs multi-entry list with colon-in-scalar rationale and block scalars', () => {
    const yaml = [
      'file_count: 2',
      'files:',
      '  - path: server/sse/broadcaster.ts',
      '    relevance: high',
      '    likely_action: modify',
      '    rationale: This is the live-stream backbone, and the ticket expands its responsibilities. The key symbols are broadcast(), getEventsSince(), cleanup().',
      '    content_preview: |',
      '      class SSEBroadcaster {',
      '        broadcast(): void',
      '      }',
      '  - path: server/machines/ticketMachine.ts',
      '    relevance: high',
      '    likely_action: modify',
      "    rationale: Many of the ticket's correctness rules are state-machine rules: completion truth gates, non-completion for idle/paused/interrupted, stop reasons, and authoritative transition sources.",
      '    content_preview: |',
      '      export const ticketMachine = setup({',
      '        types: { context: {} as TicketContext }',
      '      })',
    ].join('\n')
    const repaired = repairYamlPlainScalarColons(yaml)
    const parsed = jsYaml.load(repaired) as { files: { path?: string; rationale?: string }[] }
    expect(parsed.files).toHaveLength(2)
    expect(parsed.files[0]!.path).toBe('server/sse/broadcaster.ts')
    expect(parsed.files[1]!.path).toBe('server/machines/ticketMachine.ts')
    expect(parsed.files[1]!.rationale).toContain('state-machine rules: completion truth gates')
  })

  it('preserves block scalar content with colons on continuation lines', () => {
    const yaml = ['files:', '  - path: src/app.ts', '    rationale: Simple rationale.', '    content_preview: |', '      export const foo: string = "bar"', '      type Config = { mode: "dev" | "prod" }', '    relevance: high'].join('\n')
    const repaired = repairYamlPlainScalarColons(yaml)
    const parsed = jsYaml.load(repaired) as { files: { content_preview?: string }[] }
    expect(parsed.files[0]!.content_preview).toContain('foo: string')
    expect(parsed.files[0]!.content_preview).toContain('mode: "dev"')
  })

  it('handles multiple entries with mixed colon/no-colon rationales', () => {
    const yaml = ['files:', '  - path: a.ts', '    rationale: Simple rationale without colons.', '  - path: b.ts', '    rationale: Complex rules: this has colons inside.', '  - path: c.ts', '    rationale: "Already quoted: safe."'].join('\n')
    const repaired = repairYamlPlainScalarColons(yaml)
    const parsed = jsYaml.load(repaired) as { files: { rationale?: string }[] }
    expect(parsed.files).toHaveLength(3)
    expect(parsed.files[0]!.rationale).toBe('Simple rationale without colons.')
    expect(parsed.files[1]!.rationale).toBe('Complex rules: this has colons inside.')
    expect(parsed.files[2]!.rationale).toBe('Already quoted: safe.')
  })

  it('quotes list-item scalar values containing colon-space', () => {
    const yaml = ['technical_requirements:', '  architecture_constraints:', '    - Must preserve deterministic workflow transitions and backward compatibility for all tickets in progress', '    - Persisted strategy artifact path: `.looptroop/tickets/<ticket-id>/test-strategy.yaml`', '    - Schema must support inheritance: epic-level properties with story-level overrides'].join('\n')
    const repaired = repairYamlPlainScalarColons(yaml)
    const parsed = jsYaml.load(repaired) as { technical_requirements: { architecture_constraints: string[] } }
    expect(parsed.technical_requirements.architecture_constraints[1]).toBe('Persisted strategy artifact path: `.looptroop/tickets/<ticket-id>/test-strategy.yaml`')
    expect(parsed.technical_requirements.architecture_constraints[2]).toBe('Schema must support inheritance: epic-level properties with story-level overrides')
  })
})

describe('repairYamlReservedIndicatorScalars', () => {
  it.each([
    ['mapping value beginning with backticks', 'question: `repo_git_mutex` behavior?', 'question: "`repo_git_mutex` behavior?"'],
    ['mapping value beginning with @', 'owner: @loop-troop', 'owner: "@loop-troop"'],
    ['list item beginning with backticks', '  - `UIState.theme` allows pink', '  - "`UIState.theme` allows pink"'],
    ['list item beginning with @', '  - @trace/span-id', '  - "@trace/span-id"'],
  ])('quotes %s', (_, input, expected) => {
    expect(repairYamlReservedIndicatorScalars(input)).toBe(expected)
  })

  it('preserves parsed text for reserved-indicator mapping values and list items', () => {
    const yaml = [
      'technical_requirements:',
      '  data_model:',
      '    - `UIState.theme` allows `pink` as a valid value.',
      '  reliability_constraints:',
      '    - @trace/span-id must be propagated to logs.',
      'notes:',
      '  owner: @loop-troop',
    ].join('\n')

    const repaired = repairYamlReservedIndicatorScalars(yaml)
    const parsed = jsYaml.load(repaired) as {
      technical_requirements: {
        data_model: string[]
        reliability_constraints: string[]
      }
      notes: {
        owner: string
      }
    }

    expect(parsed.technical_requirements.data_model[0]).toBe('`UIState.theme` allows `pink` as a valid value.')
    expect(parsed.technical_requirements.reliability_constraints[0]).toBe('@trace/span-id must be propagated to logs.')
    expect(parsed.notes.owner).toBe('@loop-troop')
  })

  it('passes through list-item mappings, already-quoted values, block scalars, and flow values unchanged', () => {
    const yaml = [
      'items:',
      '  - id: US-1',
      '    title: "@already-safe"',
      '    question: >-',
      '      `backticks` inside a block scalar stay unchanged.',
      '  - ["@a", "@b"]',
      'mapping:',
      '  owner: "@loop-troop"',
    ].join('\n')

    expect(repairYamlReservedIndicatorScalars(yaml)).toBe(yaml)
  })
})

describe('repairYamlSequenceEntryIndent', () => {
  it.each([
    ['correctly indented YAML', ['questions:', '  - id: Q01', '    phase: Foundation', '    question: "What problem are we solving?"', '  - id: Q02', '    phase: Structure', '    question: "Which users should we support?"'].join('\n')],
    ['nested sequences', ['items:', '  - id: Q01', '    options:', '      - label: Yes', '      - label: No', '  - id: Q02', '    options:', '      - label: Alpha', '      - label: Beta'].join('\n')],
    ['block scalar content (not sequence entries)', ['items:', '  - id: Q01', '    question: |', '      - This is not a list entry', '      - Neither is this', '  - id: Q02', '    question: "Short"'].join('\n')],
  ])('passes through %s unchanged', (_, yaml) => {
    expect(repairYamlSequenceEntryIndent(yaml)).toBe(yaml)
  })

  it.each([
    [
      'dash indent drift after block scalar (LOO-19)',
      ['questions:', '- id: Q01', '    phase: foundation', '    question: >-', '        Who are the primary users or stakeholders', '        of this feature?', '  - id: Q02', '    phase: foundation', '    question: >-', '        What is the core problem?'].join('\n'),
      ['questions:', '- id: Q01', '    phase: foundation', '    question: >-', '        Who are the primary users or stakeholders', '        of this feature?', '- id: Q02', '    phase: foundation', '    question: >-', '        What is the core problem?'].join('\n'),
    ],
    [
      'drift in indented sequences',
      ['questions:', '  - id: Q01', '    phase: Foundation', '    question: "First?"', '    - id: Q02', '    phase: Structure', '    question: "Second?"'].join('\n'),
      ['questions:', '  - id: Q01', '    phase: Foundation', '    question: "First?"', '  - id: Q02', '    phase: Structure', '    question: "Second?"'].join('\n'),
    ],
    [
      'multiple top-level keys with separate sequences',
      ['questions:', '  - id: Q01', '    phase: Foundation', '   - id: Q02', '    phase: Structure', 'changes:', '  - type: modified', '    before: Q01', '   - type: added', '    before: null'].join('\n'),
      ['questions:', '  - id: Q01', '    phase: Foundation', '  - id: Q02', '    phase: Structure', 'changes:', '  - type: modified', '    before: Q01', '  - type: added', '    before: null'].join('\n'),
    ],
  ])('fixes %s', (_, input, expected) => {
    expect(repairYamlSequenceEntryIndent(input)).toBe(expected)
  })

  it('produces valid YAML after repairing LOO-19 pattern', () => {
    const input = ['questions:', '- id: Q01', '  phase: foundation', '  question: >-', '    Who are the primary users?', '  - id: Q02', '  phase: structure', '  question: "What are the main flows?"'].join('\n')
    const repaired = repairYamlSequenceEntryIndent(input)
    const parsed = jsYaml.load(repaired) as { questions: { id: string; phase: string }[] }
    expect(parsed.questions).toHaveLength(2)
    expect(parsed.questions[0]!.id).toBe('Q01')
    expect(parsed.questions[1]!.id).toBe('Q02')
  })
})

describe('repairYamlUnclosedQuotes', () => {
  it.each([
    ['properly closed quotes', ['questions:', '  - id: Q01', '    phase: foundation', '    question: "What problem are we solving?"', '  - id: Q02', '    phase: foundation', '    question: "Who are the users?"'].join('\n')],
    ['lines inside block scalars', ['  - id: Q01', '    question: >-', '      This has "unclosed quote inside block scalar', '  - id: Q02', '    question: "Next?"'].join('\n')],
    ['already-closed quotes', ['    question: "valid question?"', '    rationale: "some rationale"'].join('\n')],
  ])('does not modify %s', (_, yaml) => {
    expect(repairYamlUnclosedQuotes(yaml)).toBe(yaml)
  })

  it.each([
    [
      'next line is a list item',
      ['questions:', '  - id: Q04', '    phase: foundation', '    question: "Are there any constraints (e.g., compatibility, security)?', '  - id: Q05', '    phase: foundation', '    question: "Are there any non-goals?"'].join('\n'),
      ['questions:', '  - id: Q04', '    phase: foundation', '    question: "Are there any constraints (e.g., compatibility, security)?"', '  - id: Q05', '    phase: foundation', '    question: "Are there any non-goals?"'].join('\n'),
    ],
    [
      'next line is a sibling key',
      ['  - id: Q04', '    question: "Are there any constraints?', '    phase: foundation'].join('\n'),
      ['  - id: Q04', '    question: "Are there any constraints?"', '    phase: foundation'].join('\n'),
    ],
    [
      'at EOF',
      ['  - id: Q04', '    phase: foundation', '    question: "Are there any constraints?'].join('\n'),
      ['  - id: Q04', '    phase: foundation', '    question: "Are there any constraints?"'].join('\n'),
    ],
    [
      'on list item first key (- key: "value)',
      ['  - question: "What is the goal?', '  - question: "Who are users?"'].join('\n'),
      ['  - question: "What is the goal?"', '  - question: "Who are users?"'].join('\n'),
    ],
  ])('closes unclosed quote when %s', (_, input, expected) => {
    expect(repairYamlUnclosedQuotes(input)).toBe(expected)
  })

  it('handles escaped quotes correctly — does not count \\" as closing', () => {
    const input = ['  - id: Q01', '    question: "What does \\"scope\\" mean?', '  - id: Q02', '    question: "Next question?"'].join('\n')
    const repaired = repairYamlUnclosedQuotes(input)
    expect(repaired).toContain('    question: "What does \\"scope\\" mean?"')
  })

  it.each([
    [
      'single unclosed quote',
      ['questions:', '  - id: Q01', '    phase: foundation', '    question: "What is the primary goal?', '  - id: Q02', '    phase: structure', '    question: "What features are needed?"'].join('\n'),
      { count: 2, questions: [{ id: 'Q01', question: 'What is the primary goal?' }, { id: 'Q02', question: 'What features are needed?' }] },
    ],
    [
      'multiple unclosed quotes across items',
      ['questions:', '  - id: Q01', '    question: "First unclosed question?', '  - id: Q02', '    question: "Second unclosed question?', '  - id: Q03', '    question: "Third properly closed?"'].join('\n'),
      { count: 3, questions: [{ id: 'Q01', question: 'First unclosed question?' }, { id: 'Q02', question: 'Second unclosed question?' }, { id: 'Q03', question: 'Third properly closed?' }] },
    ],
  ])('repaired output parses correctly — %s', (_, input, expected) => {
    const repaired = repairYamlUnclosedQuotes(input)
    const parsed = jsYaml.load(repaired) as { questions: { id: string; question: string }[] }
    expect(parsed.questions).toHaveLength(expected.count)
    expected.questions.forEach((q: { id: string; question: string }, i: number) => {
      expect(parsed.questions[i]!.id).toBe(q.id)
      expect(parsed.questions[i]!.question).toBe(q.question)
    })
  })
})

describe('repairYamlInlineKeys', () => {
  it.each([
    ['valid multi-line YAML', ['batch_number: 4', 'progress:', '  current: 4', '  total: 17', 'is_final_free_form: false'].join('\n')],
    ['blank lines and comments', ['# A comment', '', 'batch_number: 4', 'is_final_free_form: false'].join('\n')],
  ])('passes through %s unchanged', (_, yaml) => {
    expect(repairYamlInlineKeys(yaml)).toBe(yaml)
  })

  it.each([
    [
      'flat inline keys',
      'batch_number: 4 is_final_free_form: false ai_commentary: "text"',
      { batch_number: 4, is_final_free_form: false, ai_commentary: 'text' },
    ],
    [
      'nested inline keys (progress: current: total:)',
      'progress: current: 4 total: 17',
      { progress: { current: 4, total: 17 } },
    ],
    [
      'the exact reported error pattern',
      'batch_number: 4 progress: current: 4 total: 17 is_final_free_form: false',
      { batch_number: 4, progress: { current: 4, total: 17 }, is_final_free_form: false },
    ],
    [
      'boolean values before next key',
      'is_final_free_form: false ai_commentary: "Choosing questions"',
      { is_final_free_form: false, ai_commentary: 'Choosing questions' },
    ],
    [
      'list-item lines with inline keys',
      '  - id: Q01 phase: Foundation priority: critical',
      [{ id: 'Q01', phase: 'Foundation', priority: 'critical' }],
    ],
    [
      'mixed valid and inline lines',
      ['batch_number: 4', 'progress: current: 4 total: 17', 'is_final_free_form: false'].join('\n'),
      { batch_number: 4, progress: { current: 4, total: 17 }, is_final_free_form: false },
    ],
  ])('splits %s', (_, input, expected) => {
    expect(jsYaml.load(repairYamlInlineKeys(input))).toEqual(expected)
  })

  it.each([
    ['values with spaces', 'rationale: This is an important question about the project'],
    ['quoted values containing colons', 'rationale: "key: value style explanation"'],
  ])('does not break %s', (_, input) => {
    expect(repairYamlInlineKeys(input)).toBe(input)
  })
})
