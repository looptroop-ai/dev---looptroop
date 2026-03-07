import { describe, expect, it } from 'vitest'
import { getCascadeEditWarningMessage } from '@/lib/workflowMeta'

describe('getCascadeEditWarningMessage', () => {
  it('does not warn when editing interview before PRD has started', () => {
    expect(getCascadeEditWarningMessage('WAITING_INTERVIEW_APPROVAL', 'interview')).toBeNull()
  })

  it('warns only about PRD when editing interview during the PRD phase', () => {
    expect(getCascadeEditWarningMessage('WAITING_PRD_APPROVAL', 'interview')).toBe(
      'Editing Interview Results will restart the PRD phase. All previous PRD data will be lost.',
    )
  })

  it('warns about PRD and Beads when both downstream phases have started', () => {
    expect(getCascadeEditWarningMessage('WAITING_BEADS_APPROVAL', 'interview')).toBe(
      'Editing Interview Results will restart the PRD and Beads phases. All previous PRD and Beads data will be lost.',
    )
  })

  it('does not warn when editing PRD before Beads has started', () => {
    expect(getCascadeEditWarningMessage('WAITING_PRD_APPROVAL', 'prd')).toBeNull()
  })

  it('warns about Beads when editing PRD after the Beads phase has started', () => {
    expect(getCascadeEditWarningMessage('WAITING_BEADS_APPROVAL', 'prd')).toBe(
      'Editing the PRD will restart the Beads phase. All previous Beads data will be lost.',
    )
  })

  it('never warns when editing beads', () => {
    expect(getCascadeEditWarningMessage('WAITING_BEADS_APPROVAL', 'beads')).toBeNull()
  })
})
