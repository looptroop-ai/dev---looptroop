import { describe, expect, it } from 'vitest'
import jsYaml from 'js-yaml'
import { repairYamlDuplicateKeys, repairYamlIndentation, repairYamlInlineKeys, repairYamlListDashSpace, repairYamlPlainScalarColons, repairYamlSequenceEntryIndent, repairYamlUnclosedQuotes, stripCodeFences } from '../yamlRepair'

describe('repairYamlListDashSpace', () => {
  it('passes through correctly formatted list items unchanged', () => {
    const yaml = [
      'questions:',
      '  - id: Q01',
      '    phase: Foundation',
      '    question: "What problem are we solving?"',
    ].join('\n')

    expect(repairYamlListDashSpace(yaml)).toBe(yaml)
  })

  it('inserts space after dash for first list item', () => {
    const input = [
      'questions:',
      '  -id: Q01',
      '    phase: Foundation',
      '    question: "What problem are we solving?"',
    ].join('\n')

    const expected = [
      'questions:',
      '  - id: Q01',
      '    phase: Foundation',
      '    question: "What problem are we solving?"',
    ].join('\n')

    expect(repairYamlListDashSpace(input)).toBe(expected)
  })

  it('repairs any field name, not just id', () => {
    const input = [
      '  -phase: Foundation',
      '  -question: "What?"',
      '  -rationale: "Because"',
      '  -path: server/app.ts',
    ].join('\n')

    const expected = [
      '  - phase: Foundation',
      '  - question: "What?"',
      '  - rationale: "Because"',
      '  - path: server/app.ts',
    ].join('\n')

    expect(repairYamlListDashSpace(input)).toBe(expected)
  })

  it('handles mixed correct and incorrect items', () => {
    const input = [
      'questions:',
      '  -id: Q01',
      '    phase: Foundation',
      '  - id: Q02',
      '    phase: Structure',
    ].join('\n')

    const expected = [
      'questions:',
      '  - id: Q01',
      '    phase: Foundation',
      '  - id: Q02',
      '    phase: Structure',
    ].join('\n')

    expect(repairYamlListDashSpace(input)).toBe(expected)
  })

  it('produces valid YAML after repair', () => {
    const input = [
      'questions:',
      '  -id: Q01',
      '    phase: Foundation',
      '    question: "What problem are we solving?"',
      '  - id: Q02',
      '    phase: Structure',
      '    question: "What features are needed?"',
    ].join('\n')

    const repaired = repairYamlListDashSpace(input)
    const parsed = jsYaml.load(repaired) as { questions: { id: string; phase: string; question: string }[] }
    expect(parsed.questions).toHaveLength(2)
    expect(parsed.questions[0]!.id).toBe('Q01')
    expect(parsed.questions[1]!.id).toBe('Q02')
  })

  it('does not alter top-level mapping keys', () => {
    const yaml = [
      'file_count: 2',
      'files:',
      '  - path: a.ts',
    ].join('\n')

    expect(repairYamlListDashSpace(yaml)).toBe(yaml)
  })

  it('handles top-level list with missing dash space', () => {
    const input = [
      '-id: Q01',
      '  phase: Foundation',
    ].join('\n')

    const expected = [
      '- id: Q01',
      '  phase: Foundation',
    ].join('\n')

    expect(repairYamlListDashSpace(input)).toBe(expected)
  })
})

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

})

