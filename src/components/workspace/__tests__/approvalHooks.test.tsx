import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRef } from 'react'
import { useDebouncedApprovalUiState } from '../approvalHooks'

interface HarnessProps {
  snapshot: { value: string }
  saveUiState: (input: { ticketId: string; scope: string; data: { value: string } }) => Promise<unknown>
}

function useHarness({ snapshot, saveUiState }: HarnessProps) {
  const lastSavedSnapshotRef = useRef('')

  useDebouncedApprovalUiState({
    enabled: true,
    snapshot,
    ticketId: '1:T-42',
    scope: 'approval_prd',
    saveUiState,
    lastSavedSnapshotRef,
    delayMs: 10,
  })

  return lastSavedSnapshotRef
}

describe('useDebouncedApprovalUiState', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('marks a draft snapshot as saved only after the save succeeds', async () => {
    vi.useFakeTimers()
    const saveUiState = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ success: true })

    try {
      const { result, rerender } = renderHook(
        (props: HarnessProps) => useHarness(props),
        { initialProps: { snapshot: { value: 'first' }, saveUiState } },
      )

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
        await Promise.resolve()
      })

      expect(saveUiState).toHaveBeenCalledTimes(1)
      expect(result.current.current).toBe('')

      rerender({ snapshot: { value: 'first' }, saveUiState })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
        await Promise.resolve()
      })

      expect(result.current.current).toBe(JSON.stringify({ value: 'first' }))
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('flushes the latest unsaved snapshot on pagehide with a keepalive request', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    const saveUiState = vi.fn().mockResolvedValue({ success: true })

    renderHook(
      (props: HarnessProps) => useHarness(props),
      { initialProps: { snapshot: { value: 'leaving' }, saveUiState } },
    )

    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })

    expect(fetchSpy).toHaveBeenCalledWith('/api/tickets/1:T-42/ui-state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'approval_prd', data: { value: 'leaving' } }),
      keepalive: true,
    })
  })
})
