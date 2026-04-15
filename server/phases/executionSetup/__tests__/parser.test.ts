import { describe, expect, it } from 'vitest'
import { parseExecutionSetupResult } from '../parser'

function buildExecutionSetupPayload(body: string): string {
  return `<EXECUTION_SETUP_RESULT>\n${body}\n</EXECUTION_SETUP_RESULT>`
}

describe('parseExecutionSetupResult', () => {
  it('parses an exact execution setup marker payload', () => {
    const parsed = parseExecutionSetupResult(buildExecutionSetupPayload(JSON.stringify({
      status: 'ready',
      summary: 'environment initialized',
      profile: {
        schema_version: 1,
        ticket_id: 'T-1',
        artifact: 'execution_setup_profile',
        status: 'ready',
        summary: 'environment initialized and reusable',
        temp_roots: ['.ticket/runtime/execution-setup'],
        bootstrap_commands: ['npm install'],
        reusable_artifacts: [],
        project_commands: {
          prepare: ['npm install'],
          test_full: ['npm test'],
          lint_full: [],
          typecheck_full: [],
        },
        quality_gate_policy: {
          tests: 'bead-test-commands-first',
          lint: 'impacted-or-package',
          typecheck: 'impacted-or-package',
          full_project_fallback: 'never-block-on-unrelated-baseline',
        },
        cautions: [],
      },
      checks: {
        workspace: 'pass',
        tooling: 'pass',
        temp_scope: 'pass',
        policy: 'pass',
      },
    })))

    expect(parsed.markerFound).toBe(true)
    expect(parsed.errors).toEqual([])
    expect(parsed.result?.profile.artifact).toBe('execution_setup_profile')
    expect(parsed.result?.profile.tempRoots).toEqual(['.ticket/runtime/execution-setup'])
  })

  it('repairs fenced YAML payloads inside the execution setup marker', () => {
    const parsed = parseExecutionSetupResult(buildExecutionSetupPayload([
      '```yaml',
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
      '  bootstrap_commands:',
      '    - npm install',
      '  reusable_artifacts: []',
      '  project_commands:',
      '    prepare: []',
      '    test_full: []',
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
      '```',
    ].join('\n')))

    expect(parsed.result?.status).toBe('ready')
    expect(parsed.repairApplied).toBe(true)
    expect(parsed.repairWarnings).toContain('Unwrapped markdown code fence wrapping the YAML payload.')
  })

  it('repairs wrapper objects around the execution setup result payload', () => {
    const parsed = parseExecutionSetupResult(buildExecutionSetupPayload(JSON.stringify({
      execution_setup_result: {
        status: 'ready',
        summary: 'environment initialized',
        profile: {
          schema_version: 1,
          ticket_id: 'T-1',
          artifact: 'execution_setup_profile',
          status: 'ready',
          summary: 'environment initialized and reusable',
          temp_roots: ['.ticket/runtime/execution-setup'],
          bootstrap_commands: [],
          reusable_artifacts: [],
          project_commands: {
            prepare: [],
            test_full: [],
            lint_full: [],
            typecheck_full: [],
          },
          quality_gate_policy: {
            tests: 'bead-test-commands-first',
            lint: 'impacted-or-package',
            typecheck: 'impacted-or-package',
            full_project_fallback: 'never-block-on-unrelated-baseline',
          },
          cautions: [],
        },
        checks: {
          workspace: 'pass',
          tooling: 'pass',
          temp_scope: 'pass',
          policy: 'pass',
        },
      },
    })))

    expect(parsed.result?.summary).toBe('environment initialized')
    expect(parsed.repairApplied).toBe(true)
    expect(parsed.repairWarnings?.some((warning) => warning.includes('Removed wrapper key'))).toBe(true)
  })

  it('rejects prompt echoes clearly', () => {
    const parsed = parseExecutionSetupResult([
      'CRITICAL OUTPUT RULE:',
      'Return exactly one marker.',
      '## Expected Output Format',
      'status: ready',
      '## Context',
      '# Ticket: T-1',
    ].join('\n'))

    expect(parsed.markerFound).toBe(false)
    expect(parsed.result).toBeNull()
    expect(parsed.errors[0]).toContain('echoed the prompt')
  })

  it('fails when the execution setup marker is missing', () => {
    const parsed = parseExecutionSetupResult('status: ready\nsummary: nope')

    expect(parsed.markerFound).toBe(false)
    expect(parsed.result).toBeNull()
    expect(parsed.errors).toEqual(['No execution setup result marker found'])
  })
})
