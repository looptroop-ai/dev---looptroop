import { describe, expect, it } from 'vitest'
import { MockOpenCodeAdapter } from '../../../opencode/adapter'
import { generateExecutionSetup } from '../generator'

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
    const queuedStreamEvents = this.mockStreamEvents.get(`${sessionId}#${nextCount}`)
    if (queuedStreamEvents !== undefined) {
      this.mockStreamEvents.set(sessionId, queuedStreamEvents)
    }

    return await super.promptSession(...args)
  }
}

function buildReadyExecutionSetupResponse(): string {
  return [
    '<EXECUTION_SETUP_RESULT>',
    'status: ready',
    'summary: environment initialized',
    'profile:',
    '  schema_version: 1',
    '  ticket_id: T-1',
    '  artifact: execution_setup_profile',
    '  status: ready',
    '  summary: environment initialized and reusable',
    '  temp_roots:',
    '    - .ticket/runtime/execution-setup',
    '    - .cache/project-tooling',
    '  bootstrap_commands:',
    '    - project bootstrap',
    '  reusable_artifacts:',
    '    - path: .cache/project-tooling/dependencies',
    '      kind: cache',
    '      purpose: project dependency cache',
    '  project_commands:',
    '    prepare:',
    '      - project bootstrap',
    '    test_full:',
    '      - project test',
    '    lint_full: []',
    '    typecheck_full: []',
    '  quality_gate_policy:',
    '    tests: bead-test-commands-first',
    '    lint: impacted-or-package',
    '    typecheck: impacted-or-package',
    '    full_project_fallback: never-block-on-unrelated-baseline',
    '  cautions: []',
    'checks:',
    '  workspace: pass',
    '  tooling: pass',
    '  temp_scope: pass',
    '  policy: pass',
    '</EXECUTION_SETUP_RESULT>',
  ].join('\n')
}

describe('generateExecutionSetup', () => {
  it('retries malformed execution setup output in the same session', async () => {
    const adapter = new SequencedMockOpenCodeAdapter()
    adapter.mockResponses.set('mock-session-1#1', 'I am still preparing the environment.')
    adapter.mockResponses.set('mock-session-1#2', [
      '<EXECUTION_SETUP_RESULT>',
      '```yaml',
      'execution_setup_result:',
      buildReadyExecutionSetupResponse()
        .replace('<EXECUTION_SETUP_RESULT>\n', '')
        .replace('\n</EXECUTION_SETUP_RESULT>', '')
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n'),
      '```',
      '</EXECUTION_SETUP_RESULT>',
    ].join('\n'))

    const result = await generateExecutionSetup(
      adapter,
      [{ type: 'text', content: 'Execution setup context' }],
      '/tmp/test',
    )

    expect(result.result?.status).toBe('ready')
    expect(result.parse.repairApplied).toBe(true)
    expect(result.structuredOutput.autoRetryCount).toBe(1)
    expect(result.structuredOutput.retryDiagnostics?.[0]?.validationError).toBe('No execution setup result marker found')
    const messages = adapter.messages.get('mock-session-1') ?? []
    expect(messages.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(true)
    expect(adapter.sessions.map((session) => session.id)).toEqual(['mock-session-1'])
  })

  it('restarts execution setup in a fresh session after an empty response', async () => {
    const adapter = new SequencedMockOpenCodeAdapter()
    adapter.mockResponses.set('mock-session-1#1', '')
    adapter.mockResponses.set('mock-session-2#1', buildReadyExecutionSetupResponse())

    const result = await generateExecutionSetup(
      adapter,
      [{ type: 'text', content: 'Execution setup context' }],
      '/tmp/test',
    )

    expect(result.result?.status).toBe('ready')
    expect(result.structuredOutput.autoRetryCount).toBe(1)
    expect(result.structuredOutput.retryDiagnostics?.[0]?.excerpt).toBe('[empty response]')
    expect(adapter.sessions.map((session) => session.id)).toEqual(['mock-session-1', 'mock-session-2'])
    expect(adapter.messages.get('mock-session-1')?.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(false)
  })

  it('restarts execution setup in a fresh session after a session protocol error', async () => {
    const adapter = new SequencedMockOpenCodeAdapter()
    adapter.mockResponses.set('mock-session-1#1', buildReadyExecutionSetupResponse())
    adapter.mockStreamEvents.set('mock-session-1#1', [{
      type: 'session_error',
      sessionId: 'mock-session-1',
      error: "Provider returned error: The last message cannot have role 'assistant'",
    }])
    adapter.mockResponses.set('mock-session-2#1', buildReadyExecutionSetupResponse())

    const result = await generateExecutionSetup(
      adapter,
      [{ type: 'text', content: 'Execution setup context' }],
      '/tmp/test',
    )

    expect(result.result?.status).toBe('ready')
    expect(result.structuredOutput.retryDiagnostics?.[0]).toMatchObject({
      failureClass: 'session_protocol_error',
      validationError: 'No execution setup result marker found',
    })
    expect(adapter.sessions.map((session) => session.id)).toEqual(['mock-session-1', 'mock-session-2'])
  })
})
