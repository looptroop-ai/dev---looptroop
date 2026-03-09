import { Hono } from 'hono'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { getTicketByRef, getTicketPaths } from '../storage/tickets'
import { safeAtomicWrite } from '../io/atomicWrite'

const beadsRouter = new Hono()

function resolveBeadsPath(ticketId: string, flow: string): string | null {
  const paths = getTicketPaths(ticketId)
  if (!paths) return null
  return path.join(paths.ticketDir, 'beads', flow, '.beads', 'issues.jsonl')
}

beadsRouter.get('/tickets/:id/beads', (c) => {
  const ticketId = c.req.param('id')
  if (!getTicketByRef(ticketId)) return c.json({ error: 'Ticket not found' }, 404)

  const flow = c.req.query('flow') ?? 'main'
  const filePath = resolveBeadsPath(ticketId, flow)
  if (!filePath) return c.json({ error: 'Ticket not found' }, 404)

  if (!fs.existsSync(filePath)) {
    return c.json([])
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n').filter((line) => line.trim() !== '')
  try {
    const beads = lines.map((line) => JSON.parse(line))
    return c.json(beads)
  } catch {
    return c.json({ error: 'Corrupted JSONL data' }, 500)
  }
})

beadsRouter.put('/tickets/:id/beads', async (c) => {
  const ticketId = c.req.param('id')
  if (!getTicketByRef(ticketId)) return c.json({ error: 'Ticket not found' }, 404)

  const flow = c.req.query('flow') ?? 'main'
  const body = await c.req.json()
  if (!Array.isArray(body)) {
    return c.json({ error: 'Request body must be a JSON array' }, 400)
  }

  const filePath = resolveBeadsPath(ticketId, flow)
  if (!filePath) return c.json({ error: 'Ticket not found' }, 404)

  try {
    const jsonl = body.map((item: unknown) => JSON.stringify(item)).join('\n') + '\n'
    safeAtomicWrite(filePath, jsonl)
  } catch {
    return c.json({ error: 'Failed to write file' }, 500)
  }

  return c.json({ success: true })
})

export { beadsRouter }
