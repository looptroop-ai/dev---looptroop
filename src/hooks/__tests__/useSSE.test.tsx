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

  emitOpen() {
    if (this.closed) return
    const event = new Event('open')
    for (const listener of this.listeners.get('open') ?? []) {
      listener(event as MessageEvent)
    }
  }

  emitTransportError() {
    if (this.closed) return
    this.onerror?.call(this as unknown as EventSource, new Event('error'))
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

  it('refreshes interview data when a ticket enters interview approval', async () => {
    const ticketId = '1:T-42'
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    renderHook(() => useSSE({ ticketId, onEvent: vi.fn<SSEHandler>() }))

    await waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
    })

    const source = MockEventSource.instances[0]!

    await act(async () => {
      source.emit('state_change', {
        ticketId,
        from: 'VERIFYING_INTERVIEW_COVERAGE',
        to: 'WAITING_INTERVIEW_APPROVAL',
      }, '1')
    })

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['interview', ticketId] })
    })
  })

  it('refreshes the bead list when a bead completes', async () => {
    const ticketId = '1:T-42'
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    renderHook(() => useSSE({ ticketId, onEvent: vi.fn<SSEHandler>() }))

    await waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
    })

    const source = MockEventSource.instances[0]!

    await act(async () => {
      source.emit('bead_complete', {
        ticketId,
        beadId: 'bead-2',
        completed: 2,
        total: 5,
      }, '1')
    })

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['ticket', ticketId] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['ticket-beads', ticketId] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bead-diff', ticketId, 'bead-2'], exact: true })
    })
  })

  it('refreshes the bead diff when a bead diff artifact arrives', async () => {
    const ticketId = '1:T-42'
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    renderHook(() => useSSE({ ticketId, onEvent: vi.fn<SSEHandler>() }))

    await waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
    })

    const source = MockEventSource.instances[0]!

    await act(async () => {
      source.emit('artifact_change', {
        ticketId,
        artifactType: 'bead_diff:bead-2',
        artifact: {
          id: 17,
          ticketId,
          phase: 'CODING',
          artifactType: 'bead_diff:bead-2',
          filePath: null,
          content: 'diff --git a/file.ts b/file.ts',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      }, '1')
    })

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bead-diff', ticketId, 'bead-2'], exact: true })
    })
  })

  it('refreshes ticket runtime when coding bead retry metadata arrives via SSE logs', async () => {
    const ticketId = '1:T-42'
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    renderHook(() => useSSE({ ticketId, onEvent: vi.fn<SSEHandler>() }))

    await waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
    })

    const source = MockEventSource.instances[0]!

    await act(async () => {
      source.emit('log', {
        ticketId,
        phase: 'CODING',
        type: 'info',
        source: 'system',
        beadId: 'bead-1',
        content: 'Reset bead bead-1 to its start snapshot and appended retry notes for attempt 2.',
        streaming: false,
      }, '1')
    })

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['ticket', ticketId] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['ticket-beads', ticketId] })
    })
  })

  it('tracks reconnecting state when the live stream drops', async () => {
    const ticketId = '1:T-42'
    const { result } = renderHook(() => useSSE({ ticketId, onEvent: vi.fn<SSEHandler>() }))

    await waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
      expect(result.current.connectionState).toBe('connecting')
    })

    const source = MockEventSource.instances[0]!

    await act(async () => {
      source.emitOpen()
    })

    await waitFor(() => {
      expect(result.current.connectionState).toBe('connected')
    })

    await act(async () => {
      source.emitTransportError()
    })

    await waitFor(() => {
      expect(result.current.connectionState).toBe('reconnecting')
    })
  })

  it('reconciles ticket caches immediately when the SSE transport errors', async () => {
    const ticketId = '1:T-42'
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    renderHook(() => useSSE({ ticketId, onEvent: vi.fn<SSEHandler>() }))

    await waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
    })

    const source = MockEventSource.instances[0]!

    await act(async () => {
      source.emitTransportError()
    })

    await waitFor(() => {
      expect(source.closed).toBe(true)
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['ticket', ticketId] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tickets'] })
    })
  })
})
