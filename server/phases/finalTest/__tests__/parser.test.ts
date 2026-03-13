import { describe, expect, it } from 'vitest'
import { parseFinalTestCommands } from '../parser'

describe('parseFinalTestCommands', () => {
  it('requires the structured final test marker', () => {
    const output = [
      'Run these commands:',
      '```bash',
      'npm test',
      '```',
    ].join('\n')

    expect(parseFinalTestCommands(output)).toEqual({
      markerFound: false,
      commands: [],
      summary: null,
      errors: ['No final test command marker found'],
      repairApplied: false,
      repairWarnings: [],
      validationError: 'No final test command marker found',
    })
  })

  it('normalizes a single command string inside the marker instead of scraping prose', () => {
    const output = '<FINAL_TEST_COMMANDS>{"commands":"npm test"}</FINAL_TEST_COMMANDS>'

    expect(parseFinalTestCommands(output)).toEqual({
      markerFound: true,
      commands: ['npm test'],
      summary: null,
      errors: [],
      repairApplied: true,
      repairWarnings: [],
    })
  })

  it('accepts fenced YAML payloads inside the marker', () => {
    const output = [
      '<FINAL_TEST_COMMANDS>',
      '```yaml',
      'command_plan:',
      '  commands:',
      '    - npm run test:server',
      '  summary: verify structured output flows',
      '```',
      '</FINAL_TEST_COMMANDS>',
    ].join('\n')

    expect(parseFinalTestCommands(output)).toEqual({
      markerFound: true,
      commands: ['npm run test:server'],
      summary: 'verify structured output flows',
      errors: [],
      repairApplied: true,
      repairWarnings: [],
    })
  })
})
