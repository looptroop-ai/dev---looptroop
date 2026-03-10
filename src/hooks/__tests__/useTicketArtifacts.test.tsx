import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { queryClient } from '@/lib/queryClient'
import { getTicketArtifactsQueryKey, useTicketArtifacts } from '../useTicketArtifacts'

const artifactA = [{
  id: 1,
  ticketId: '7:KRPI4-7',
  phase: 'COUNCIL_DELIBERATING',
  artifactType: 'interview_drafts',
  filePath: null,
  content: '{"drafts":[]}',
  createdAt: '2026-03-10T08:30:40.353Z',
}]
const fetchMock = vi.fn()

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('useTicketArtifacts', () => {
  beforeEach(() => {
    queryClient.clear()
    fetchMock.mockReset()
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/tickets/7:KRPI4-7/artifacts')) {
        return Promise.resolve({
          ok: true,
          json: async () => artifactA,
        } satisfies Partial<Response>)
      }
      if (url.endsWith('/api/tickets/7:KRPI4-8/artifacts')) {
        return new Promise<Partial<Response>>(() => undefined)
      }
      return Promise.resolve({
        ok: true,
        json: async () => [],
      } satisfies Partial<Response>)
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    queryClient.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('does not reuse a previous ticket artifact list while a new ticket is loading', async () => {
    const { result, rerender } = renderHook(
      ({ ticketId }) => useTicketArtifacts(ticketId),
      {
        initialProps: { ticketId: '7:KRPI4-7' },
        wrapper,
      },
    )

    await waitFor(() => {
      expect(result.current.artifacts).toEqual(artifactA)
    })

    rerender({ ticketId: '7:KRPI4-8' })

    expect(result.current.artifacts).toEqual([])
    expect(result.current.isLoading).toBe(true)
  })

  it('reads the current ticket artifact list from the react-query cache when fetching is skipped', () => {
    queryClient.setQueryData(getTicketArtifactsQueryKey('7:KRPI4-7'), artifactA)

    const { result } = renderHook(
      () => useTicketArtifacts('7:KRPI4-7', { skipFetch: true }),
      { wrapper },
    )

    expect(result.current.artifacts).toEqual(artifactA)
    expect(result.current.isLoading).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
