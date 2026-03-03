import { useQuery } from '@tanstack/react-query'

const OPENCODE_URL = 'http://127.0.0.1:4096'

export interface OpenCodeModel {
  fullId: string       // "anthropic/claude-3-5-sonnet-20241022"
  id: string           // "claude-3-5-sonnet-20241022"
  name: string         // "Claude Sonnet 3.5 v2"
  providerID: string   // "anthropic"
  providerName: string // "Anthropic"
  family: string       // "claude-sonnet"
  costInput: number    // per million tokens
  costOutput: number
  contextWindow: number
  canReason: boolean
  canUseTools: boolean
  canSeeImages: boolean
  status: string
}

interface RawModel {
  id: string
  name: string
  family: string
  status: string
  providerID: string
  cost?: { input?: number; output?: number }
  limit?: { context?: number; output?: number }
  capabilities?: {
    reasoning?: boolean
    toolcall?: boolean
    input?: { image?: boolean }
  }
}

interface RawProvider {
  id: string
  name: string
  models: Record<string, RawModel>
}

interface ProviderResponse {
  all: RawProvider[]
  connected: string[]
  default: Record<string, string>
}

async function fetchProviderData(): Promise<ProviderResponse> {
  const res = await fetch(`${OPENCODE_URL}/provider`, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error('Failed to fetch providers')
  return res.json()
}

function flattenModels(providers: RawProvider[]): OpenCodeModel[] {
  const models: OpenCodeModel[] = []
  for (const provider of providers) {
    for (const [, m] of Object.entries(provider.models)) {
      if (m.status !== 'active') continue
      models.push({
        fullId: `${provider.id}/${m.id}`,
        id: m.id,
        name: m.name,
        providerID: provider.id,
        providerName: provider.name,
        family: m.family ?? '',
        costInput: m.cost?.input ?? 0,
        costOutput: m.cost?.output ?? 0,
        contextWindow: m.limit?.context ?? 0,
        canReason: m.capabilities?.reasoning ?? false,
        canUseTools: m.capabilities?.toolcall ?? false,
        canSeeImages: m.capabilities?.input?.image ?? false,
        status: m.status,
      })
    }
  }
  // Sort: connected first, then alphabetically by provider then name
  models.sort((a, b) => a.providerName.localeCompare(b.providerName) || a.name.localeCompare(b.name))
  return models
}

/** Returns only models from connected (configured) providers */
export function useOpenCodeModels() {
  return useQuery({
    queryKey: ['opencode-models'],
    queryFn: fetchProviderData,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    select: (data) => {
      const connectedSet = new Set(data.connected)
      const connectedProviders = data.all.filter(p => connectedSet.has(p.id))
      return flattenModels(connectedProviders)
    },
  })
}

/** Returns all models from all providers */
export function useAllOpenCodeModels() {
  return useQuery({
    queryKey: ['opencode-models'],
    queryFn: fetchProviderData,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    select: (data) => flattenModels(data.all),
  })
}
