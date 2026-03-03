import { db } from '../db/index'
import { tickets, projects } from '../db/schema'
import { eq } from 'drizzle-orm'
import { mkdirSync, writeFileSync } from 'fs'
import { resolve } from 'path'

interface CreateTicketOptions {
  projectId: number
  title: string
  description?: string
  priority?: number
}

export function createTicket(options: CreateTicketOptions) {
  // Validate project exists
  const project = db.select().from(projects).where(eq(projects.id, options.projectId)).get()
  if (!project) throw new Error('Project not found')

  // Auto-generate external_id
  const newCounter = (project.ticketCounter ?? 0) + 1
  const externalId = `${project.shortname}-${newCounter}`

  // Update project counter
  db.update(projects)
    .set({ ticketCounter: newCounter })
    .where(eq(projects.id, project.id))
    .run()

  // Create ticket row (lazy creation: metadata only)
  const ticket = db.insert(tickets).values({
    externalId,
    projectId: options.projectId,
    title: options.title,
    description: options.description ?? null,
    priority: options.priority ?? 3,
    status: 'DRAFT',
  }).returning().get()

  // Create minimal ticket directory with ticket.meta.json in meta/ subdirectory
  const metaDir = resolve(process.cwd(), '.looptroop/worktrees', externalId, '.ticket', 'meta')
  mkdirSync(metaDir, { recursive: true })
  writeFileSync(
    resolve(metaDir, 'ticket.meta.json'),
    JSON.stringify({
      id: ticket.id,
      externalId,
      projectId: options.projectId,
      title: options.title,
      createdAt: ticket.createdAt,
    }, null, 2),
  )

  return ticket
}
