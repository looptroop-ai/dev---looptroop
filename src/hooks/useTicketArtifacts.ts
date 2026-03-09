import { useState, useEffect } from 'react'

interface DBartifact {
  id: number
  ticketId: string
  phase: string
  artifactType: string
  filePath: string | null
  content: string | null
  createdAt: string
}

// Module-level cache: persists across component mounts/unmounts and phase switches
const cache = new Map<string, DBartifact[]>()

export function clearTicketArtifactsCache(ticketId: string) {
  cache.delete(ticketId)
}

/**
 * Fetches and caches ticket artifacts. Returns cached data instantly on cache hit,
 * then background-refreshes for live phases.
 */
export function useTicketArtifacts(ticketId?: string, opts?: { skipFetch?: boolean }) {
  const cached = ticketId ? cache.get(ticketId) : undefined
  const [artifacts, setArtifacts] = useState<DBartifact[]>(cached ?? [])
  const [isLoading, setIsLoading] = useState(!cached && !!ticketId)

  useEffect(() => {
    if (!ticketId || opts?.skipFetch) return

    // If we have cache, serve it immediately (no loading state)
    const hasCached = cache.has(ticketId)
    if (hasCached) {
      setArtifacts(cache.get(ticketId)!)
      setIsLoading(false)
    } else {
      setIsLoading(true)
    }

    // Always fetch in background to pick up new artifacts for live phases
    fetch(`/api/tickets/${ticketId}/artifacts`)
      .then(r => r.ok ? r.json() : [])
      .then((data: DBartifact[]) => {
        cache.set(ticketId, data)
        setArtifacts(data)
        setIsLoading(false)
      })
      .catch(() => {
        setIsLoading(false)
      })
  }, [ticketId, opts?.skipFetch])

  return { artifacts, isLoading }
}

export type { DBartifact }
