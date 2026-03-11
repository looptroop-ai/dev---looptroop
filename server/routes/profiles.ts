import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db/index'
import { profiles } from '../db/schema'
import { eq } from 'drizzle-orm'
import { validateModelSelection } from '../opencode/modelValidation'

const profileRouter = new Hono()

const profileSchema = z.object({
  username: z.string().min(1).max(50),
  icon: z.string().optional(),
  background: z.string().optional(),
  mainImplementer: z.string().optional(),
  councilMembers: z.string().optional(),
  minCouncilQuorum: z.number().int().min(1).max(4).optional(),
  perIterationTimeout: z.number().int().nonnegative().optional(), // 0 = no timeout
  councilResponseTimeout: z.number().int().positive().optional(),
  interviewQuestions: z.number().int().nonnegative().optional(), // 0 = infinite questions
  maxIterations: z.number().int().nonnegative().optional(), // 0 = infinite retries
  disableAnalogies: z.number().int().min(0).max(1).optional(),
})

profileRouter.get('/profile', (c) => {
  const profile = db.select().from(profiles).limit(1).get()
  return c.json(profile ?? null)
})

profileRouter.post('/profile', async (c) => {
  const body = await c.req.json()
  const parsed = profileSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.flatten() }, 400)
  }
  let validatedModels
  try {
    validatedModels = await validateModelSelection(parsed.data.mainImplementer, parsed.data.councilMembers)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Invalid model configuration' }, 400)
  }
  const existing = db.select().from(profiles).limit(1).get()
  if (existing) {
    return c.json({ error: 'Profile already exists. Use PATCH to update.' }, 409)
  }
  const result = db.insert(profiles).values({
    ...parsed.data,
    mainImplementer: validatedModels.mainImplementer,
    councilMembers: JSON.stringify(validatedModels.councilMembers),
  }).returning().get()
  return c.json(result, 201)
})

profileRouter.patch('/profile', async (c) => {
  const body = await c.req.json()
  const parsed = profileSchema.partial().safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.flatten() }, 400)
  }
  const existing = db.select().from(profiles).limit(1).get()
  if (!existing) {
    return c.json({ error: 'No profile found' }, 404)
  }
  let validatedModels
  try {
    validatedModels = await validateModelSelection(
      parsed.data.mainImplementer ?? existing.mainImplementer,
      parsed.data.councilMembers ?? existing.councilMembers,
    )
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Invalid model configuration' }, 400)
  }
  const result = db.update(profiles)
    .set({
      ...parsed.data,
      mainImplementer: validatedModels.mainImplementer,
      councilMembers: JSON.stringify(validatedModels.councilMembers),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(profiles.id, existing.id))
    .returning()
    .get()
  return c.json(result)
})

export { profileRouter }
