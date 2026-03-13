import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '@/lib/queryClient'

vi.mock('@/lib/devApi', () => ({
  getApiUrl: (path: string) => `http://localhost:3000${path}`,
  waitForDevBackend: vi.fn(async () => undefined),
}))

import { useSSE } from '../useSSE'

type SSEHandler = (event: { type: string; data: Record<string, unknown> }) => void
type MockListener = (event: MessageEvent) => void

class MockEventSource {
  static instances: MockEventSource[] = []

  readonly url: string
  closed = false
  onerror: ((this: EventSource, ev: Event) => unknown) | null = null

  private listeners = new Map<string, Set<MockListener>>()

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: MockListener) {
    const bucket = this.listeners.get(type) ?? new Set<MockListener>()
    bucket.add(listener)
    this.listeners.set(type, bucket)
  }

  close() {
    this.closed = true
  }

  emit(type: string, data: Record<string, unknown>, lastEventId: string) {
    if (this.closed) return
    const event = {
      data: JSON.stringify(data),
      lastEventId,
    } as MessageEvent

    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }
}

describe('useSSE', () => {
  beforeEach(() => {
    queryClient.clear()
    MockEventSource.instances = []

    Object.defineProperty(globalThis, 'EventSource', {
      configurable: true,
      writable: true,
      value: MockEventSource,
    })
  })

  afterEach(() => {
    queryClient.clear()
    MockEventSource.instances = []
    vi.restoreAllMocks()
  })

  it('keeps a single EventSource for the same ticket and dispatches state changes to the latest callback after rerender', async () => {
    const ticketId = '1:T-42'
    const initialTicket = { id: ticketId, status: 'DRAFTING_PRD' }
    const initialList = [initialTicket, { id: '1:T-43', status: 'CODING' }]

    queryClient.setQueryData(['ticket', ticketId], initialTicket)
    queryClient.setQueryData(['tickets'], initialList)

    const firstOnEvent = vi.fn<SSEHandler>()
    const secondOnEvent = vi.fn<SSEHandler>()

    const { rerender, unmount } = renderHook(
      ({ onEvent }: { onEvent: SSEHandler }) => useSSE({ ticketId, onEvent }),
      { initialProps: { onEvent: firstOnEvent } },
    )

    await waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
    })

    const source = MockEventSource.instances[0]!

    rerender({ onEvent: secondOnEvent })

    await waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
      expect(source.closed).toBe(false)
    })

    await act(async () => {
      source.emit('state_change', {
        ticketId,
        from: 'DRAFTING_PRD',
        to: 'REFINING_PRD',
      }, '1')
    })

    await waitFor(() => {
      expect(secondOnEvent).toHaveBeenCalledWith({
        type: 'state_change',
        data: expect.objectContaining({
          ticketId,
          from: 'DRAFTING_PRD',
          to: 'REFINING_PRD',
        }),
      })
    })

    expect(firstOnEvent).not.toHaveBeenCalled()
    expect(queryClient.getQueryData(['ticket', ticketId])).toEqual({
      id: ticketId,
      status: 'REFINING_PRD',
    })
    expect(queryClient.getQueryData(['tickets'])).toEqual([
      { id: ticketId, status: 'REFINING_PRD' },
      { id: '1:T-43', status: 'CODING' },
    ])

    await act(async () => {
      source.emit('state_change', {
        ticketId,
        from: 'REFINING_PRD',
        to: 'CODING',
      }, '2')
    })

    await waitFor(() => {
      expect(secondOnEvent).toHaveBeenCalledTimes(2)
      expect(queryClient.getQueryData(['ticket', ticketId])).toEqual({
        id: ticketId,
        status: 'CODING',
      })
      expect(queryClient.getQueryData(['tickets'])).toEqual([
        { id: ticketId, status: 'CODING' },
        { id: '1:T-43', status: 'CODING' },
      ])
    })

    unmount()

    expect(source.closed).toBe(true)
  })
})
