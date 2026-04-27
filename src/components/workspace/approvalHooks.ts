import { useEffect, useRef, type MutableRefObject } from 'react'

interface SaveTicketUiStateInput<T> {
  ticketId: string
  scope: string
  data: T
}

type SaveTicketUiStateFn<T> = (input: SaveTicketUiStateInput<T>) => Promise<unknown> | void

interface UseDebouncedApprovalUiStateOptions<T> {
  enabled: boolean
  snapshot: T
  ticketId: string
  scope: string
  saveUiState: SaveTicketUiStateFn<T>
  lastSavedSnapshotRef: MutableRefObject<string>
  delayMs?: number
}

function buildTicketUiStatePayload(scope: string, data: unknown): string {
  return JSON.stringify({ scope, data })
}

export function flushTicketUiStateSnapshot<T>(ticketId: string, scope: string, data: T): boolean {
  const payload = buildTicketUiStatePayload(scope, data)

  if (typeof fetch === 'function') {
    try {
      void fetch(`/api/tickets/${ticketId}/ui-state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => undefined)
      return true
    } catch {
      // Fall through to sendBeacon below.
    }
  }

  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    try {
      return navigator.sendBeacon(
        `/api/tickets/${ticketId}/ui-state`,
        new Blob([payload], { type: 'application/json' }),
      )
    } catch {
      return false
    }
  }

  return false
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
  const latestSnapshotRef = useRef<{
    enabled: boolean
    serialized: string
    snapshot: T
    ticketId: string
    scope: string
  } | null>(null)

  useEffect(() => {
    latestSnapshotRef.current = {
      enabled,
      serialized: JSON.stringify(snapshot),
      snapshot,
      ticketId,
      scope,
    }
  }, [enabled, scope, snapshot, ticketId])

  useEffect(() => {
    if (!enabled) return

    const serialized = JSON.stringify(snapshot)
    if (serialized === lastSavedSnapshotRef.current) return

    let canceled = false
    const timer = window.setTimeout(() => {
      const result = saveUiState({
        ticketId,
        scope,
        data: snapshot,
      })
      void Promise.resolve(result).then(() => {
        if (!canceled && latestSnapshotRef.current?.serialized === serialized) {
          lastSavedSnapshotRef.current = serialized
        }
      }).catch(() => undefined)
    }, delayMs)

    return () => {
      canceled = true
      window.clearTimeout(timer)
    }
  }, [delayMs, enabled, lastSavedSnapshotRef, saveUiState, scope, snapshot, ticketId])

  useEffect(() => {
    const flushLatest = () => {
      const latest = latestSnapshotRef.current
      if (!latest?.enabled || latest.serialized === lastSavedSnapshotRef.current) return
      flushTicketUiStateSnapshot(latest.ticketId, latest.scope, latest.snapshot)
    }

    window.addEventListener('pagehide', flushLatest)
    window.addEventListener('beforeunload', flushLatest)
    return () => {
      window.removeEventListener('pagehide', flushLatest)
      window.removeEventListener('beforeunload', flushLatest)
    }
  }, [lastSavedSnapshotRef])
}
