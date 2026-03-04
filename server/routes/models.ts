import { Hono } from 'hono'
import { OpenCodeSDKAdapter } from '../opencode/adapter'

const modelsRouter = new Hono()
const adapter = new OpenCodeSDKAdapter()

modelsRouter.get('/models', async (c) => {
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
