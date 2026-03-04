import { Hono } from 'hono'
import { db } from '../db/index'
import { tickets } from '../db/schema'
import { eq } from 'drizzle-orm'
import * as fs from 'node:fs'
import * as path from 'node:path'

const beadsRouter = new Hono()

function resolveBeadsPath(externalId: string, flow: string): string {
  return path.join('.looptroop', 'worktrees', externalId, '.ticket', 'beads', flow, '.beads', 'issues.jsonl')
}

beadsRouter.get('/tickets/:id/beads', (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid ticket ID' }, 400)

  const ticket = db.select().from(tickets).where(eq(tickets.id, id)).get()
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)

  const flow = c.req.query('flow') ?? 'main'
  const filePath = resolveBeadsPath(ticket.externalId, flow)

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
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid ticket ID' }, 400)

  const ticket = db.select().from(tickets).where(eq(tickets.id, id)).get()
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)

  const flow = c.req.query('flow') ?? 'main'
  const body = await c.req.json()

  if (!Array.isArray(body)) {
    return c.json({ error: 'Request body must be a JSON array' }, 400)
  }

  const filePath = resolveBeadsPath(ticket.externalId, flow)
  const dir = path.dirname(filePath)

  // Atomic write: write to temp file then rename
  fs.mkdirSync(dir, { recursive: true })
  const jsonl = body.map((item: unknown) => JSON.stringify(item)).join('\n') + '\n'
  const tmpPath = filePath + '.tmp'
  fs.writeFileSync(tmpPath, jsonl, 'utf-8')
  try {
    fs.renameSync(tmpPath, filePath)
  } catch {
    try { fs.unlinkSync(tmpPath) } catch { /* ignore cleanup error */ }
    return c.json({ error: 'Failed to write file' }, 500)
  }

  return c.json({ success: true })
})

export { beadsRouter }
