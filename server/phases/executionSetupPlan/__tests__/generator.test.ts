import { describe, expect, it } from 'vitest'
import { MockOpenCodeAdapter } from '../../../opencode/adapter'
import { generateExecutionSetupPlan } from '../generator'

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

function buildReadyPlanResponse(): string {
  return [
    '<EXECUTION_SETUP_PLAN>',
    'schema_version: 1',
    'ticket_id: T-1',
    'artifact: execution_setup_plan',
    'status: draft',
    'summary: Workspace setup is ready for review.',
    'readiness:',
    '  status: partial',
    '  actions_required: true',
    '  evidence:',
    '    - Project manifest exists.',
    '  gaps:',
    '    - Dependencies are missing.',
    'temp_roots:',
    '  - .ticket/runtime/execution-setup',
    'steps:',
    '  - id: setup-step-1',
    '    title: Bootstrap project dependencies',
    '    purpose: Install dependencies before running project-native tests.',
    '    commands:',
    '      - project bootstrap',
    '    required: true',
    '    rationale: Project-native tests require installed dependencies.',
    '    cautions: []',
    'project_commands:',
    '  prepare:',
    '    - project bootstrap',
    '  test_full:',
    '    - project test',
    '  lint_full: []',
    '  typecheck_full: []',
    'quality_gate_policy:',
    '  tests: bead-test-commands-first',
    '  lint: impacted-or-package',
    '  typecheck: impacted-or-package',
    '  full_project_fallback: never-block-on-unrelated-baseline',
    'cautions: []',
    '</EXECUTION_SETUP_PLAN>',
  ].join('\n')
}

describe('generateExecutionSetupPlan', () => {
  it('includes required setup step fields in the structured retry reminder', async () => {
    const adapter = new SequencedMockOpenCodeAdapter()
    adapter.mockResponses.set('mock-session-1#1', 'I drafted the setup plan.')
    adapter.mockResponses.set('mock-session-1#2', buildReadyPlanResponse())

    const result = await generateExecutionSetupPlan(
      adapter,
      [{ type: 'text', content: 'Execution setup plan context' }],
      '/tmp/test',
    )

    expect(result.plan?.steps[0]?.title).toBe('Bootstrap project dependencies')
    expect(result.structuredOutput.autoRetryCount).toBe(1)

    const messages = adapter.messages.get('mock-session-1') ?? []
    const retryPrompt = messages.find((message) => (
      message.role === 'user'
      && typeof message.content === 'string'
      && message.content.includes('Structured Output Retry')
    ))?.content

    expect(retryPrompt).toContain('Every setup step must include id, title, purpose, commands, required, rationale, and cautions')
  })
})
