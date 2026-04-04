import { describe, expect, it } from 'vitest'
import { WORKFLOW_PHASES } from '@shared/workflowMeta'
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
    expect(beadsCoveragePhase?.contextSummary).toEqual(['prd', 'beads'])
  })
})
