import { describe, expect, it } from 'vitest'
import { WORKFLOW_PHASES, getAvailableWorkflowActions } from '@shared/workflowMeta'
import { getCascadeEditWarningMessage } from '@/lib/workflowMeta'

describe.concurrent('getCascadeEditWarningMessage', () => {
  it('does not warn when editing interview before PRD has started', () => {
    expect(getCascadeEditWarningMessage('WAITING_INTERVIEW_APPROVAL', 'interview')).toBeNull()
  })

  it('warns about PRD when editing interview while PRD is being drafted', () => {
    expect(getCascadeEditWarningMessage('DRAFTING_PRD', 'interview')).toBe(
      'Saving this Interview edit will restart PRD/specs planning from the edited Interview. Previous PRD versions will be archived and remain available read-only.',
    )
  })

  it('warns about PRD when editing interview at PRD approval', () => {
    expect(getCascadeEditWarningMessage('WAITING_PRD_APPROVAL', 'interview')).toBe(
      'Saving this Interview edit will restart PRD/specs planning from the edited Interview. Previous PRD versions will be archived and remain available read-only.',
    )
  })

  it('warns about PRD and Beads when editing interview at Beads approval', () => {
    expect(getCascadeEditWarningMessage('WAITING_BEADS_APPROVAL', 'interview')).toBe(
      'Saving this Interview edit will restart PRD/specs planning and Beads planning from the edited Interview. Previous PRD and Beads versions will be archived and remain available read-only.',
    )
  })

  it('does not warn when editing interview during execution phases', () => {
    expect(getCascadeEditWarningMessage('PRE_FLIGHT_CHECK', 'interview')).toBeNull()
  })

  it('does not warn when editing PRD before Beads has been approved', () => {
    expect(getCascadeEditWarningMessage('WAITING_PRD_APPROVAL', 'prd')).toBeNull()
  })

  it('warns when editing PRD once Beads drafting has started', () => {
    expect(getCascadeEditWarningMessage('DRAFTING_BEADS', 'prd')).toBe(
      'Saving this PRD edit will restart Beads/blueprint planning from the edited PRD. Previous Beads versions will be archived and remain available read-only.',
    )
  })

  it('warns when editing PRD at Beads approval', () => {
    expect(getCascadeEditWarningMessage('WAITING_BEADS_APPROVAL', 'prd')).toBe(
      'Saving this PRD edit will restart Beads/blueprint planning from the edited PRD. Previous Beads versions will be archived and remain available read-only.',
    )
  })

  it('does not warn when editing PRD during execution phases', () => {
    expect(getCascadeEditWarningMessage('PRE_FLIGHT_CHECK', 'prd')).toBeNull()
  })

  it('never warns when editing beads', () => {
    expect(getCascadeEditWarningMessage('WAITING_BEADS_APPROVAL', 'beads')).toBeNull()
  })

  it('never warns when editing execution setup', () => {
    expect(getCascadeEditWarningMessage('WAITING_EXECUTION_SETUP_APPROVAL', 'execution_setup_plan')).toBeNull()
  })
})

