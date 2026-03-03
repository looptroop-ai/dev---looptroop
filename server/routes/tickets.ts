import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db/index'
import { tickets, projects, profiles, phaseArtifacts } from '../db/schema'
import { eq, desc } from 'drizzle-orm'
import { createTicketActor, ensureActorForTicket, sendTicketEvent, getTicketState } from '../machines/persistence'

const ticketRouter = new Hono()

const createTicketSchema = z.object({
  projectId: z.number().int().positive(),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  priority: z.number().int().min(1).max(5).optional(),
})

const updateTicketSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  priority: z.number().int().min(1).max(5).optional(),
})

ticketRouter.get('/tickets', (c) => {
  const projectId = c.req.query('project') ?? c.req.query('projectId')
  if (projectId) {
    const all = db.select().from(tickets).where(eq(tickets.projectId, Number(projectId))).orderBy(desc(tickets.updatedAt)).all()
    return c.json(all)
  }
  const all = db.select().from(tickets).orderBy(desc(tickets.updatedAt)).all()
  return c.json(all)
})

ticketRouter.get('/tickets/:id', (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid ticket ID' }, 400)
  const ticket = db.select().from(tickets).where(eq(tickets.id, id)).get()
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  return c.json(ticket)
})

ticketRouter.post('/tickets', async (c) => {
  const body = await c.req.json()
  const parsed = createTicketSchema.safeParse(body)
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors
    const message = Object.entries(fieldErrors)
      .map(([field, errors]) => `${field}: ${(errors as string[]).join(', ')}`)
      .join('; ')
    return c.json({ error: 'Invalid input', details: parsed.error.flatten(), message }, 400)
  }

  // Validate project exists
  const project = db.select().from(projects).where(eq(projects.id, parsed.data.projectId)).get()
  if (!project) {
    return c.json({ error: 'Project not found' }, 404)
  }

  // Auto-generate external_id
  const newCounter = (project.ticketCounter ?? 0) + 1
  const externalId = `${project.shortname}-${newCounter}`

  // Update project ticket counter
  db.update(projects)
    .set({ ticketCounter: newCounter })
    .where(eq(projects.id, project.id))
    .run()

  const result = db.insert(tickets).values({
    ...parsed.data,
    externalId,
    status: 'DRAFT',
  }).returning().get()

  // Create XState actor for the new ticket
  createTicketActor(result.id, {
    ticketId: String(result.id),
    projectId: result.projectId,
    externalId: result.externalId,
    title: result.title,
  })

  // Re-read ticket after actor persistence
  const updated = db.select().from(tickets).where(eq(tickets.id, result.id)).get()
  return c.json(updated ?? result, 201)
})

ticketRouter.patch('/tickets/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid ticket ID' }, 400)
  const body = await c.req.json()

  // API-protect status field
  if ('status' in body) {
    return c.json({ error: 'Status field is API-protected. Use workflow actions to change status.' }, 403)
  }

  const parsed = updateTicketSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.flatten() }, 400)
  }

  const existing = db.select().from(tickets).where(eq(tickets.id, id)).get()
  if (!existing) return c.json({ error: 'Ticket not found' }, 404)

  const result = db.update(tickets)
    .set({ ...parsed.data, updatedAt: new Date().toISOString() })
    .where(eq(tickets.id, id))
    .returning()
    .get()
  return c.json(result)
})

// Workflow action endpoints
ticketRouter.post('/tickets/:id/start', (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid ticket ID' }, 400)
  const ticket = db.select().from(tickets).where(eq(tickets.id, id)).get()
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'DRAFT') {
    return c.json({ error: 'Ticket can only be started from DRAFT status' }, 409)
  }

  // Resolve and lock model configuration at start time
  const project = db.select().from(projects).where(eq(projects.id, ticket.projectId)).get()
  const profile = db.select().from(profiles).get()
  const lockedMainImplementer = profile?.mainImplementer ?? null
  const councilRaw = project?.councilMembers ?? profile?.councilMembers ?? null
  let lockedCouncilMembers: string[] | null = null
  if (councilRaw) {
    try { lockedCouncilMembers = JSON.parse(councilRaw) as string[] } catch { /* ignore */ }
  }

  // Persist locked models to DB
  db.update(tickets)
    .set({
      lockedMainImplementer,
      lockedCouncilMembers: lockedCouncilMembers ? JSON.stringify(lockedCouncilMembers) : null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(tickets.id, id))
    .run()

  try {
    ensureActorForTicket(id)
    sendTicketEvent(id, { type: 'START', lockedMainImplementer, lockedCouncilMembers })
  } catch (err) {
    console.error(`[tickets] Failed to send START to ticket ${id}:`, err)
    return c.json({ error: 'Failed to start ticket', details: String(err) }, 500)
  }

  const updated = db.select().from(tickets).where(eq(tickets.id, id)).get()
  const state = getTicketState(id)
  return c.json({ message: 'Start action accepted', ticketId: id, status: updated?.status, state: state?.state })
})

