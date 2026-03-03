import { Hono } from 'hono'

const modelsRouter = new Hono()

modelsRouter.get('/models', (c) => {
  // Stub — will query OpenCode for available models in Milestone 9
  return c.json({
    models: [],
    message: 'Model listing not yet implemented. Configure models in OpenCode.',
  })
})

export { modelsRouter }
