import { describe, expect, it } from 'vitest'
import { resolveReviewCutoffStatus } from '../ticketQueries'

describe('resolveReviewCutoffStatus', () => {
  it('uses the pre-error phase when a canceled ticket was canceled from BLOCKED_ERROR', () => {
    expect(resolveReviewCutoffStatus('CANCELED', 'BLOCKED_ERROR', 'CODING')).toBe('CODING')
  })

  it('keeps ordinary canceled tickets on their last working phase', () => {
    expect(resolveReviewCutoffStatus('CANCELED', 'CODING')).toBe('CODING')
  })

  it('keeps live blocked errors on the phase that failed', () => {
    expect(resolveReviewCutoffStatus('BLOCKED_ERROR', 'CODING')).toBe('CODING')
  })

  it('fails conservative when the blocked-error history is missing', () => {
    expect(resolveReviewCutoffStatus('CANCELED', 'BLOCKED_ERROR')).toBeNull()
  })
})
