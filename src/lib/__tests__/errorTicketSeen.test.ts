import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearErrorTicketSeen,
  getErrorTicketSignature,
  markErrorTicketSeen,
  readErrorTicketSeen,
  resetErrorTicketSeenForTests,
} from '../errorTicketSeen'

afterEach(() => {
  resetErrorTicketSeenForTests()
  vi.restoreAllMocks()
})

describe('errorTicketSeen', () => {
  it('falls back to in-memory state when localStorage writes fail', () => {
    const signature = getErrorTicketSignature({
      status: 'BLOCKED_ERROR',
      updatedAt: '2026-03-11T12:00:00.000Z',
      errorMessage: 'storage failure',
    })

    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })

    markErrorTicketSeen('3:BSM-2', signature)

    expect(readErrorTicketSeen('3:BSM-2', signature)).toBe(true)
  })

  it('clears the in-memory fallback when the ticket leaves error state', () => {
    const signature = getErrorTicketSignature({
      status: 'BLOCKED_ERROR',
      updatedAt: '2026-03-11T12:00:00.000Z',
      errorMessage: 'storage failure',
    })

    markErrorTicketSeen('3:BSM-2', signature)
    clearErrorTicketSeen('3:BSM-2')

    expect(readErrorTicketSeen('3:BSM-2', signature)).toBe(false)
  })
})
