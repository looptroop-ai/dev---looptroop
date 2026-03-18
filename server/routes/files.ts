import { Hono } from 'hono'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as readline from 'node:readline'
import { getTicketByRef, getTicketPaths } from '../storage/tickets'
import { safeAtomicWrite } from '../io/atomicWrite'

const filesRouter = new Hono()

const VALID_FILES = ['interview', 'prd'] as const
type ValidFile = typeof VALID_FILES[number]

function isValidFile(file: string): file is ValidFile {
  return VALID_FILES.includes(file as ValidFile)
}

function resolveTicketFilePath(ticketId: string, file: ValidFile): string | null {
  const paths = getTicketPaths(ticketId)
  if (!paths) return null
  return path.join(paths.ticketDir, `${file}.yaml`)
}

function normalizeLogEntry(entry: unknown): Record<string, unknown> | null {
  if (!entry || typeof entry !== 'object') return null
  const record = entry as Record<string, unknown>
  const phase = typeof record.phase === 'string'
    ? record.phase
    : (typeof record.status === 'string' ? record.status : 'unknown')
  const status = typeof record.status === 'string' ? record.status : phase
  const content = typeof record.content === 'string'
    ? record.content
    : (typeof record.message === 'string' ? record.message : '')
  const type = typeof record.type === 'string' ? record.type : 'info'
  const audience = typeof record.audience === 'string'
    ? record.audience
    : record.source === 'debug' || type === 'debug'
      ? 'debug'
      : (record.source === 'opencode'
        || (typeof record.source === 'string' && record.source.startsWith('model:'))
        || type === 'model_output')
        ? 'ai'
        : 'all'
  const kind = typeof record.kind === 'string'
    ? record.kind
    : type === 'test_result'
      ? 'test'
      : type === 'error'
        ? 'error'
        : type === 'model_output'
          ? 'text'
          : 'milestone'
  const op = typeof record.op === 'string' ? record.op : 'append'
  return {
    ...record,
    phase,
    status,
    message: typeof record.message === 'string' ? record.message : content,
    content,
    type,
    ...(audience ? { audience } : {}),
    ...(kind ? { kind } : {}),
    ...(op ? { op } : {}),
  }
}

function foldStreamingEntries(entries: Record<string, unknown>[]): Record<string, unknown>[] {
  const passthrough: Array<{ index: number; entry: Record<string, unknown> }> = []
  const folded = new Map<string, { index: number; entry: Record<string, unknown> }>()

  entries.forEach((entry, index) => {
    const entryId = typeof entry.entryId === 'string' ? entry.entryId : undefined
    const op = typeof entry.op === 'string' ? entry.op : 'append'

    if (!entryId || op === 'append') {
      passthrough.push({ index, entry })
      return
    }

    const previous = folded.get(entryId)
    if (!previous) {
      folded.set(entryId, { index, entry })
      return
    }

    folded.set(entryId, {
      index: previous.index,
      entry: { ...previous.entry, ...entry },
    })
  })

  return [
    ...passthrough,
    ...Array.from(folded.values()),
  ]
    .sort((a, b) => a.index - b.index)
    .map(item => item.entry)
}

filesRouter.get('/files/:ticketId/logs', async (c) => {
  const ticketId = c.req.param('ticketId')
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)

  const paths = getTicketPaths(ticketId)
  if (!paths) return c.json({ error: 'Ticket not found' }, 404)
  if (!fs.existsSync(paths.executionLogPath)) return c.json([])

  const entries: Record<string, unknown>[] = []
  const rl = readline.createInterface({
    input: fs.createReadStream(paths.executionLogPath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  })
  for await (const line of rl) {
    if (!line.trim()) continue
    try {
      const normalized = normalizeLogEntry(JSON.parse(line))
      if (normalized) entries.push(normalized)
    } catch {
      // Skip malformed lines.
    }
  }

  const foldedEntries = foldStreamingEntries(entries)
  foldedEntries.sort((a, b) => {
    const at = typeof a.timestamp === 'string' ? Date.parse(a.timestamp) : 0
    const bt = typeof b.timestamp === 'string' ? Date.parse(b.timestamp) : 0
    return at - bt
  })

  const hasCurrentStatusEntry = foldedEntries.some(entry => entry.status === ticket.status)
  if (!hasCurrentStatusEntry) {
    const nowIso = new Date().toISOString()
    foldedEntries.push({
      timestamp: ticket.updatedAt ?? nowIso,
      type: 'info',
      phase: ticket.status,
      status: ticket.status,
      source: 'system',
      message: `[APP] Status ${ticket.status} is active. Older runs may not have generated status-scoped logs yet.`,
      content: `[APP] Status ${ticket.status} is active. Older runs may not have generated status-scoped logs yet.`,
      data: { synthetic: true },
      audience: 'all',
      kind: 'milestone',
      op: 'append',
    })
  }

  const statusFilter = c.req.query('status')
  const phaseFilter = c.req.query('phase')
  const filtered = foldedEntries.filter((entry) => {
    if (statusFilter && entry.status !== statusFilter) return false
    if (phaseFilter && entry.phase !== phaseFilter) return false
    return true
  })

  return c.json(filtered)
})

filesRouter.get('/files/:ticketId/:file', (c) => {
  const ticketId = c.req.param('ticketId')
  const file = c.req.param('file')

  if (!isValidFile(file)) {
    return c.json({ error: `Invalid file type. Must be one of: ${VALID_FILES.join(', ')}` }, 400)
  }

  if (!getTicketByRef(ticketId)) return c.json({ error: 'Ticket not found' }, 404)
  const filePath = resolveTicketFilePath(ticketId, file)
  if (!filePath) return c.json({ error: 'Ticket not found' }, 404)

  if (!fs.existsSync(filePath)) {
    return c.json({ content: '', exists: false })
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  return c.json({ content, exists: true })
})

filesRouter.put('/files/:ticketId/:file', async (c) => {
  const ticketId = c.req.param('ticketId')
  const file = c.req.param('file')

  if (!isValidFile(file)) {
    return c.json({ error: `Invalid file type. Must be one of: ${VALID_FILES.join(', ')}` }, 400)
  }

  if (!getTicketByRef(ticketId)) return c.json({ error: 'Ticket not found' }, 404)
  const filePath = resolveTicketFilePath(ticketId, file)
  if (!filePath) return c.json({ error: 'Ticket not found' }, 404)

  const body = await c.req.json()
  if (typeof body.content !== 'string') {
    return c.json({ error: 'Request body must include a "content" string field' }, 400)
  }

  try {
    safeAtomicWrite(filePath, body.content)
  } catch {
    return c.json({ error: 'Failed to write file' }, 500)
  }

  return c.json({ success: true })
})

export { filesRouter }
