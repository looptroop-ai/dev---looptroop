import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useSSE } from '../useSSE'
import { queryClient } from '@/lib/queryClient'
import { getTicketArtifactsQueryKey } from '../useTicketArtifacts'

class FakeEventSource {
  static instances: FakeEventSource[] = []

  readonly url: string
  readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>()
  onerror: ((event: Event) => void) | null = null
  closed = false

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const existing = this.listeners.get(type) ?? []
    existing.push(listener)
    this.listeners.set(type, existing)
  }

  close() {
    this.closed = true
  }

  emit(type: string, data: unknown, lastEventId = '0') {
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
    FakeEventSource.instances = []
    queryClient.clear()
    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('patches ticket artifacts immediately when artifact_change includes a snapshot', async () => {
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined)
    const onEvent = vi.fn()

    const { unmount } = renderHook(() => useSSE({ ticketId: '7:KRPI4-7', onEvent }))

    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1)
    })

    const source = FakeEventSource.instances[0]!
    source.emit('artifact_change', {
      ticketId: '7:KRPI4-7',
      phase: 'COUNCIL_DELIBERATING',
      artifactType: 'interview_drafts',
      artifact: {
        id: 1,
        ticketId: '7:KRPI4-7',
        phase: 'COUNCIL_DELIBERATING',
        artifactType: 'interview_drafts',
        filePath: null,
        content: '{"drafts":[{"memberId":"openai/gpt-5","outcome":"completed"}]}',
        createdAt: '2026-03-10T08:28:07.962Z',
      },
    }, '42')

    expect(queryClient.getQueryData(getTicketArtifactsQueryKey('7:KRPI4-7'))).toEqual([
      {
        id: 1,
        ticketId: '7:KRPI4-7',
        phase: 'COUNCIL_DELIBERATING',
        artifactType: 'interview_drafts',
        filePath: null,
        content: '{"drafts":[{"memberId":"openai/gpt-5","outcome":"completed"}]}',
        createdAt: '2026-03-10T08:28:07.962Z',
      },
    ])
    expect(invalidateQueries).not.toHaveBeenCalled()
    expect(onEvent).toHaveBeenCalledWith({
      type: 'artifact_change',
      data: {
        ticketId: '7:KRPI4-7',
        phase: 'COUNCIL_DELIBERATING',
        artifactType: 'interview_drafts',
        artifact: {
          id: 1,
          ticketId: '7:KRPI4-7',
          phase: 'COUNCIL_DELIBERATING',
          artifactType: 'interview_drafts',
          filePath: null,
          content: '{"drafts":[{"memberId":"openai/gpt-5","outcome":"completed"}]}',
          createdAt: '2026-03-10T08:28:07.962Z',
        },
      },
    })

    unmount()
    expect(source.closed).toBe(true)
  })

  it('invalidates ticket artifacts when artifact_change arrives without a snapshot', async () => {
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined)
    const onEvent = vi.fn()

    const { unmount } = renderHook(() => useSSE({ ticketId: '7:KRPI4-7', onEvent }))

    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1)
    })

    const source = FakeEventSource.instances[0]!
    source.emit('artifact_change', {
      ticketId: '7:KRPI4-7',
      phase: 'COUNCIL_DELIBERATING',
      artifactType: 'interview_drafts',
    }, '42')

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['ticket-artifacts', '7:KRPI4-7'] })
    expect(onEvent).toHaveBeenCalledWith({
      type: 'artifact_change',
      data: {
        ticketId: '7:KRPI4-7',
        phase: 'COUNCIL_DELIBERATING',
        artifactType: 'interview_drafts',
      },
    })

    unmount()
    expect(source.closed).toBe(true)
  })
})
