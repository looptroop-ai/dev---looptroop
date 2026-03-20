import { describe, expect, it } from 'vitest'
import jsYaml from 'js-yaml'
import { repairYamlIndentation, repairYamlPlainScalarColons } from '../yamlRepair'

describe('repairYamlIndentation', () => {
  it('passes through correctly indented YAML unchanged', () => {
    const yaml = [
      'questions:',
      '  - id: Q01',
      '    phase: Foundation',
      '    question: "What problem are we solving?"',
      '  - id: Q02',
      '    phase: Structure',
      '    question: "Which users should we support?"',
    ].join('\n')

    expect(repairYamlIndentation(yaml)).toBe(yaml)
  })

  it('normalizes 3-space indent to 4-space for list item properties', () => {
    const input = [
      'questions:',
      '  - id: Q01',
      '   phase: Foundation',
      '   question: "What problem are we solving?"',
    ].join('\n')

    const expected = [
      'questions:',
      '  - id: Q01',
      '    phase: Foundation',
      '    question: "What problem are we solving?"',
    ].join('\n')

    expect(repairYamlIndentation(input)).toBe(expected)
  })

  it('normalizes mixed indent across multiple items', () => {
    const input = [
      'questions:',
      '  - id: Q01',
      '    phase: Foundation',
      '    question: "First question?"',
      '  - id: Q02',
      '   phase: Structure',
      '   question: "Second question?"',
      '  - id: Q03',
      '     phase: Assembly',
      '     question: "Third question?"',
    ].join('\n')

    const expected = [
      'questions:',
      '  - id: Q01',
      '    phase: Foundation',
      '    question: "First question?"',
      '  - id: Q02',
      '    phase: Structure',
      '    question: "Second question?"',
      '  - id: Q03',
      '    phase: Assembly',
      '    question: "Third question?"',
    ].join('\n')

    expect(repairYamlIndentation(input)).toBe(expected)
  })

  it('does not break nested lists', () => {
    const yaml = [
      'items:',
      '  - id: Q01',
      '    tags:',
      '      - alpha',
      '      - beta',
      '    question: "Nested test?"',
    ].join('\n')

    expect(repairYamlIndentation(yaml)).toBe(yaml)
  })

  it('handles top-level list items', () => {
    const input = [
      '- id: Q01',
      ' phase: Foundation',
      ' question: "Top-level list?"',
    ].join('\n')

    const expected = [
      '- id: Q01',
      '  phase: Foundation',
      '  question: "Top-level list?"',
    ].join('\n')

    expect(repairYamlIndentation(input)).toBe(expected)
  })

  it('preserves blank lines and comments', () => {
    const yaml = [
      '# Header comment',
      'questions:',
      '  - id: Q01',
      '    phase: Foundation',
      '',
      '    question: "Has blank line above?"',
    ].join('\n')

    expect(repairYamlIndentation(yaml)).toBe(yaml)
  })

  it('preserves folded block scalar continuation lines inside list items', () => {
    const yaml = [
      'questions:',
      '  - id: Q22',
      '    phase: Assembly',
      '    question: >-',
      '      What deterministic ordering and normalization rules should govern XML',
      '      output: path sort only, directories before files, case sensitivity,',
      '      locale neutrality, symlink handling, and any stable normalization needed',
      '      for cross-platform consistency?',
    ].join('\n')

    expect(repairYamlIndentation(yaml)).toBe(yaml)
  })
})

