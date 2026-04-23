import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/lib/queryClient'

export interface DBartifact {
  id: number
  ticketId: string
  phase: string
  phaseAttempt: number
  artifactType: string
  filePath: string | null
  content: string | null
  createdAt: string
  updatedAt: string
}

export function normalizeTicketArtifact(input: unknown, fallbackTicketId?: string): DBartifact | null {
  if (!input || typeof input !== 'object') return null

  const raw = input as Record<string, unknown>
  const id = typeof raw.id === 'number' ? raw.id : Number(raw.id)
  if (!Number.isFinite(id)) return null

  const phase = typeof raw.phase === 'string' ? raw.phase : null
  const phaseAttempt = typeof raw.phaseAttempt === 'number' && Number.isFinite(raw.phaseAttempt)
    ? raw.phaseAttempt
    : Number(raw.phaseAttempt)
  const artifactType = typeof raw.artifactType === 'string'
    ? raw.artifactType
    : raw.artifactType == null
      ? ''
      : null
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : null
  const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : createdAt
  if (!phase || !Number.isFinite(phaseAttempt) || phaseAttempt <= 0 || artifactType === null || !createdAt || !updatedAt) return null

  const ticketId = typeof raw.ticketId === 'string'
    ? raw.ticketId
    : fallbackTicketId ?? (raw.ticketId != null ? String(raw.ticketId) : '')

  return {
    id,
    ticketId,
    phase,
    phaseAttempt,
    artifactType,
    filePath: typeof raw.filePath === 'string' ? raw.filePath : null,
    content: typeof raw.content === 'string' ? raw.content : null,
    createdAt,
    updatedAt,
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

async function fetchTicketArtifacts(
  ticketId: string,
  options?: {
    phase?: string
    phaseAttempt?: number
  },
): Promise<DBartifact[]> {
  const params = new URLSearchParams()
  if (options?.phase) params.set('phase', options.phase)
  if (typeof options?.phaseAttempt === 'number' && Number.isFinite(options.phaseAttempt) && options.phaseAttempt > 0) {
    params.set('phaseAttempt', String(options.phaseAttempt))
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : ''
  const res = await fetch(`/api/tickets/${ticketId}/artifacts${suffix}`)
  if (!res.ok) return []
  const payload = await res.json()
  if (!Array.isArray(payload)) return []
  return payload
    .map((artifact) => normalizeTicketArtifact(artifact, ticketId))
    .filter((artifact): artifact is DBartifact => artifact !== null)
}

export function getTicketArtifactsQueryKey(ticketId: string, options?: { phase?: string; phaseAttempt?: number }) {
  return [
    'ticket-artifacts',
    ticketId,
    options?.phase ?? '__all__',
    typeof options?.phaseAttempt === 'number' && Number.isFinite(options.phaseAttempt) && options.phaseAttempt > 0
      ? options.phaseAttempt
      : 'active',
  ] as const
}

export function clearTicketArtifactsCache(ticketId: string) {
  queryClient.removeQueries({ queryKey: ['ticket-artifacts', ticketId] })
}

/**
 * Fetches and caches ticket artifacts. Returns cached data instantly on cache hit,
 * then background-refreshes for live phases.
 */
export function useTicketArtifacts(
  ticketId?: string,
  opts?: {
    skipFetch?: boolean
    phase?: string
    phaseAttempt?: number
  },
) {
  const queryKey = ticketId
    ? getTicketArtifactsQueryKey(ticketId, { phase: opts?.phase, phaseAttempt: opts?.phaseAttempt })
    : ['ticket-artifacts', '__missing__'] as const

  const cached = ticketId
    ? queryClient.getQueryData<DBartifact[]>(getTicketArtifactsQueryKey(ticketId, { phase: opts?.phase, phaseAttempt: opts?.phaseAttempt }))
    : undefined

  const query = useQuery({
    queryKey,
    queryFn: () => fetchTicketArtifacts(ticketId!, { phase: opts?.phase, phaseAttempt: opts?.phaseAttempt }),
    enabled: !!ticketId && !opts?.skipFetch,
    // Only hydrate from the exact query cache entry for this ticket.
    placeholderData: cached,
  })

  return {
    artifacts: opts?.skipFetch ? (cached ?? []) : (query.data ?? cached ?? []),
    isLoading: opts?.skipFetch ? false : query.isLoading,
  }
}