describe('stripCodeFences', () => {
  it('strips ```yaml wrapper', () => {
    const input = '```yaml\nquestions:\n  - id: Q01\n```'
    expect(stripCodeFences(input)).toBe('questions:\n  - id: Q01')
  })

  it('strips ```yml wrapper', () => {
    const input = '```yml\nkey: value\n```'
    expect(stripCodeFences(input)).toBe('key: value')
  })

  it('strips ```json wrapper', () => {
    const input = '```json\n{"key": "value"}\n```'
    expect(stripCodeFences(input)).toBe('{"key": "value"}')
  })

  it('strips ```jsonl wrapper', () => {
    const input = '```jsonl\n{"a":1}\n{"b":2}\n```'
    expect(stripCodeFences(input)).toBe('{"a":1}\n{"b":2}')
  })

  it('strips bare ``` wrapper (no language tag)', () => {
    const input = '```\nquestions:\n  - id: Q01\n```'
    expect(stripCodeFences(input)).toBe('questions:\n  - id: Q01')
  })

  it('handles leading/trailing whitespace around fences', () => {
    const input = '  \n```yaml\nquestions:\n  - id: Q01\n```  \n  '
    expect(stripCodeFences(input)).toBe('questions:\n  - id: Q01')
  })

  it('returns unchanged when no fences present', () => {
    const input = 'questions:\n  - id: Q01'
    expect(stripCodeFences(input)).toBe(input)
  })

  it('returns unchanged when only opening fence', () => {
    const input = '```yaml\nquestions:\n  - id: Q01'
    expect(stripCodeFences(input)).toBe(input)
  })

  it('returns unchanged when only closing fence', () => {
    const input = 'questions:\n  - id: Q01\n```'
    expect(stripCodeFences(input)).toBe(input)
  })

  it('does not strip fences that appear mid-content', () => {
    const input = [
      'questions:',
      '  - id: Q01',
      '    question: "See this code:"',
      '```yaml',
      'example: true',
      '```',
      '  - id: Q02',
    ].join('\n')
    expect(stripCodeFences(input)).toBe(input)
  })

  it('preserves internal indentation', () => {
    const input = '```yaml\nquestions:\n  - id: Q01\n    phase: foundation\n    question: "What?"\n```'
    const expected = 'questions:\n  - id: Q01\n    phase: foundation\n    question: "What?"'
    expect(stripCodeFences(input)).toBe(expected)
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

describe('repairYamlSequenceEntryIndent', () => {
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

    expect(repairYamlSequenceEntryIndent(yaml)).toBe(yaml)
  })

  it('fixes dash indent drift after block scalar (LOO-19 pattern)', () => {
    const input = [
      'questions:',
      '- id: Q01',
      '    phase: foundation',
      '    question: >-',
      '        Who are the primary users or stakeholders',
      '        of this feature?',
      '  - id: Q02',
      '    phase: foundation',
      '    question: >-',
      '        What is the core problem?',
    ].join('\n')

    const expected = [
      'questions:',
      '- id: Q01',
      '    phase: foundation',
      '    question: >-',
      '        Who are the primary users or stakeholders',
      '        of this feature?',
      '- id: Q02',
      '    phase: foundation',
      '    question: >-',
      '        What is the core problem?',
    ].join('\n')

    expect(repairYamlSequenceEntryIndent(input)).toBe(expected)
  })

  it('fixes drift in indented sequences', () => {
    const input = [
      'questions:',
      '  - id: Q01',
      '    phase: Foundation',
      '    question: "First?"',
      '    - id: Q02',
      '    phase: Structure',
      '    question: "Second?"',
    ].join('\n')

    const expected = [
      'questions:',
      '  - id: Q01',
      '    phase: Foundation',
      '    question: "First?"',
      '  - id: Q02',
      '    phase: Structure',
      '    question: "Second?"',
    ].join('\n')

    expect(repairYamlSequenceEntryIndent(input)).toBe(expected)
  })

  it('preserves nested sequences', () => {
    const yaml = [
      'items:',
      '  - id: Q01',
      '    options:',
      '      - label: Yes',
      '      - label: No',
      '  - id: Q02',
      '    options:',
      '      - label: Alpha',
      '      - label: Beta',
    ].join('\n')

    expect(repairYamlSequenceEntryIndent(yaml)).toBe(yaml)
  })

  it('does not misread block scalar content as sequence entries', () => {
    const yaml = [
      'items:',
      '  - id: Q01',
      '    question: |',
      '      - This is not a list entry',
      '      - Neither is this',
      '  - id: Q02',
      '    question: "Short"',
    ].join('\n')

    expect(repairYamlSequenceEntryIndent(yaml)).toBe(yaml)
  })

  it('handles multiple top-level keys with separate sequences', () => {
    const input = [
      'questions:',
      '  - id: Q01',
      '    phase: Foundation',
      '   - id: Q02',
      '    phase: Structure',
      'changes:',
      '  - type: modified',
      '    before: Q01',
      '   - type: added',
      '    before: null',
    ].join('\n')

    const expected = [
      'questions:',
      '  - id: Q01',
      '    phase: Foundation',
      '  - id: Q02',
      '    phase: Structure',
      'changes:',
      '  - type: modified',
      '    before: Q01',
      '  - type: added',
      '    before: null',
    ].join('\n')

    expect(repairYamlSequenceEntryIndent(input)).toBe(expected)
  })

  it('produces valid YAML after repairing LOO-19 pattern', () => {
    const input = [
      'questions:',
      '- id: Q01',
      '  phase: foundation',
      '  question: >-',
      '    Who are the primary users?',
      '  - id: Q02',
      '  phase: structure',
      '  question: "What are the main flows?"',
    ].join('\n')

    const repaired = repairYamlSequenceEntryIndent(input)
    const parsed = jsYaml.load(repaired) as { questions: { id: string; phase: string }[] }
    expect(parsed.questions).toHaveLength(2)
    expect(parsed.questions[0]!.id).toBe('Q01')
    expect(parsed.questions[1]!.id).toBe('Q02')
  })
})

describe('repairYamlUnclosedQuotes', () => {
  it('passes through valid YAML with properly closed quotes unchanged', () => {
    const yaml = [
      'questions:',
      '  - id: Q01',
      '    phase: foundation',
      '    question: "What problem are we solving?"',
      '  - id: Q02',
      '    phase: foundation',
      '    question: "Who are the users?"',
    ].join('\n')

    expect(repairYamlUnclosedQuotes(yaml)).toBe(yaml)
  })

  it('closes unclosed quote when next line is a list item', () => {
    const input = [
      'questions:',
      '  - id: Q04',
      '    phase: foundation',
      '    question: "Are there any constraints (e.g., compatibility, security)?',
      '  - id: Q05',
      '    phase: foundation',
      '    question: "Are there any non-goals?"',
    ].join('\n')

    const expected = [
      'questions:',
      '  - id: Q04',
      '    phase: foundation',
      '    question: "Are there any constraints (e.g., compatibility, security)?"',
      '  - id: Q05',
      '    phase: foundation',
      '    question: "Are there any non-goals?"',
    ].join('\n')

    expect(repairYamlUnclosedQuotes(input)).toBe(expected)
  })

  it('closes unclosed quote when next line is a sibling key', () => {
    const input = [
      '  - id: Q04',
      '    question: "Are there any constraints?',
      '    phase: foundation',
    ].join('\n')

    const expected = [
      '  - id: Q04',
      '    question: "Are there any constraints?"',
      '    phase: foundation',
    ].join('\n')

    expect(repairYamlUnclosedQuotes(input)).toBe(expected)
  })

  it('closes unclosed quote at EOF', () => {
    const input = [
      '  - id: Q04',
      '    phase: foundation',
      '    question: "Are there any constraints?',
    ].join('\n')

    const expected = [
      '  - id: Q04',
      '    phase: foundation',
      '    question: "Are there any constraints?"',
    ].join('\n')

    expect(repairYamlUnclosedQuotes(input)).toBe(expected)
  })

  it('handles escaped quotes correctly — does not count \\" as closing', () => {
    const input = [
      '  - id: Q01',
      '    question: "What does \\"scope\\" mean?',
      '  - id: Q02',
      '    question: "Next question?"',
    ].join('\n')

    const repaired = repairYamlUnclosedQuotes(input)
    // The escaped quotes \" don't count as closing, so the quote is still unclosed
    expect(repaired).toContain('    question: "What does \\"scope\\" mean?"')
  })

  it('does not modify lines inside block scalars', () => {
    const yaml = [
      '  - id: Q01',
      '    question: >-',
      '      This has "unclosed quote inside block scalar',
      '  - id: Q02',
      '    question: "Next?"',
    ].join('\n')

    expect(repairYamlUnclosedQuotes(yaml)).toBe(yaml)
  })

  it('does not modify already-closed quotes', () => {
    const yaml = [
      '    question: "valid question?"',
      '    rationale: "some rationale"',
    ].join('\n')

    expect(repairYamlUnclosedQuotes(yaml)).toBe(yaml)
  })

  it('repaired output parses correctly with js-yaml', () => {
    const input = [
      'questions:',
      '  - id: Q01',
      '    phase: foundation',
      '    question: "What is the primary goal?',
      '  - id: Q02',
      '    phase: structure',
      '    question: "What features are needed?"',
    ].join('\n')

    const repaired = repairYamlUnclosedQuotes(input)
    const parsed = jsYaml.load(repaired) as { questions: { id: string; question: string }[] }
    expect(parsed.questions).toHaveLength(2)
    expect(parsed.questions[0]!.id).toBe('Q01')
    expect(parsed.questions[0]!.question).toBe('What is the primary goal?')
    expect(parsed.questions[1]!.id).toBe('Q02')
    expect(parsed.questions[1]!.question).toBe('What features are needed?')
  })

  it('handles multiple unclosed quotes across different list items', () => {
    const input = [
      'questions:',
      '  - id: Q01',
      '    question: "First unclosed question?',
      '  - id: Q02',
      '    question: "Second unclosed question?',
      '  - id: Q03',
      '    question: "Third properly closed?"',
    ].join('\n')

    const repaired = repairYamlUnclosedQuotes(input)
    const parsed = jsYaml.load(repaired) as { questions: { id: string; question: string }[] }
    expect(parsed.questions).toHaveLength(3)
    expect(parsed.questions[0]!.question).toBe('First unclosed question?')
    expect(parsed.questions[1]!.question).toBe('Second unclosed question?')
    expect(parsed.questions[2]!.question).toBe('Third properly closed?')
  })

  it('handles unclosed quote on list item first key (- key: "value)', () => {
    const input = [
      '  - question: "What is the goal?',
      '  - question: "Who are users?"',
    ].join('\n')

    const expected = [
      '  - question: "What is the goal?"',
      '  - question: "Who are users?"',
    ].join('\n')

    expect(repairYamlUnclosedQuotes(input)).toBe(expected)
  })
})

describe('repairYamlInlineKeys', () => {
  it('passes through valid multi-line YAML unchanged', () => {
    const yaml = [
      'batch_number: 4',
      'progress:',
      '  current: 4',
      '  total: 17',
      'is_final_free_form: false',
    ].join('\n')

    expect(repairYamlInlineKeys(yaml)).toBe(yaml)
  })

  it('splits flat inline keys', () => {
    const input = 'batch_number: 4 is_final_free_form: false ai_commentary: "text"'

    const result = repairYamlInlineKeys(input)
    const parsed = jsYaml.load(result) as Record<string, unknown>

    expect(parsed.batch_number).toBe(4)
    expect(parsed.is_final_free_form).toBe(false)
    expect(parsed.ai_commentary).toBe('text')
  })

  it('splits nested inline keys (progress: current: total:)', () => {
    const input = 'progress: current: 4 total: 17'

    const result = repairYamlInlineKeys(input)
    const parsed = jsYaml.load(result) as Record<string, unknown>

    expect(parsed).toEqual({
      progress: { current: 4, total: 17 },
    })
  })

  it('handles the exact reported error pattern', () => {
    const input = 'batch_number: 4 progress: current: 4 total: 17 is_final_free_form: false'

    const result = repairYamlInlineKeys(input)
    const parsed = jsYaml.load(result) as Record<string, unknown>

    expect(parsed).toEqual({
      batch_number: 4,
      progress: { current: 4, total: 17 },
      is_final_free_form: false,
    })
  })

  it('does not break values with spaces', () => {
    const input = 'rationale: This is an important question about the project'

    expect(repairYamlInlineKeys(input)).toBe(input)
  })

  it('does not break quoted values containing colons', () => {
    const input = 'rationale: "key: value style explanation"'

    expect(repairYamlInlineKeys(input)).toBe(input)
  })

  it('handles list-item lines with inline keys', () => {
    const input = '  - id: Q01 phase: Foundation priority: critical'

    const result = repairYamlInlineKeys(input)
    const parsed = jsYaml.load(result) as unknown[]

    expect(parsed).toEqual([
      { id: 'Q01', phase: 'Foundation', priority: 'critical' },
    ])
  })

  it('handles boolean values before next key', () => {
    const input = 'is_final_free_form: false ai_commentary: "Choosing questions"'

    const result = repairYamlInlineKeys(input)
    const parsed = jsYaml.load(result) as Record<string, unknown>

    expect(parsed.is_final_free_form).toBe(false)
    expect(parsed.ai_commentary).toBe('Choosing questions')
  })

  it('preserves blank lines and comments', () => {
    const yaml = [
      '# A comment',
      '',
      'batch_number: 4',
      'is_final_free_form: false',
    ].join('\n')

    expect(repairYamlInlineKeys(yaml)).toBe(yaml)
  })

  it('handles mixed valid and inline lines', () => {
    const input = [
      'batch_number: 4',
      'progress: current: 4 total: 17',
      'is_final_free_form: false',
    ].join('\n')

    const result = repairYamlInlineKeys(input)
    const parsed = jsYaml.load(result) as Record<string, unknown>

    expect(parsed).toEqual({
      batch_number: 4,
      progress: { current: 4, total: 17 },
      is_final_free_form: false,
    })
  })
})