ticketRouter.post('/tickets/:id/approve', (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid ticket ID' }, 400)
  const ticket = db.select().from(tickets).where(eq(tickets.id, id)).get()
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  const approvalStates = ['WAITING_INTERVIEW_APPROVAL', 'WAITING_PRD_APPROVAL', 'WAITING_BEADS_APPROVAL', 'WAITING_MANUAL_VERIFICATION']
  if (!approvalStates.includes(ticket.status)) {
    return c.json({ error: 'Ticket is not in an approval state' }, 409)
  }

  try {
    ensureActorForTicket(id)
    sendTicketEvent(id, { type: 'APPROVE' })
  } catch (err) {
    console.error(`[tickets] Failed to send APPROVE to ticket ${id}:`, err)
    return c.json({ error: 'Failed to approve ticket', details: String(err) }, 500)
  }

  const updated = db.select().from(tickets).where(eq(tickets.id, id)).get()
  const state = getTicketState(id)
  return c.json({ message: 'Approve action accepted', ticketId: id, status: updated?.status, state: state?.state })
})

ticketRouter.post('/tickets/:id/cancel', (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid ticket ID' }, 400)
  const ticket = db.select().from(tickets).where(eq(tickets.id, id)).get()
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (['COMPLETED', 'CANCELED'].includes(ticket.status)) {
    return c.json({ error: 'Cannot cancel a terminal ticket' }, 409)
  }

  try {
    ensureActorForTicket(id)
    sendTicketEvent(id, { type: 'CANCEL' })
  } catch (err) {
    console.error(`[tickets] Failed to send CANCEL to ticket ${id}:`, err)
    return c.json({ error: 'Failed to cancel ticket', details: String(err) }, 500)
  }

  const updated = db.select().from(tickets).where(eq(tickets.id, id)).get()
  const state = getTicketState(id)
  return c.json({ message: 'Cancel action accepted', ticketId: id, status: updated?.status, state: state?.state })
})

// Specific workflow routes
ticketRouter.post('/tickets/:id/answer', async (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid ticket ID' }, 400)
  const ticket = db.select().from(tickets).where(eq(tickets.id, id)).get()
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'WAITING_INTERVIEW_ANSWERS') {
    return c.json({ error: 'Ticket is not waiting for interview answers' }, 409)
  }

  try {
    ensureActorForTicket(id)
    const body = await c.req.json().catch(() => ({}))
    sendTicketEvent(id, { type: 'ANSWER_SUBMITTED', answers: body.answers ?? {} })
  } catch (err) {
    console.error(`[tickets] Failed to send ANSWER_SUBMITTED to ticket ${id}:`, err)
    return c.json({ error: 'Failed to submit answer', details: String(err) }, 500)
  }

  const updated = db.select().from(tickets).where(eq(tickets.id, id)).get()
  const state = getTicketState(id)
  return c.json({ message: 'Answer submitted', ticketId: id, status: updated?.status, state: state?.state })
})

ticketRouter.post('/tickets/:id/skip', (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid ticket ID' }, 400)
  const ticket = db.select().from(tickets).where(eq(tickets.id, id)).get()
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'WAITING_INTERVIEW_ANSWERS') {
    return c.json({ error: 'Ticket is not waiting for interview answers' }, 409)
  }

  try {
    ensureActorForTicket(id)
    sendTicketEvent(id, { type: 'SKIP' })
  } catch (err) {
    console.error(`[tickets] Failed to send SKIP to ticket ${id}:`, err)
    return c.json({ error: 'Failed to skip question', details: String(err) }, 500)
  }

  const updated = db.select().from(tickets).where(eq(tickets.id, id)).get()
  const state = getTicketState(id)
  return c.json({ message: 'Question skipped', ticketId: id, status: updated?.status, state: state?.state })
})

ticketRouter.post('/tickets/:id/approve-interview', (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid ticket ID' }, 400)
  const ticket = db.select().from(tickets).where(eq(tickets.id, id)).get()
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'WAITING_INTERVIEW_APPROVAL') {
    return c.json({ error: 'Ticket is not waiting for interview approval' }, 409)
  }

  try {
    ensureActorForTicket(id)
    sendTicketEvent(id, { type: 'APPROVE' })
  } catch (err) {
    console.error(`[tickets] Failed to send APPROVE to ticket ${id}:`, err)
    return c.json({ error: 'Failed to approve interview', details: String(err) }, 500)
  }

  const updated = db.select().from(tickets).where(eq(tickets.id, id)).get()
  const state = getTicketState(id)
  return c.json({ message: 'Interview approved', ticketId: id, status: updated?.status, state: state?.state })
})

