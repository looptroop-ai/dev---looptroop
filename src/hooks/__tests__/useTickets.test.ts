import { describe, expect, it } from 'vitest'
import {
  getTicketAutoRefreshInterval,
  getTicketsAutoRefreshInterval,
} from '../useTickets'

describe('useTickets auto-refresh helpers', () => {
  it('refreshes active ticket detail queries but not terminal tickets', () => {
    expect(getTicketAutoRefreshInterval({ status: 'CODING' } as { status: string })).toBe(5000)
    expect(getTicketAutoRefreshInterval({ status: 'WAITING_PR_REVIEW' } as { status: string })).toBe(5000)
    expect(getTicketAutoRefreshInterval({ status: 'COMPLETED' } as { status: string })).toBe(false)
    expect(getTicketAutoRefreshInterval({ status: 'CANCELED' } as { status: string })).toBe(false)
    expect(getTicketAutoRefreshInterval(null)).toBe(false)
  })

  it('refreshes ticket lists only while they contain active work', () => {
    expect(getTicketsAutoRefreshInterval([{ status: 'CANCELED' }] as Array<{ status: string }>)).toBe(false)
    expect(getTicketsAutoRefreshInterval([{ status: 'COMPLETED' }] as Array<{ status: string }>)).toBe(false)
    expect(getTicketsAutoRefreshInterval([{ status: 'CODING' }, { status: 'CANCELED' }] as Array<{ status: string }>)).toBe(10000)
    expect(getTicketsAutoRefreshInterval(undefined)).toBe(false)
  })
})
