import { useCallback, useEffect, useRef, useState } from 'react'
import { queryClient } from '@/lib/queryClient'
import { getApiUrl, waitForDevBackend } from '@/lib/devApi'
import { SSE_RECONNECT_DELAY_MS } from '@/lib/constants'
import { getBeadDiffQueryKey } from '@/lib/beadDiffQuery'
import { SERVER_LOG_REFRESH_EVENT } from '@/context/logUtils'
import { patchTicketStatusInCache } from './ticketStatusCache'
import {
  getTicketArtifactsQueryKey,
  mergeTicketArtifactSnapshot,
  normalizeTicketArtifact,
  type DBartifact,
} from './useTicketArtifacts'

interface SSEOptions {
  ticketId: string | null
  onEvent?: (event: { type: string; data: Record<string, unknown> }) => void
}

export type SSEConnectionState = 'connecting' | 'connected' | 'reconnecting'

const LAST_EVENT_ID_STORAGE_PREFIX = 'looptroop-sse-last-event-id:'

function getLastEventIdStorageKey(ticketId: string) {
  return `${LAST_EVENT_ID_STORAGE_PREFIX}${ticketId}`
}

function readPersistedLastEventId(ticketId: string): string {
  if (typeof window === 'undefined') return '0'
  try {
    const stored = localStorage.getItem(getLastEventIdStorageKey(ticketId))
    return stored && stored !== '0' ? stored : '0'
  } catch {
    return '0'
  }
}

function persistLastEventId(ticketId: string, lastEventId: string) {
  if (!lastEventId || lastEventId === '0' || typeof window === 'undefined') return
  try {
    localStorage.setItem(getLastEventIdStorageKey(ticketId), lastEventId)
  } catch {
    // Best-effort only.
  }
}

function invalidateBeadDiffQuery(ticketId: string, beadId: unknown) {
  if (typeof beadId !== 'string' || beadId.length === 0) return
  queryClient.invalidateQueries({ queryKey: getBeadDiffQueryKey(ticketId, beadId), exact: true })
}

function getBeadIdFromArtifactType(artifactType: unknown): string | null {
  if (typeof artifactType !== 'string' || !artifactType.startsWith('bead_diff:')) return null
  const beadId = artifactType.slice('bead_diff:'.length)
  return beadId.length > 0 ? beadId : null
}

function dispatchServerLogRefresh(ticketId: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(SERVER_LOG_REFRESH_EVENT, { detail: { ticketId } }))
}

function recoverTicketAfterStreamGap(ticketId: string) {
  queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] })
  queryClient.invalidateQueries({ queryKey: ['tickets'] })
  queryClient.invalidateQueries({ queryKey: ['ticket-artifacts', ticketId] })
  queryClient.invalidateQueries({ queryKey: ['interview', ticketId] })
  queryClient.invalidateQueries({ queryKey: ['artifact', ticketId, 'interview'] })
  queryClient.invalidateQueries({ queryKey: ['artifact', ticketId, 'execution-setup-plan'] })
  queryClient.invalidateQueries({ queryKey: ['ticket-beads', ticketId] })
  queryClient.invalidateQueries({ queryKey: ['artifact', ticketId, 'beads'] })
  dispatchServerLogRefresh(ticketId)
}

