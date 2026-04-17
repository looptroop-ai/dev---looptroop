import { describe, expect, it } from 'vitest'
import { parseExecutionSetupPlanResult } from '../parser'

function wrapPlan(body: string): string {
  return `<EXECUTION_SETUP_PLAN>\n${body}\n</EXECUTION_SETUP_PLAN>`
}

function buildPlanWithSteps(steps: unknown[]): string {
  return wrapPlan(JSON.stringify({
    schema_version: 1,
    ticket_id: 'T-1',
    artifact: 'execution_setup_plan',
    status: 'draft',
    summary: 'Workspace needs setup before coding.',
    readiness: {
      status: 'partial',
      actions_required: true,
      evidence: ['Project manifest exists.'],
      gaps: ['Dependencies are missing.'],
    },
    temp_roots: ['.ticket/runtime/execution-setup'],
    steps,
    project_commands: {
      prepare: ['project bootstrap'],
      test_full: ['project test'],
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
  }))
}

describe('parseExecutionSetupPlanResult', () => {
  it('repairs setup steps that omitted metadata fields but provided purpose text', () => {
    const parsed = parseExecutionSetupPlanResult(buildPlanWithSteps([
      {
        order: 1,
        purpose: 'Install locked dependencies before running project-native tests.',
        commands: ['project bootstrap'],
        required: true,
      },
    ]))

    expect(parsed.errors).toEqual([])
    expect(parsed.plan?.steps[0]).toMatchObject({
      id: 'setup-step-1',
      title: 'Install locked dependencies before running project-native tests.',
      purpose: 'Install locked dependencies before running project-native tests.',
      rationale: 'Install locked dependencies before running project-native tests.',
      commands: ['project bootstrap'],
      required: true,
      cautions: [],
    })
    expect(parsed.repairApplied).toBe(true)
    expect(parsed.repairWarnings).toEqual([
      'Filled missing execution setup plan step id at index 0 from list position.',
      'Filled missing execution setup plan step title at index 0 from existing purpose text.',
      'Filled missing execution setup plan step rationale at index 0 from existing purpose text.',
    ])
  })

  it('repairs the retry shape that has id but still omits title and rationale', () => {
    const parsed = parseExecutionSetupPlanResult(buildPlanWithSteps([
      {
        id: 'step-1-bootstrap',
        purpose: 'Install locked dependencies before running project-native tests.',
        commands: ['project bootstrap'],
        required: true,
      },
    ]))

    expect(parsed.errors).toEqual([])
    expect(parsed.plan?.steps[0]).toMatchObject({
      id: 'step-1-bootstrap',
      title: 'Install locked dependencies before running project-native tests.',
      rationale: 'Install locked dependencies before running project-native tests.',
    })
    expect(parsed.repairWarnings).toEqual([
      'Filled missing execution setup plan step title at index 0 from existing purpose text.',
      'Filled missing execution setup plan step rationale at index 0 from existing purpose text.',
    ])
  })

  it('still rejects setup steps that do not provide purpose text', () => {
    const parsed = parseExecutionSetupPlanResult(buildPlanWithSteps([
      {
        id: 'step-1-bootstrap',
        title: 'Bootstrap project',
        commands: ['project bootstrap'],
        required: true,
      },
    ]))

    expect(parsed.plan).toBeNull()
    expect(parsed.errors).toEqual(['Missing required steps[0].purpose'])
  })
})
