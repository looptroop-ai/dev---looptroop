import { describe, expect, it } from 'vitest'
import { repairYamlIndentation } from '../yamlRepair'

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
})
