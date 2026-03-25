import { useQuery, type QueryClient } from '@tanstack/react-query'
import type { OpenCodeCatalogModel } from '@shared/opencodeCatalog'
import { MODEL_FETCH_TIMEOUT_MS } from '@/lib/constants'

export interface ModelsApiResponse {
  models: OpenCodeCatalogModel[]
  allModels: OpenCodeCatalogModel[]
  connectedProviders: string[]
  defaultModels: Record<string, string>
  message?: string
}

export type OpenCodeModel = OpenCodeCatalogModel
export const OPENCODE_MODELS_QUERY_KEY = ['opencode-models'] as const

export async function fetchModelsApi(): Promise<ModelsApiResponse> {
  const res = await fetch('/api/models', { signal: AbortSignal.timeout(MODEL_FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error('Failed to fetch models')
  const data: ModelsApiResponse = await res.json()
  // When the backend cannot reach OpenCode it returns a `message` with an empty
  // model list (HTTP 200). Treat this as a retriable error so react-query retries
  // during the startup window while OpenCode is still initialising.
  if (data.message) throw new Error(data.message)
  return data
}

export function clearOpenCodeModelsQuery(queryClient: Pick<QueryClient, 'removeQueries'>) {
  queryClient.removeQueries({
    queryKey: OPENCODE_MODELS_QUERY_KEY,
    exact: true,
  })
}

export function refetchOpenCodeModelsQuery(queryClient: Pick<QueryClient, 'refetchQueries'>) {
  return queryClient.refetchQueries({
    queryKey: OPENCODE_MODELS_QUERY_KEY,
    exact: true,
    type: 'active',
  })
}

/** Returns only models from connected (configured) providers */
export function useOpenCodeModels() {
  return useQuery({
    queryKey: OPENCODE_MODELS_QUERY_KEY,
    queryFn: fetchModelsApi,
    staleTime: 5 * 60 * 1000,
    retry: 8,
    retryDelay: 3000,
    select: (data) => data.models,
  })
}

/** Returns all models from all providers */
export function useAllOpenCodeModels() {
  return useQuery({
    queryKey: OPENCODE_MODELS_QUERY_KEY,
    queryFn: fetchModelsApi,
    staleTime: 5 * 60 * 1000,
    retry: 8,
    retryDelay: 3000,
    select: (data) => data.allModels,
  })
}