describe.concurrent('workflow metadata', () => {
  it('keeps cancel available during PR review', () => {
    expect(getAvailableWorkflowActions('WAITING_PR_REVIEW')).toEqual(['merge', 'close_unmerged', 'cancel'])
  })

  it('removes all actions for terminal statuses', () => {
    expect(getAvailableWorkflowActions('COMPLETED')).toEqual([])
    expect(getAvailableWorkflowActions('CANCELED')).toEqual([])
  })

  it('provides long-form details for every workflow phase', () => {
    for (const phase of WORKFLOW_PHASES) {
      expect(phase.details.overview.trim().length).toBeGreaterThan(0)
      expect(phase.details.steps.length).toBeGreaterThan(0)
      expect(phase.details.outputs.length).toBeGreaterThan(0)
      expect(phase.details.transitions.length).toBeGreaterThan(0)
    }
  })

  it('documents safe resume behavior in every phase summary and details', () => {
    for (const phase of WORKFLOW_PHASES) {
      expect(phase.description).toContain('Safe resume:')
      expect(phase.details.notes?.some((note) => note.includes('Safe resume:'))).toBe(true)
    }
  })

  it('shows only ticket details as allowed context while scanning relevant files', () => {
    const scanningPhase = WORKFLOW_PHASES.find((phase) => phase.id === 'SCANNING_RELEVANT_FILES')

    expect(scanningPhase?.contextSummary).toEqual(['ticket_details'])
  })

  it('uses the simplified description for PRD coverage verification', () => {
    const prdCoveragePhase = WORKFLOW_PHASES.find((phase) => phase.id === 'VERIFYING_PRD_COVERAGE')

    expect(prdCoveragePhase?.description).toContain(
      'LoopTroop checks the current PRD against the winning model\'s Full Answers artifact. If something is missing, it updates the PRD and checks again.',
    )
    expect(prdCoveragePhase?.contextSummary).toEqual(['full_answers', 'prd'])
  })

  it('describes the two-step beads finalization flow', () => {
    const beadsRefinePhase = WORKFLOW_PHASES.find((phase) => phase.id === 'REFINING_BEADS')

    expect(beadsRefinePhase?.description).toContain(
      'Winning draft is consolidated into the final semantic beads blueprint using the strongest ideas from the losing drafts.',
    )
  })

  it('describes beads coverage as a pure semantic coverage review loop', () => {
    const beadsCoveragePhase = WORKFLOW_PHASES.find((phase) => phase.id === 'VERIFYING_BEADS_COVERAGE')

    expect(beadsCoveragePhase?.description).toContain(
      'LoopTroop checks the current semantic beads blueprint against the approved PRD. If something is missing, it updates the blueprint and checks again.',
    )
    expect(beadsCoveragePhase?.contextSummary).toEqual(['prd', 'beads'])
    expect(beadsCoveragePhase?.contextSections).toEqual([
      {
        label: 'Coverage Review',
        description: 'Checking Blueprint Against PRD',
        keys: ['prd', 'beads'],
      },
    ])
  })

  it('describes the expanding beads phase as blueprint-to-execution transformation', () => {
    const expandingPhase = WORKFLOW_PHASES.find((phase) => phase.id === 'EXPANDING_BEADS')

    expect(expandingPhase?.description).toContain(
      'LoopTroop transforms the coverage-validated semantic blueprint into execution-ready bead records',
    )
    expect(expandingPhase?.contextSummary).toEqual(['relevant_files', 'ticket_details', 'prd', 'beads_draft'])
    expect(expandingPhase?.contextSections).toEqual([
      {
        label: 'Expansion',
        description: 'Transforming Blueprint into Execution-Ready Beads',
        keys: ['relevant_files', 'ticket_details', 'prd', 'beads_draft'],
      },
    ])
  })

  it('describes PRD drafting as full answers first and PRD drafts second', () => {
    const prdDraftPhase = WORKFLOW_PHASES.find((phase) => phase.id === 'DRAFTING_PRD')

    expect(prdDraftPhase?.contextSections).toEqual([
      {
        label: 'Part 1',
        description: 'Answering Skipped Questions',
        keys: ['relevant_files', 'ticket_details', 'interview'],
      },
      {
        label: 'Part 2',
        description: 'Generating PRD Drafts',
        keys: ['relevant_files', 'ticket_details', 'full_answers'],
      },
    ])
  })

  it('adds a dedicated preparing-workspace execution phase before coding', () => {
    const preFlightPhase = WORKFLOW_PHASES.find((phase) => phase.id === 'PRE_FLIGHT_CHECK')
    const setupApprovalPhase = WORKFLOW_PHASES.find((phase) => phase.id === 'WAITING_EXECUTION_SETUP_APPROVAL')
    const setupPhase = WORKFLOW_PHASES.find((phase) => phase.id === 'PREPARING_EXECUTION_ENV')
    const codingPhase = WORKFLOW_PHASES.find((phase) => phase.id === 'CODING')

    expect(preFlightPhase?.details.transitions).toContain(
      'All Checks Pass → Approving Workspace Setup: The workflow advances to the setup-plan approval gate, which audits workspace readiness and drafts only any missing temporary setup before anything mutates the worktree.',
    )
    expect(setupApprovalPhase?.label).toBe('Approving Workspace Setup')
    expect(setupApprovalPhase?.reviewArtifactType).toBe('execution_setup_plan')
    expect(setupPhase?.label).toBe('Preparing Workspace Runtime')
    expect(setupPhase?.description).toContain('Verifying readiness and performing only the missing temporary execution setup before coding begins.')
    expect(setupPhase?.contextSummary).toEqual(['ticket_details', 'beads', 'execution_setup_plan', 'execution_setup_notes'])
    expect(codingPhase?.contextSummary).toEqual(['bead_data', 'bead_notes'])
  })

  it('documents narrowed final test and pull request context', () => {
    const interviewPhase = WORKFLOW_PHASES.find((phase) => phase.id === 'WAITING_INTERVIEW_ANSWERS')
    const finalTestPhase = WORKFLOW_PHASES.find((phase) => phase.id === 'RUNNING_FINAL_TEST')
    const pullRequestPhase = WORKFLOW_PHASES.find((phase) => phase.id === 'CREATING_PULL_REQUEST')

    expect(interviewPhase?.contextSummary).toEqual(['ticket_details'])
    expect(finalTestPhase?.contextSummary).toEqual(['ticket_details', 'prd', 'beads', 'final_test_notes'])
    expect(pullRequestPhase?.contextSummary).toEqual(['ticket_details', 'prd'])
  })
})
