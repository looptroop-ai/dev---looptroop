import { useQuery } from '@tanstack/react-query'
import type { OpenCodeCatalogModel } from '@shared/opencodeCatalog'

export interface ModelsApiResponse {
  models: OpenCodeCatalogModel[]
  allModels: OpenCodeCatalogModel[]
  connectedProviders: string[]
  defaultModels: Record<string, string>
  message?: string
}

export type OpenCodeModel = OpenCodeCatalogModel

async function fetchModelsApi(): Promise<ModelsApiResponse> {
  const res = await fetch('/api/models', { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error('Failed to fetch models')
  return res.json()
}

/** Returns only models from connected (configured) providers */
export function useOpenCodeModels() {
  return useQuery({
    queryKey: ['opencode-models'],
    queryFn: fetchModelsApi,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    select: (data) => data.models,
  })
}

/** Returns all models from all providers */
export function useAllOpenCodeModels() {
  return useQuery({
    queryKey: ['opencode-models'],
    queryFn: fetchModelsApi,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    select: (data) => data.allModels,
  })
}
