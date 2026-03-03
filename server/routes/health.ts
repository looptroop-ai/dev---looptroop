import { Hono } from 'hono'

const health = new Hono()

health.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  })
})

health.get('/health/opencode', (c) => {
  // Stub - will check OpenCode connectivity in Milestone 9
  return c.json({
    status: 'unavailable',
    message: 'OpenCode health check not yet implemented',
  })
})

export { health }
