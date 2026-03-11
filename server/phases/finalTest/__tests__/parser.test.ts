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
    })
  })

  it('rejects malformed marker payloads instead of scraping prose', () => {
    const output = '<FINAL_TEST_COMMANDS>{"commands":"npm test"}</FINAL_TEST_COMMANDS>'

    expect(parseFinalTestCommands(output)).toEqual({
      markerFound: true,
      commands: [],
      summary: null,
      errors: ['No executable final test commands were provided'],
    })
  })
})
