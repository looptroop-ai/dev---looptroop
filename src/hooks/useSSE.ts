import { useEffect, useRef, useCallback } from 'react'
import { queryClient } from '@/lib/queryClient'

interface SSEOptions {
  ticketId: number | null
  onEvent?: (event: { type: string; data: Record<string, unknown> }) => void
}

export function useSSE({ ticketId, onEvent }: SSEOptions) {
  const eventSourceRef = useRef<EventSource | null>(null)
  const lastEventIdRef = useRef<string>('0')
  const reconnectRef = useRef<(() => void) | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const connect = useCallback(() => {
    if (!ticketId) return

    const url = new URL(`/api/stream`, window.location.origin)
    url.searchParams.set('ticketId', String(ticketId))

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

    es.onerror = () => {
      es.close()
      // Clear any pending reconnect before scheduling a new one
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = setTimeout(() => reconnectRef.current?.(), 3000)
    }
  }, [ticketId, onEvent])

  useEffect(() => {
    reconnectRef.current = connect
  }, [connect])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      eventSourceRef.current?.close()
      eventSourceRef.current = null
    }
  }, [connect])

  return { lastEventIdRef }
}
