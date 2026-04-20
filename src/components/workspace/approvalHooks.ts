import { useEffect, type MutableRefObject } from 'react'

interface SaveTicketUiStateInput<T> {
  ticketId: string
  scope: string
  data: T
}

type SaveTicketUiStateFn<T> = (input: SaveTicketUiStateInput<T>) => void

interface UseDebouncedApprovalUiStateOptions<T> {
  enabled: boolean
  snapshot: T
  ticketId: string
  scope: string
  saveUiState: SaveTicketUiStateFn<T>
  lastSavedSnapshotRef: MutableRefObject<string>
  delayMs?: number
}

export function useApprovalDraftReset(
  ticketId: string,
  restoredDraftRef: MutableRefObject<boolean>,
  lastSavedSnapshotRef: MutableRefObject<string>,
) {
  useEffect(() => {
    restoredDraftRef.current = false
    lastSavedSnapshotRef.current = ''
  }, [ticketId, lastSavedSnapshotRef, restoredDraftRef])
}

export function useApprovalFocusAnchor(ticketId: string, eventName: string) {
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ ticketId?: string; anchorId?: string }>).detail
      if (!detail?.anchorId || String(detail.ticketId) !== String(ticketId)) return

      const target = document.getElementById(detail.anchorId)
      if (!target) return
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    window.addEventListener(eventName, handler as EventListener)
    return () => window.removeEventListener(eventName, handler as EventListener)
  }, [eventName, ticketId])
}

export function useDebouncedApprovalUiState<T>({
  enabled,
  snapshot,
  ticketId,
  scope,
  saveUiState,
  lastSavedSnapshotRef,
  delayMs = 350,
}: UseDebouncedApprovalUiStateOptions<T>) {
  useEffect(() => {
    if (!enabled) return

    const serialized = JSON.stringify(snapshot)
    if (serialized === lastSavedSnapshotRef.current) return

    const timer = window.setTimeout(() => {
      lastSavedSnapshotRef.current = serialized
      saveUiState({
        ticketId,
        scope,
        data: snapshot,
      })
    }, delayMs)

    return () => window.clearTimeout(timer)
  }, [delayMs, enabled, lastSavedSnapshotRef, saveUiState, scope, snapshot, ticketId])
}
