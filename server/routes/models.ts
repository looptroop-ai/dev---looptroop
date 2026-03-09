import { Hono } from 'hono'
import { getOpenCodeAdapter } from '../opencode/factory'

const modelsRouter = new Hono()

modelsRouter.get('/models', async (c) => {
  const adapter = getOpenCodeAdapter()
  const health = await adapter.checkHealth()
  if (!health.available) {
    return c.json({
      models: [],
      message: 'OpenCode server is not reachable. Start it with `opencode serve`.',
    })
  }
  return c.json({
    models: health.models ?? [],
    // TODO: OpenCode SDK does not yet expose a dedicated model-listing endpoint.
    // Models are returned from the health check when available. Once OpenCode
    // adds a /models endpoint, call adapter.listModels() here instead.
  })
})

export { modelsRouter }
