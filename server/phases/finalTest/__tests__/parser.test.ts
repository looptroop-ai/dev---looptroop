import { describe, expect, it } from 'vitest'
import { parseFinalTestCommands } from '../parser'

describe.concurrent('parseFinalTestCommands', () => {
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

    const result = parseFinalTestCommands(output)
    expect(result.markerFound).toBe(true)
    expect(result.commands).toEqual(['npm test'])
    expect(result.summary).toBeNull()
    expect(result.errors).toEqual([])
    expect(result.repairApplied).toBe(true)
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

    const result = parseFinalTestCommands(output)
    expect(result.markerFound).toBe(true)
    expect(result.commands).toEqual(['npm run test:server'])
    expect(result.summary).toBe('verify structured output flows')
    expect(result.errors).toEqual([])
    expect(result.repairApplied).toBe(true)
  })
})