ticketRouter.post('/tickets/:id/approve-prd', (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid ticket ID' }, 400)
  const ticket = db.select().from(tickets).where(eq(tickets.id, id)).get()
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'WAITING_PRD_APPROVAL') {
    return c.json({ error: 'Ticket is not waiting for PRD approval' }, 409)
  }

  try {
    ensureActorForTicket(id)
    sendTicketEvent(id, { type: 'APPROVE' })
  } catch (err) {
    console.error(`[tickets] Failed to send APPROVE to ticket ${id}:`, err)
    return c.json({ error: 'Failed to approve PRD', details: String(err) }, 500)
  }

  const updated = db.select().from(tickets).where(eq(tickets.id, id)).get()
  const state = getTicketState(id)
  return c.json({ message: 'PRD approved', ticketId: id, status: updated?.status, state: state?.state })
})

ticketRouter.post('/tickets/:id/approve-beads', (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid ticket ID' }, 400)
  const ticket = db.select().from(tickets).where(eq(tickets.id, id)).get()
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'WAITING_BEADS_APPROVAL') {
    return c.json({ error: 'Ticket is not waiting for beads approval' }, 409)
  }

  try {
    ensureActorForTicket(id)
    sendTicketEvent(id, { type: 'APPROVE' })
  } catch (err) {
    console.error(`[tickets] Failed to send APPROVE to ticket ${id}:`, err)
    return c.json({ error: 'Failed to approve beads', details: String(err) }, 500)
  }

  const updated = db.select().from(tickets).where(eq(tickets.id, id)).get()
  const state = getTicketState(id)
  return c.json({ message: 'Beads approved', ticketId: id, status: updated?.status, state: state?.state })
})

ticketRouter.post('/tickets/:id/verify', (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid ticket ID' }, 400)
  const ticket = db.select().from(tickets).where(eq(tickets.id, id)).get()
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'WAITING_MANUAL_VERIFICATION') {
    return c.json({ error: 'Ticket is not waiting for manual verification' }, 409)
  }

  try {
    ensureActorForTicket(id)
    sendTicketEvent(id, { type: 'VERIFY_COMPLETE' })
  } catch (err) {
    console.error(`[tickets] Failed to send VERIFY_COMPLETE to ticket ${id}:`, err)
    return c.json({ error: 'Failed to verify completion', details: String(err) }, 500)
  }

  const updated = db.select().from(tickets).where(eq(tickets.id, id)).get()
  const state = getTicketState(id)
  return c.json({ message: 'Verification complete', ticketId: id, status: updated?.status, state: state?.state })
})

ticketRouter.post('/tickets/:id/retry', (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid ticket ID' }, 400)
  const ticket = db.select().from(tickets).where(eq(tickets.id, id)).get()
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'BLOCKED_ERROR') {
    return c.json({ error: 'Retry only works from BLOCKED_ERROR state' }, 409)
  }

  try {
    ensureActorForTicket(id)
    sendTicketEvent(id, { type: 'RETRY' })
  } catch (err) {
    console.error(`[tickets] Failed to send RETRY to ticket ${id}:`, err)
    return c.json({ error: 'Failed to retry ticket', details: String(err) }, 500)
  }

  const updated = db.select().from(tickets).where(eq(tickets.id, id)).get()
  const state = getTicketState(id)
  return c.json({ message: 'Retry action accepted', ticketId: id, status: updated?.status, state: state?.state })
})

// Dev-only: send arbitrary XState events for testing
ticketRouter.post('/tickets/:id/dev-event', async (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid ticket ID' }, 400)
  const ticket = db.select().from(tickets).where(eq(tickets.id, id)).get()
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)

  try {
    const body = await c.req.json()
    sendTicketEvent(id, body)
  } catch (err) {
    console.error(`[tickets] dev-event failed for ticket ${id}:`, err)
    return c.json({ error: String(err) }, 500)
  }

  const updated = db.select().from(tickets).where(eq(tickets.id, id)).get()
  const state = getTicketState(id)
  return c.json({ ticketId: id, status: updated?.status, state: state?.state })
})

ticketRouter.get('/tickets/:id/artifacts', (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid ticket ID' }, 400)
  const ticket = db.select().from(tickets).where(eq(tickets.id, id)).get()
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  const artifacts = db.select().from(phaseArtifacts).where(eq(phaseArtifacts.ticketId, id)).all()
  return c.json(artifacts)
})

export { ticketRouter }
