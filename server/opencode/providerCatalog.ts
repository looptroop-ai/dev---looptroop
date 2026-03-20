import { getOpenCodeBaseUrl } from './runtimeConfig'
import type { OpenCodeCatalogModel, OpenCodeCatalogResponse } from '../../shared/opencodeCatalog'
import { isMockOpenCodeMode } from './factory'
import { SDK_OPERATION_TIMEOUT_MS, DEFAULT_CONTEXT_WINDOW_LIMIT } from '../lib/constants'

function buildMockCatalog(): OpenCodeCatalogResponse {
  return {
    connected: ['openai', 'anthropic', 'google'],
    default: {
      chat: 'openai/codex-mini-latest',
    },
    all: [
      {
        id: 'openai',
        name: 'OpenAI',
        env: [],
        npm: [],
        models: {
          'codex-mini-latest': {
            id: 'codex-mini-latest',
            name: 'Codex Mini Latest',
            status: 'active',
            capabilities: { reasoning: true, toolcall: true, input: { image: false } },
            limit: { context: DEFAULT_CONTEXT_WINDOW_LIMIT },
            cost: { input: 0, output: 0 },
            variants: { low: { reasoningEffort: 'low' }, medium: { reasoningEffort: 'medium' }, high: { reasoningEffort: 'high' } },
          },
          'gpt-5.3-codex': {
            id: 'gpt-5.3-codex',
            name: 'GPT-5.3 Codex',
            status: 'active',
            capabilities: { reasoning: true, toolcall: true, input: { image: false } },
            limit: { context: DEFAULT_CONTEXT_WINDOW_LIMIT },
            cost: { input: 0, output: 0 },
            variants: { low: { reasoningEffort: 'low' }, medium: { reasoningEffort: 'medium' }, high: { reasoningEffort: 'high' }, xhigh: { reasoningEffort: 'xhigh' } },
          },
        },
      },
      {
        id: 'anthropic',
        name: 'Anthropic',
        env: [],
        npm: [],
        models: {
          'claude-sonnet-4': {
            id: 'claude-sonnet-4',
            name: 'Claude Sonnet 4',
            status: 'active',
            capabilities: { reasoning: true, toolcall: true, input: { image: false } },
            limit: { context: DEFAULT_CONTEXT_WINDOW_LIMIT },
            cost: { input: 0, output: 0 },
            variants: { high: { thinking: { type: 'enabled', budgetTokens: 16000 } }, max: { thinking: { type: 'enabled', budgetTokens: 31999 } } },
          },
        },
      },
      {
        id: 'google',
        name: 'Google',
        env: [],
        npm: [],
        models: {
          'gemini-2.5-pro': {
            id: 'gemini-2.5-pro',
            name: 'Gemini 2.5 Pro',
            status: 'active',
            capabilities: { reasoning: true, toolcall: true, input: { image: false } },
            limit: { context: DEFAULT_CONTEXT_WINDOW_LIMIT },
            cost: { input: 0, output: 0 },
            variants: { high: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'high' } }, max: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'max' } } },
          },
        },
      },
    ],
  }
}

export async function fetchProviderCatalog(): Promise<OpenCodeCatalogResponse> {
  if (isMockOpenCodeMode()) {
    return buildMockCatalog()
  }

  const response = await fetch(`${getOpenCodeBaseUrl()}/provider`, {
    signal: AbortSignal.timeout(SDK_OPERATION_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`OpenCode provider catalog request failed with ${response.status}`)
  }

  const data = await response.json() as OpenCodeCatalogResponse
  return {
    all: Array.isArray(data.all) ? data.all : [],
    connected: Array.isArray(data.connected) ? data.connected.filter((item): item is string => typeof item === 'string') : [],
    default: data.default && typeof data.default === 'object' ? data.default : {},
  }
}

export function flattenCatalogModels(
  catalog: OpenCodeCatalogResponse,
  scope: 'connected' | 'all' = 'connected',
): OpenCodeCatalogModel[] {
  const connected = new Set(catalog.connected)
  const providers = scope === 'connected'
    ? catalog.all.filter((provider) => connected.has(provider.id))
    : catalog.all

  const models: OpenCodeCatalogModel[] = []
  for (const provider of providers) {
    const providerName = provider.name
    const providerId = provider.id
    const entries = provider.models ? Object.values(provider.models) : []
    for (const model of entries) {
      if ((model.status ?? 'active') !== 'active') continue
      models.push({
        fullId: `${providerId}/${model.id}`,
        id: model.id,
        name: model.name,
        providerID: providerId,
        providerName,
        family: model.family ?? '',
        costInput: model.cost?.input ?? 0,
        costOutput: model.cost?.output ?? 0,
        contextWindow: model.limit?.context ?? 0,
        canReason: model.capabilities?.reasoning ?? false,
        canUseTools: model.capabilities?.toolcall ?? false,
        canSeeImages: model.capabilities?.input?.image ?? false,
        status: model.status ?? 'active',
        ...(model.variants && Object.keys(model.variants).length > 0 ? { variants: model.variants } : {}),
      })
    }
  }

  return models.sort((left, right) =>
    left.providerName.localeCompare(right.providerName) || left.name.localeCompare(right.name),
  )
}

export async function fetchConnectedModelIds(): Promise<string[]> {
  const catalog = await fetchProviderCatalog()
  return flattenCatalogModels(catalog, 'connected').map((model) => model.fullId)
}
