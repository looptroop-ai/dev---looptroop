import { describe, expect, it } from 'vitest'
import { MockOpenCodeAdapter } from '../../../opencode/adapter'
import { generateFinalTests } from '../generator'
import { parseFinalTestCommands } from '../parser'

class SequencedMockOpenCodeAdapter extends MockOpenCodeAdapter {
  private promptCounts = new Map<string, number>()

  override async promptSession(...args: Parameters<MockOpenCodeAdapter['promptSession']>) {
    const sessionId = args[0]
    const nextCount = (this.promptCounts.get(sessionId) ?? 0) + 1
    this.promptCounts.set(sessionId, nextCount)

    const queuedResponse = this.mockResponses.get(`${sessionId}#${nextCount}`)
    if (queuedResponse !== undefined) {
      this.mockResponses.set(sessionId, queuedResponse)
    }

    return await super.promptSession(...args)
  }
}

describe('generateFinalTests', () => {
  it('retries malformed final test markers in the same session', async () => {
    const adapter = new SequencedMockOpenCodeAdapter()
    adapter.mockResponses.set('mock-session-1#1', 'I added tests to cover the whole ticket.')
    adapter.mockResponses.set('mock-session-1#2', [
      '<FINAL_TEST_COMMANDS>',
      '```yaml',
      'command_plan:',
      '  commands: npm run test:server',
      '  summary: verify end-to-end ticket coverage',
      '```',
      '</FINAL_TEST_COMMANDS>',
    ].join('\n'))

    const output = await generateFinalTests(
      adapter,
      [{ type: 'text', content: 'Ticket context' }],
      '/tmp/test',
    )

    expect(parseFinalTestCommands(output)).toEqual({
      markerFound: true,
      commands: ['npm run test:server'],
      summary: 'verify end-to-end ticket coverage',
      errors: [],
      repairApplied: true,
      repairWarnings: [],
    })

    const messages = adapter.messages.get('mock-session-1') ?? []
    expect(messages.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(true)
  })

  it('restarts final test generation in a fresh session after an empty response', async () => {
    const adapter = new SequencedMockOpenCodeAdapter()
    adapter.mockResponses.set('mock-session-1#1', '')
    adapter.mockResponses.set('mock-session-2#1', [
      '<FINAL_TEST_COMMANDS>',
      'commands:',
      '  - npm run test:server',
      'summary: verify end-to-end ticket coverage',
      '</FINAL_TEST_COMMANDS>',
    ].join('\n'))

    const output = await generateFinalTests(
      adapter,
      [{ type: 'text', content: 'Ticket context' }],
      '/tmp/test',
    )

    expect(parseFinalTestCommands(output)).toEqual({
      markerFound: true,
      commands: ['npm run test:server'],
      summary: 'verify end-to-end ticket coverage',
      errors: [],
      repairApplied: true,
      repairWarnings: [],
    })
    expect(adapter.sessions.map((session) => session.id)).toEqual(['mock-session-1', 'mock-session-2'])
    expect(adapter.messages.get('mock-session-1')?.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(false)
  })
})
