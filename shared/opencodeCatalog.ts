export interface OpenCodeCatalogModel {
  fullId: string
  id: string
  name: string
  providerID: string
  providerName: string
  family: string
  costInput: number
  costOutput: number
  contextWindow: number
  canReason: boolean
  canUseTools: boolean
  canSeeImages: boolean
  status: string
}

export interface OpenCodeCatalogResponse {
  all: Array<{
    id: string
    name: string
    env?: unknown[]
    npm?: unknown[]
    models: Record<string, {
      id: string
      name: string
      family?: string
      status?: string
      cost?: { input?: number; output?: number }
      limit?: { context?: number }
      capabilities?: {
        reasoning?: boolean
        toolcall?: boolean
        input?: { image?: boolean }
      }
    }>
  }>
  connected: string[]
  default: Record<string, string>
}
