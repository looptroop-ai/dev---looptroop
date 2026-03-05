import { Hono } from 'hono'
import { db } from '../db/index'
import { tickets } from '../db/schema'
import { eq } from 'drizzle-orm'
import * as fs from 'node:fs'
import * as path from 'node:path'

const filesRouter = new Hono()

const VALID_FILES = ['interview', 'prd'] as const
type ValidFile = typeof VALID_FILES[number]

function isValidFile(file: string): file is ValidFile {
  return VALID_FILES.includes(file as ValidFile)
}

function resolveTicketFilePath(externalId: string, file: ValidFile): string {
  return path.join('.looptroop', 'worktrees', externalId, '.ticket', `${file}.yaml`)
}

filesRouter.get('/files/:ticketId/logs', (c) => {
  const ticketId = Number(c.req.param('ticketId'))
  if (isNaN(ticketId)) return c.json({ error: 'Invalid ticket ID' }, 400)

  const ticket = db.select().from(tickets).where(eq(tickets.id, ticketId)).get()
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)

  const logPath = path.join('.looptroop', 'worktrees', ticket.externalId, '.ticket', 'execution-log.jsonl')
  if (!fs.existsSync(logPath)) return c.json([])

  const raw = fs.readFileSync(logPath, 'utf-8')
  const entries: unknown[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try { entries.push(JSON.parse(line)) } catch { /* skip malformed lines */ }
  }

  const statusFilter = c.req.query('status')
  const phaseFilter = c.req.query('phase')
  const filtered = entries.filter((e: any) => {
    if (statusFilter && e.status !== statusFilter) return false
    if (phaseFilter && e.phase !== phaseFilter) return false
    return true
  })

  return c.json(filtered)
})

filesRouter.get('/files/:ticketId/:file', (c) => {
  const ticketId = Number(c.req.param('ticketId'))
  const file = c.req.param('file')

  if (isNaN(ticketId)) return c.json({ error: 'Invalid ticket ID' }, 400)
  if (!isValidFile(file)) return c.json({ error: 'Invalid file type. Must be one of: ' + VALID_FILES.join(', ') }, 400)

  const ticket = db.select().from(tickets).where(eq(tickets.id, ticketId)).get()
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)

  const filePath = resolveTicketFilePath(ticket.externalId, file)

  if (!fs.existsSync(filePath)) {
    return c.json({ content: '', exists: false })
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  return c.json({ content, exists: true })
})

filesRouter.put('/files/:ticketId/:file', async (c) => {
  const ticketId = Number(c.req.param('ticketId'))
  const file = c.req.param('file')

  if (isNaN(ticketId)) return c.json({ error: 'Invalid ticket ID' }, 400)
  if (!isValidFile(file)) return c.json({ error: 'Invalid file type. Must be one of: ' + VALID_FILES.join(', ') }, 400)

  const ticket = db.select().from(tickets).where(eq(tickets.id, ticketId)).get()
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)

  const body = await c.req.json()
  if (typeof body.content !== 'string') {
    return c.json({ error: 'Request body must include a "content" string field' }, 400)
  }

  const filePath = resolveTicketFilePath(ticket.externalId, file)
  const dir = path.dirname(filePath)

  // Atomic write: write to temp file then rename
  fs.mkdirSync(dir, { recursive: true })
  const tmpPath = filePath + '.tmp'
  fs.writeFileSync(tmpPath, body.content, 'utf-8')
  try {
    fs.renameSync(tmpPath, filePath)
  } catch {
    try { fs.unlinkSync(tmpPath) } catch { /* ignore cleanup error */ }
    return c.json({ error: 'Failed to write file' }, 500)
  }

  return c.json({ success: true })
})

export { filesRouter }
