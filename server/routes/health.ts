import { Hono } from 'hono'
import { OpenCodeSDKAdapter } from '../opencode/adapter'

const health = new Hono()
const adapter = new OpenCodeSDKAdapter()

health.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  })
})

health.get('/health/opencode', async (c) => {
  const result = await adapter.checkHealth()
  return c.json({
    status: result.available ? 'ok' : 'unavailable',
    version: result.version,
    models: result.models ?? [],
    ...(result.error ? { error: result.error } : {}),
  })
})

export { health }