describe('repairYamlPlainScalarColons', () => {
  it('passes through YAML without colon-space in values', () => {
    const yaml = [
      'file_count: 2',
      'files:',
      '  - path: src/app.ts',
      '    rationale: Entry point for the app.',
      '    relevance: high',
    ].join('\n')

    expect(repairYamlPlainScalarColons(yaml)).toBe(yaml)
  })

  it('quotes plain scalar values containing colon-space', () => {
    const yaml = 'key: hello world: foo bar'
    const repaired = repairYamlPlainScalarColons(yaml)
    expect(repaired).toBe('key: "hello world: foo bar"')
  })

  it('quotes plain scalar values ending with colon', () => {
    const yaml = 'key: hello world:'
    const repaired = repairYamlPlainScalarColons(yaml)
    expect(repaired).toBe('key: "hello world:"')
  })

  it('does not touch already-quoted values', () => {
    const yaml = 'key: "hello world: foo bar"'
    expect(repairYamlPlainScalarColons(yaml)).toBe(yaml)
  })

  it('does not touch single-quoted values', () => {
    const yaml = "key: 'hello world: foo bar'"
    expect(repairYamlPlainScalarColons(yaml)).toBe(yaml)
  })

  it('does not touch block scalar indicators', () => {
    const yaml = [
      'rationale: >',
      '  This has colons: inside block scalar.',
      '  Another line with: colons.',
    ].join('\n')

    expect(repairYamlPlainScalarColons(yaml)).toBe(yaml)
  })

  it('does not touch literal block scalar indicators', () => {
    const yaml = [
      'content: |',
      '  export const foo: string = "bar"',
      '  const x: number = 1',
    ].join('\n')

    expect(repairYamlPlainScalarColons(yaml)).toBe(yaml)
  })

  it('does not touch flow mappings', () => {
    const yaml = 'key: {a: 1, b: 2}'
    expect(repairYamlPlainScalarColons(yaml)).toBe(yaml)
  })

  it('does not touch flow sequences', () => {
    const yaml = 'key: [a: 1, b: 2]'
    expect(repairYamlPlainScalarColons(yaml)).toBe(yaml)
  })

  it('escapes double quotes in values being wrapped', () => {
    const yaml = 'key: value with "quotes" and: colons'
    const repaired = repairYamlPlainScalarColons(yaml)
    expect(repaired).toBe('key: "value with \\"quotes\\" and: colons"')
  })

  it('repairs list item first key with colon in value', () => {
    const yaml = [
      'files:',
      '  - path: server/machines/ticketMachine.ts',
      '    rationale: Many rules are state-machine rules: completion truth gates, non-completion for idle.',
      '    relevance: high',
    ].join('\n')

    const repaired = repairYamlPlainScalarColons(yaml)
    expect(repaired).toContain('"Many rules are state-machine rules: completion truth gates, non-completion for idle."')
    // Verify it parses

    const parsed = jsYaml.load(repaired) as { files: { path?: string; rationale?: string; content_preview?: string }[] }
    expect(parsed.files[0]!.rationale).toBe('Many rules are state-machine rules: completion truth gates, non-completion for idle.')
  })

  it('repairs the exact LOO-1 production failure pattern', () => {
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

    const parsed = jsYaml.load(repaired) as { files: { path?: string; rationale?: string; content_preview?: string }[] }
    expect(parsed.files).toHaveLength(2)
    expect(parsed.files[0]!.path).toBe('server/sse/broadcaster.ts')
    expect(parsed.files[1]!.path).toBe('server/machines/ticketMachine.ts')
    expect(parsed.files[1]!.rationale).toContain('state-machine rules: completion truth gates')
  })

  it('preserves block scalar content with colons on continuation lines', () => {
    const yaml = [
      'files:',
      '  - path: src/app.ts',
      '    rationale: Simple rationale.',
      '    content_preview: |',
      '      export const foo: string = "bar"',
      '      type Config = { mode: "dev" | "prod" }',
      '    relevance: high',
    ].join('\n')

    const repaired = repairYamlPlainScalarColons(yaml)

    const parsed = jsYaml.load(repaired) as { files: { path?: string; rationale?: string; content_preview?: string }[] }
    expect(parsed.files[0]!.content_preview).toContain('foo: string')
    expect(parsed.files[0]!.content_preview).toContain('mode: "dev"')
  })

  it('handles multiple entries with mixed colon/no-colon rationales', () => {
    const yaml = [
      'files:',
      '  - path: a.ts',
      '    rationale: Simple rationale without colons.',
      '  - path: b.ts',
      '    rationale: Complex rules: this has colons inside.',
      '  - path: c.ts',
      '    rationale: "Already quoted: safe."',
    ].join('\n')

    const repaired = repairYamlPlainScalarColons(yaml)

    const parsed = jsYaml.load(repaired) as { files: { path?: string; rationale?: string; content_preview?: string }[] }
    expect(parsed.files).toHaveLength(3)
    expect(parsed.files[0]!.rationale).toBe('Simple rationale without colons.')
    expect(parsed.files[1]!.rationale).toBe('Complex rules: this has colons inside.')
    expect(parsed.files[2]!.rationale).toBe('Already quoted: safe.')
  })
})
