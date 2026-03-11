import { Hono } from 'hono'
import { getOpenCodeAdapter } from '../opencode/factory'
import { fetchProviderCatalog, flattenCatalogModels } from '../opencode/providerCatalog'

const modelsRouter = new Hono()

modelsRouter.get('/models', async (c) => {
  try {
    const catalog = await fetchProviderCatalog()
    return c.json({
      models: flattenCatalogModels(catalog, 'connected'),
      allModels: flattenCatalogModels(catalog, 'all'),
      connectedProviders: catalog.connected,
      defaultModels: catalog.default,
    })
  } catch {
    const adapter = getOpenCodeAdapter()
    const health = await adapter.checkHealth()
    return c.json({
      models: [],
      allModels: [],
      connectedProviders: [],
      defaultModels: {},
      message: health.available
        ? 'OpenCode catalog is not available.'
        : 'OpenCode server is not reachable. Start it with `opencode serve`.',
    })
  }
})

export { modelsRouter }
