import { useEffect, useRef, useCallback } from 'react'
import { queryClient } from '@/lib/queryClient'
import { getApiUrl, waitForDevBackend } from '@/lib/devApi'
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

export function useSSE({ ticketId, onEvent }: SSEOptions) {
  const eventSourceRef = useRef<EventSource | null>(null)
  const lastEventIdRef = useRef<string>('0')
  const reconnectRef = useRef<(() => void) | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connectTokenRef = useRef(0)

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
    reconnectTimerRef.current = setTimeout(() => reconnectRef.current?.(), 3000)
  }, [])

  const connect = useCallback(() => {
    if (!ticketId) return
    const connectToken = ++connectTokenRef.current

    void (async () => {
      try {
        await waitForDevBackend()
      } catch {
        if (connectToken === connectTokenRef.current) scheduleReconnect()
        return
      }

      if (connectToken !== connectTokenRef.current || eventSourceRef.current) return

      const url = new URL(getApiUrl('/api/stream', { directInDevelopment: true }))
      url.searchParams.set('ticketId', String(ticketId))
      if (lastEventIdRef.current && lastEventIdRef.current !== '0') {
        url.searchParams.set('lastEventId', lastEventIdRef.current)
      }

      const es = new EventSource(url.toString())
      eventSourceRef.current = es

      es.addEventListener('state_change', (e) => {
        lastEventIdRef.current = e.lastEventId || lastEventIdRef.current
        try {
          const data = JSON.parse(e.data) as Record<string, unknown>
          queryClient.invalidateQueries({ queryKey: ['tickets'] })
          queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] })
          onEvent?.({ type: 'state_change', data })
        } catch {
          // ignore parse errors
        }
      })

      es.addEventListener('progress', (e) => {
        lastEventIdRef.current = e.lastEventId || lastEventIdRef.current
        try {
          const data = JSON.parse(e.data) as Record<string, unknown>
          onEvent?.({ type: 'progress', data })
        } catch {
          // ignore parse errors
        }
      })

      es.addEventListener('log', (e) => {
        lastEventIdRef.current = e.lastEventId || lastEventIdRef.current
        try {
          const data = JSON.parse(e.data) as Record<string, unknown>
          onEvent?.({ type: 'log', data })
        } catch {
          // ignore parse errors
        }
      })

      // Named 'error' event from the server (MessageEvent with data)
      es.addEventListener('error', (e) => {
        const me = e as MessageEvent
        lastEventIdRef.current = me.lastEventId || lastEventIdRef.current
        if (typeof me.data !== 'string') return
        try {
          const data = JSON.parse(me.data) as Record<string, unknown>
          onEvent?.({ type: 'error', data })
        } catch {
          // ignore parse errors
        }
      })

      es.addEventListener('bead_complete', (e) => {
        lastEventIdRef.current = e.lastEventId || lastEventIdRef.current
        try {
          const data = JSON.parse(e.data) as Record<string, unknown>
          queryClient.invalidateQueries({ queryKey: ['tickets'] })
          onEvent?.({ type: 'bead_complete', data })
        } catch {
          // ignore parse errors
        }
      })

      es.addEventListener('needs_input', (e) => {
        lastEventIdRef.current = e.lastEventId || lastEventIdRef.current
        try {
          const data = JSON.parse(e.data) as Record<string, unknown>
          queryClient.invalidateQueries({ queryKey: ['tickets'] })
          // Invalidate interview-batch query so InterviewQAView refetches
          if (data.type === 'interview_batch' && ticketId) {
            queryClient.invalidateQueries({ queryKey: ['interview-batch', ticketId] })
          }
          onEvent?.({ type: 'needs_input', data })
        } catch {
          // ignore parse errors
        }
      })

      es.addEventListener('artifact_change', (e) => {
        lastEventIdRef.current = e.lastEventId || lastEventIdRef.current
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
            } else {
              queryClient.invalidateQueries({ queryKey: getTicketArtifactsQueryKey(ticketId) })
            }
          }
          onEvent?.({ type: 'artifact_change', data })
        } catch {
          // ignore parse errors
        }
      })

      es.onerror = () => {
        es.close()
        eventSourceRef.current = null
        scheduleReconnect()
      }
    })()
  }, [ticketId, onEvent, scheduleReconnect])

  useEffect(() => {
    reconnectRef.current = connect
  }, [connect])

  useEffect(() => {
    connect()
    return () => {
      connectTokenRef.current += 1
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      eventSourceRef.current?.close()
      eventSourceRef.current = null
    }
  }, [connect])

  return { lastEventIdRef }
}