export function useSSE({ ticketId, onEvent }: SSEOptions) {
  const eventSourceRef = useRef<EventSource | null>(null)
  const lastEventIdRef = useRef<string>('0')
  const recoverOnOpenRef = useRef(false)
  const reconnectRef = useRef<(() => void) | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connectTokenRef = useRef(0)
  // Keep the connection stable per ticket while always dispatching to the latest callback.
  const onEventRef = useRef(onEvent)
  const [connectionState, setConnectionState] = useState<SSEConnectionState>(ticketId ? 'connecting' : 'connected')

  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    queueMicrotask(() => setConnectionState(ticketId ? 'connecting' : 'connected'))
  }, [ticketId])

  useEffect(() => {
    if (!ticketId) {
      lastEventIdRef.current = '0'
      recoverOnOpenRef.current = false
      return
    }

    const persistedLastEventId = readPersistedLastEventId(ticketId)
    lastEventIdRef.current = persistedLastEventId
    recoverOnOpenRef.current = persistedLastEventId !== '0'
  }, [ticketId])

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
    reconnectTimerRef.current = setTimeout(() => reconnectRef.current?.(), SSE_RECONNECT_DELAY_MS)
  }, [])

  const connect = useCallback(() => {
    if (!ticketId) return
    const connectToken = ++connectTokenRef.current
    setConnectionState((current) => (current === 'reconnecting' ? current : 'connecting'))

    void (async () => {
      try {
        await waitForDevBackend()
      } catch {
        setConnectionState('reconnecting')
        if (connectToken === connectTokenRef.current) scheduleReconnect()
        return
      }

      if (connectToken !== connectTokenRef.current || eventSourceRef.current) return

      const url = new URL(getApiUrl('/api/stream'))
      url.searchParams.set('ticketId', String(ticketId))
      if (lastEventIdRef.current && lastEventIdRef.current !== '0') {
        url.searchParams.set('lastEventId', lastEventIdRef.current)
      }

      const es = new EventSource(url.toString())
      eventSourceRef.current = es

      es.addEventListener('open', () => {
        setConnectionState('connected')
        if (recoverOnOpenRef.current) {
          recoverOnOpenRef.current = false
          recoverTicketAfterStreamGap(ticketId)
        }
      })

      es.addEventListener('state_change', (e) => {
        lastEventIdRef.current = e.lastEventId || lastEventIdRef.current
        persistLastEventId(ticketId, lastEventIdRef.current)
        try {
          const data = JSON.parse(e.data) as Record<string, unknown>
          if (ticketId && typeof data.to === 'string' && data.to.length > 0) {
            patchTicketStatusInCache(
              queryClient,
              ticketId,
              data.to,
              typeof data.previousStatus === 'string'
                ? data.previousStatus
                : (typeof data.from === 'string' ? data.from : undefined),
            )
          }
          queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] })
          if (data.to === 'WAITING_INTERVIEW_ANSWERS' || data.to === 'WAITING_INTERVIEW_APPROVAL') {
            queryClient.invalidateQueries({ queryKey: ['interview', ticketId] })
          }
          onEventRef.current?.({ type: 'state_change', data })
        } catch {
          // ignore parse errors
        }
      })

      es.addEventListener('progress', (e) => {
        lastEventIdRef.current = e.lastEventId || lastEventIdRef.current
        persistLastEventId(ticketId, lastEventIdRef.current)
        try {
          const data = JSON.parse(e.data) as Record<string, unknown>
          onEventRef.current?.({ type: 'progress', data })
        } catch {
          // ignore parse errors
        }
      })

      es.addEventListener('log', (e) => {
        lastEventIdRef.current = e.lastEventId || lastEventIdRef.current
        persistLastEventId(ticketId, lastEventIdRef.current)
        try {
          const data = JSON.parse(e.data) as Record<string, unknown>
          const phase = typeof data.phase === 'string' ? data.phase : ''
          const beadId = typeof data.beadId === 'string' ? data.beadId : ''
          const source = typeof data.source === 'string' ? data.source : ''
          const kind = typeof data.kind === 'string' ? data.kind : ''
          const streaming = data.streaming === true

          if (
            ticketId
            && phase === 'CODING'
            && beadId.length > 0
            && !streaming
            && (source === 'system' || kind === 'milestone')
          ) {
            queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] })
            queryClient.invalidateQueries({ queryKey: ['ticket-beads', ticketId] })
          }
          onEventRef.current?.({ type: 'log', data })
        } catch {
          // ignore parse errors
        }
      })

      // Named 'error' event from the server (MessageEvent with data)
      es.addEventListener('error', (e) => {
        const me = e as MessageEvent
        lastEventIdRef.current = me.lastEventId || lastEventIdRef.current
        persistLastEventId(ticketId, lastEventIdRef.current)
        if (typeof me.data !== 'string') return
        try {
          const data = JSON.parse(me.data) as Record<string, unknown>
          onEventRef.current?.({ type: 'error', data })
        } catch {
          // ignore parse errors
        }
      })

      es.addEventListener('bead_complete', (e) => {
        lastEventIdRef.current = e.lastEventId || lastEventIdRef.current
        persistLastEventId(ticketId, lastEventIdRef.current)
        try {
          const data = JSON.parse(e.data) as Record<string, unknown>
          queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] })
          queryClient.invalidateQueries({ queryKey: ['ticket-beads', ticketId] })
          invalidateBeadDiffQuery(ticketId, data.beadId)
          onEventRef.current?.({ type: 'bead_complete', data })
        } catch {
          // ignore parse errors
        }
      })

      es.addEventListener('needs_input', (e) => {
        lastEventIdRef.current = e.lastEventId || lastEventIdRef.current
        persistLastEventId(ticketId, lastEventIdRef.current)
        try {
          const data = JSON.parse(e.data) as Record<string, unknown>
          queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] })
          if ((data.type === 'interview_batch' || data.type === 'interview_error') && ticketId) {
            queryClient.invalidateQueries({ queryKey: ['interview', ticketId] })
          }
          onEventRef.current?.({ type: 'needs_input', data })
        } catch {
          // ignore parse errors
        }
      })

      es.addEventListener('artifact_change', (e) => {
        lastEventIdRef.current = e.lastEventId || lastEventIdRef.current
        persistLastEventId(ticketId, lastEventIdRef.current)
        try {
          const data = JSON.parse(e.data) as Record<string, unknown>
          const snapshot = normalizeTicketArtifact(
            data.artifact,
            typeof data.ticketId === 'string' ? data.ticketId : ticketId ?? undefined,
          )
          const artifactTicketId = typeof data.ticketId === 'string'
            ? data.ticketId
            : snapshot?.ticketId ?? null

          if (ticketId && (!artifactTicketId || artifactTicketId === ticketId)) {
            if (snapshot) {
              queryClient.setQueryData<DBartifact[]>(
                getTicketArtifactsQueryKey(ticketId),
                (current) => mergeTicketArtifactSnapshot(current, snapshot),
              )
              queryClient.invalidateQueries({ queryKey: ['ticket-artifacts', ticketId] })
            } else {
              queryClient.invalidateQueries({ queryKey: ['ticket-artifacts', ticketId] })
            }

            const beadId = getBeadIdFromArtifactType(
              typeof data.artifactType === 'string' ? data.artifactType : snapshot?.artifactType,
            )
            if (beadId) {
              invalidateBeadDiffQuery(ticketId, beadId)
            }
          }
          onEventRef.current?.({ type: 'artifact_change', data })
        } catch {
          // ignore parse errors
        }
      })

      es.onerror = () => {
        es.close()
        eventSourceRef.current = null
        recoverOnOpenRef.current = true
        setConnectionState('reconnecting')
        queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] })
        queryClient.invalidateQueries({ queryKey: ['tickets'] })
        scheduleReconnect()
      }
    })()
  }, [scheduleReconnect, ticketId])

  useEffect(() => {
    reconnectRef.current = connect
  }, [connect])

  useEffect(() => {
    queueMicrotask(connect)
    return () => {
      connectTokenRef.current += 1
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      eventSourceRef.current?.close()
      eventSourceRef.current = null
    }
  }, [connect])

  return { lastEventIdRef, connectionState }
}
