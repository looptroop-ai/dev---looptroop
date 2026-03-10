import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/lib/queryClient'

export interface DBartifact {
  id: number
  ticketId: string
  phase: string
  artifactType: string
  filePath: string | null
  content: string | null
  createdAt: string
}

export function normalizeTicketArtifact(input: unknown, fallbackTicketId?: string): DBartifact | null {
  if (!input || typeof input !== 'object') return null

  const raw = input as Record<string, unknown>
  const id = typeof raw.id === 'number' ? raw.id : Number(raw.id)
  if (!Number.isFinite(id)) return null

  const phase = typeof raw.phase === 'string' ? raw.phase : null
  const artifactType = typeof raw.artifactType === 'string'
    ? raw.artifactType
    : raw.artifactType == null
      ? ''
      : null
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : null
  if (!phase || artifactType === null || !createdAt) return null

  const ticketId = typeof raw.ticketId === 'string'
    ? raw.ticketId
    : fallbackTicketId ?? (raw.ticketId != null ? String(raw.ticketId) : '')

  return {
    id,
    ticketId,
    phase,
    artifactType,
    filePath: typeof raw.filePath === 'string' ? raw.filePath : null,
    content: typeof raw.content === 'string' ? raw.content : null,
    createdAt,
  }
}

export function mergeTicketArtifactSnapshot(
  currentArtifacts: DBartifact[] | undefined,
  artifact: DBartifact,
): DBartifact[] {
  const existing = currentArtifacts ?? []
  const existingIndex = existing.findIndex(entry => entry.id === artifact.id)

  if (existingIndex < 0) {
    return [...existing, artifact]
  }

  return existing.map((entry, index) => (index === existingIndex ? artifact : entry))
}

async function fetchTicketArtifacts(ticketId: string): Promise<DBartifact[]> {
  const res = await fetch(`/api/tickets/${ticketId}/artifacts`)
  if (!res.ok) return []
  const payload = await res.json()
  if (!Array.isArray(payload)) return []
  return payload
    .map((artifact) => normalizeTicketArtifact(artifact, ticketId))
    .filter((artifact): artifact is DBartifact => artifact !== null)
}

export function getTicketArtifactsQueryKey(ticketId: string) {
  return ['ticket-artifacts', ticketId] as const
}

export function clearTicketArtifactsCache(ticketId: string) {
  queryClient.removeQueries({ queryKey: getTicketArtifactsQueryKey(ticketId), exact: true })
}

/**
 * Fetches and caches ticket artifacts. Returns cached data instantly on cache hit,
 * then background-refreshes for live phases.
 */
export function useTicketArtifacts(ticketId?: string, opts?: { skipFetch?: boolean }) {
  const queryKey = ticketId
    ? getTicketArtifactsQueryKey(ticketId)
    : ['ticket-artifacts', '__missing__'] as const

  const cached = ticketId
    ? queryClient.getQueryData<DBartifact[]>(getTicketArtifactsQueryKey(ticketId))
    : undefined

  const query = useQuery({
    queryKey,
    queryFn: () => fetchTicketArtifacts(ticketId!),
    enabled: !!ticketId && !opts?.skipFetch,
    // Only hydrate from the exact query cache entry for this ticket.
    placeholderData: cached,
  })

  return {
    artifacts: opts?.skipFetch ? (cached ?? []) : (query.data ?? cached ?? []),
    isLoading: opts?.skipFetch ? false : query.isLoading,
  }
}
