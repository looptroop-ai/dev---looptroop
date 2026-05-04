import { Hono } from 'hono'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as readline from 'node:readline'
import { extractLogFingerprint } from '@shared/logIdentity'
import { getTicketByRef, getTicketPaths } from '../storage/tickets'
import { resolvePhaseAttempt } from '../storage/ticketPhaseAttempts'
import { safeAtomicWrite } from '../io/atomicWrite'
import { foldPersistedLogEntries } from '../log/readDedupe'
import { handlePutInterview, handlePutPrd } from './ticketHandlers'

const filesRouter = new Hono()

const VALID_FILES = ['interview', 'prd'] as const
type ValidFile = typeof VALID_FILES[number]
type LogChannel = 'normal' | 'debug' | 'ai'

function isValidFile(file: string): file is ValidFile {
  return VALID_FILES.includes(file as ValidFile)
}

function resolveTicketFilePath(ticketId: string, file: ValidFile): string | null {
  const paths = getTicketPaths(ticketId)
  if (!paths) return null
  return path.join(paths.ticketDir, `${file}.yaml`)
}

function normalizeLogChannel(channel?: string): LogChannel {
  return channel === 'debug' || channel === 'ai' ? channel : 'normal'
}

function normalizeLogEntry(entry: unknown): Record<string, unknown> | null {
  if (!entry || typeof entry !== 'object') return null
  const record = entry as Record<string, unknown>
  const fingerprint = extractLogFingerprint(record)
  const phase = typeof record.phase === 'string'
    ? record.phase
    : (typeof record.status === 'string' ? record.status : 'unknown')
  const phaseAttempt = typeof record.phaseAttempt === 'number' && Number.isFinite(record.phaseAttempt)
    ? record.phaseAttempt
    : (Number.isFinite(Number(record.phaseAttempt)) ? Number(record.phaseAttempt) : 1)
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
    phaseAttempt,
    status,
    message: typeof record.message === 'string' ? record.message : content,
    content,
    type,
    ...(audience ? { audience } : {}),
    ...(kind ? { kind } : {}),
    ...(op ? { op } : {}),
    ...(fingerprint ? { fingerprint } : {}),
  }
}

function getEntryPhaseAttempt(entry: Record<string, unknown>): number | null {
  const phaseAttempt = typeof entry.phaseAttempt === 'number' && Number.isFinite(entry.phaseAttempt)
    ? entry.phaseAttempt
    : Number(entry.phaseAttempt)
  return Number.isFinite(phaseAttempt) ? phaseAttempt : null
}

function logEntryMatchesFilters(
  entry: Record<string, unknown>,
  filters: {
    status?: string
    phase?: string
    phaseAttempt?: number
  },
): boolean {
  if (filters.status && entry.status !== filters.status) return false
  if (filters.phase && entry.phase !== filters.phase) return false
  if (typeof filters.phaseAttempt === 'number' && Number.isFinite(filters.phaseAttempt)) {
    const entryPhaseAttempt = getEntryPhaseAttempt(entry)
    if (!Number.isFinite(entryPhaseAttempt) || entryPhaseAttempt !== filters.phaseAttempt) return false
  }
  return true
}

filesRouter.get('/files/:ticketId/logs', async (c) => {
  const ticketId = c.req.param('ticketId')
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)

  const paths = getTicketPaths(ticketId)
  if (!paths) return c.json({ error: 'Ticket not found' }, 404)
  const channel = normalizeLogChannel(c.req.query('channel'))
  const logPath = channel === 'debug'
    ? paths.debugLogPath
    : channel === 'ai'
      ? paths.aiLogPath
      : paths.executionLogPath
  if (!fs.existsSync(logPath)) return c.json([])
  const statusFilter = c.req.query('status')
  const phaseFilter = c.req.query('phase')
  const phaseAttemptFilterRaw = c.req.query('phaseAttempt')
  const phaseAttemptFilter = phaseAttemptFilterRaw != null ? Number(phaseAttemptFilterRaw) : undefined
  const filters = {
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(phaseFilter ? { phase: phaseFilter } : {}),
    ...(typeof phaseAttemptFilter === 'number' && Number.isFinite(phaseAttemptFilter) ? { phaseAttempt: phaseAttemptFilter } : {}),
  }

  const entries: Record<string, unknown>[] = []
  const rl = readline.createInterface({
    input: fs.createReadStream(logPath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  })
  for await (const line of rl) {
    if (!line.trim()) continue
    try {
      const normalized = normalizeLogEntry(JSON.parse(line))
      if (normalized && logEntryMatchesFilters(normalized, filters)) entries.push(normalized)
    } catch {
      // Skip malformed lines.
    }
  }

  const foldedEntries = foldPersistedLogEntries(entries)
  foldedEntries.sort((a, b) => {
    const at = typeof a.timestamp === 'string' ? Date.parse(a.timestamp) : 0
    const bt = typeof b.timestamp === 'string' ? Date.parse(b.timestamp) : 0
    return at - bt
  })

  const isAuxiliaryChannel = channel === 'debug' || channel === 'ai'
  const hasCurrentStatusEntry = foldedEntries.some(entry => entry.status === ticket.status)
  const currentPhaseAttempt = !isAuxiliaryChannel && !hasCurrentStatusEntry ? resolvePhaseAttempt(ticketId, ticket.status) : null
  const syntheticMatchesFilters = logEntryMatchesFilters({
    phase: ticket.status,
    phaseAttempt: currentPhaseAttempt ?? 1,
    status: ticket.status,
  }, filters)
  if (!isAuxiliaryChannel && !hasCurrentStatusEntry && syntheticMatchesFilters) {
    const nowIso = new Date().toISOString()
    foldedEntries.push({
      timestamp: ticket.updatedAt ?? nowIso,
      type: 'info',
      phase: ticket.status,
      phaseAttempt: currentPhaseAttempt ?? 1,
      status: ticket.status,
      source: 'system',
      message: `[SYS] Status ${ticket.status} is active. Older runs may not have generated status-scoped logs yet.`,
      content: `[SYS] Status ${ticket.status} is active. Older runs may not have generated status-scoped logs yet.`,
      data: { synthetic: true },
      audience: 'all',
      kind: 'milestone',
      op: 'append',
    })
  }
  return c.json(foldedEntries)
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

  if (file === 'interview') {
    return handlePutInterview(c)
  }

  if (file === 'prd') {
    return handlePutPrd(c)
  }

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
