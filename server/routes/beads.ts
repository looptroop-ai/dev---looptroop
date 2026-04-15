import { Hono } from 'hono'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { getTicketByRef, getTicketPaths, getLatestPhaseArtifact } from '../storage/tickets'
import { safeAtomicWrite } from '../io/atomicWrite'
import { syncTicketRuntimeProjection } from '../storage/ticketRuntimeProjection'
import { clearExecutionSetupState } from '../phases/executionSetup/storage'

const beadsRouter = new Hono()

function resolveBeadsPath(ticketId: string, flow?: string): string | null {
  const paths = getTicketPaths(ticketId)
  if (!paths) return null
  const resolvedFlow = flow?.trim() || paths.baseBranch
  return path.join(paths.ticketDir, 'beads', resolvedFlow, '.beads', 'issues.jsonl')
}

beadsRouter.get('/tickets/:id/beads', (c) => {
  const ticketId = c.req.param('id')
  if (!getTicketByRef(ticketId)) return c.json({ error: 'Ticket not found' }, 404)

  const flow = c.req.query('flow')
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

  const flow = c.req.query('flow')
  const body = await c.req.json()
  if (!Array.isArray(body)) {
    return c.json({ error: 'Request body must be a JSON array' }, 400)
  }

  const filePath = resolveBeadsPath(ticketId, flow)
  if (!filePath) return c.json({ error: 'Ticket not found' }, 404)

  try {
    const jsonl = body.map((item: unknown) => JSON.stringify(item)).join('\n') + '\n'
    safeAtomicWrite(filePath, jsonl)
    clearExecutionSetupState(ticketId)
    syncTicketRuntimeProjection(ticketId)
  } catch {
    return c.json({ error: 'Failed to write file' }, 500)
  }

  return c.json({ success: true })
})

const BEAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/

beadsRouter.get('/tickets/:id/beads/:beadId/diff', (c) => {
  const ticketId = c.req.param('id')
  const beadId = c.req.param('beadId')

  if (!getTicketByRef(ticketId)) return c.json({ error: 'Ticket not found' }, 404)
  if (!beadId || !BEAD_ID_PATTERN.test(beadId)) {
    return c.json({ error: 'Invalid bead ID' }, 400)
  }

  const artifact = getLatestPhaseArtifact(ticketId, `bead_diff:${beadId}`, 'CODING')
  if (!artifact) {
    return c.json({ diff: '', captured: false })
  }

  return c.json({ diff: artifact.content ?? '', captured: true })
})

export { beadsRouter }
