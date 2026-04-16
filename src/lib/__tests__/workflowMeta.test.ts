import { describe, expect, it } from 'vitest'
import { WORKFLOW_PHASES, getAvailableWorkflowActions } from '@shared/workflowMeta'
import { getCascadeEditWarningMessage } from '@/lib/workflowMeta'

describe.concurrent('getCascadeEditWarningMessage', () => {
  it('does not warn when editing interview before PRD has started', () => {
    expect(getCascadeEditWarningMessage('WAITING_INTERVIEW_APPROVAL', 'interview')).toBeNull()
  })

  it('does not warn when editing interview at PRD approval (PRD not yet approved)', () => {
    expect(getCascadeEditWarningMessage('WAITING_PRD_APPROVAL', 'interview')).toBeNull()
  })

  it('warns about PRD and Beads when editing interview at Beads approval', () => {
    expect(getCascadeEditWarningMessage('WAITING_BEADS_APPROVAL', 'interview')).toBe(
      'Editing Interview Results will restart the PRD and Beads phases. All previous PRD and Beads data will be lost.',
    )
  })

  it('does not warn when editing PRD before Beads has been approved', () => {
    expect(getCascadeEditWarningMessage('WAITING_PRD_APPROVAL', 'prd')).toBeNull()
  })

  it('warns when editing PRD once Beads drafting has started', () => {
    expect(getCascadeEditWarningMessage('DRAFTING_BEADS', 'prd')).toBe(
      'Editing the PRD will restart the Beads phase. All previous Beads data will be lost.',
    )
  })

  it('keeps warning when editing PRD during later execution phases', () => {
    expect(getCascadeEditWarningMessage('PRE_FLIGHT_CHECK', 'prd')).toBe(
      'Editing the PRD will restart the Beads phase. All previous Beads data will be lost.',
    )
  })

  it('never warns when editing beads', () => {
    expect(getCascadeEditWarningMessage('WAITING_BEADS_APPROVAL', 'beads')).toBeNull()
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

  it('shows only ticket details as allowed context while scanning relevant files', () => {
    const scanningPhase = WORKFLOW_PHASES.find((phase) => phase.id === 'SCANNING_RELEVANT_FILES')

    expect(scanningPhase?.contextSummary).toEqual(['ticket_details'])
  })

  it('uses the simplified description for PRD coverage verification', () => {
    const prdCoveragePhase = WORKFLOW_PHASES.find((phase) => phase.id === 'VERIFYING_PRD_COVERAGE')

    expect(prdCoveragePhase?.description).toBe(
      'LoopTroop checks the current PRD against the approved interview. If something is missing, it updates the PRD and checks again.',
    )
  })

  it('describes the two-step beads finalization flow', () => {
    const beadsRefinePhase = WORKFLOW_PHASES.find((phase) => phase.id === 'REFINING_BEADS')

    expect(beadsRefinePhase?.description).toBe(
      'Winning draft is consolidated into the final semantic beads blueprint using the strongest ideas from the losing drafts.',
    )
  })

  it('describes beads coverage as semantic review followed by final expansion', () => {
    const beadsCoveragePhase = WORKFLOW_PHASES.find((phase) => phase.id === 'VERIFYING_BEADS_COVERAGE')

    expect(beadsCoveragePhase?.description).toBe(
      'LoopTroop checks the current semantic beads blueprint against the approved PRD. If something is missing, it updates the blueprint, checks again, then expands the final version into execution-ready beads before approval.',
    )
    expect(beadsCoveragePhase?.contextSummary).toEqual(['prd', 'beads', 'relevant_files', 'ticket_details', 'beads_draft'])
    expect(beadsCoveragePhase?.contextSections).toEqual([
      {
        label: 'Part 1',
        description: 'Coverage Review',
        keys: ['prd', 'beads'],
      },
      {
        label: 'Part 2',
        description: 'Final Expansion',
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
      'All Checks Pass → Approve Workspace Setup: The workflow advances to the setup-plan approval gate, which drafts the temporary workspace-preparation plan before anything mutates the worktree.',
    )
    expect(setupApprovalPhase?.label).toBe('Approve Workspace Setup')
    expect(setupApprovalPhase?.reviewArtifactType).toBe('execution_setup_plan')
    expect(setupPhase?.label).toBe('Setting Up Workspace')
    expect(setupPhase?.description).toBe('Initializing a reusable temporary execution environment before coding begins.')
    expect(setupPhase?.contextSummary).toEqual(['ticket_details', 'relevant_files', 'prd', 'beads', 'execution_setup_plan', 'execution_setup_notes'])
    expect(codingPhase?.contextSummary).toEqual(['bead_data', 'bead_notes', 'execution_setup_profile'])
  })
})
