import type { Context, Next } from 'hono'

export async function validateJson(c: Context, next: Next) {
  if (['POST', 'PUT', 'PATCH'].includes(c.req.method)) {
    const contentType = c.req.header('content-type')
    if (contentType && !contentType.includes('application/json') && !contentType.includes('text/event-stream')) {
      return c.json({ error: 'Content-Type must be application/json' }, 415)
    }
  }
  await next()
}
