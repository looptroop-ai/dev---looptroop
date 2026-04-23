import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db/index'
import { profiles } from '../db/schema'
import { eq } from 'drizzle-orm'
import { validateModelSelection } from '../opencode/modelValidation'
import { parseCouncilMembers } from '../council/members'

const profileRouter = new Hono()

const profileSchema = z.object({
  mainImplementer: z.string().optional(),
  mainImplementerVariant: z.string().optional(),
  councilMembers: z.string().optional(),
  councilMemberVariants: z.string().optional(),
  minCouncilQuorum: z.number().int().min(1).max(4).optional(),
  perIterationTimeout: z.number().int().nonnegative().optional(), // 0 = no timeout
  executionSetupTimeout: z.number().int().nonnegative().optional(), // 0 = no timeout
  councilResponseTimeout: z.number().int().positive().optional(),
  interviewQuestions: z.number().int().nonnegative().optional(), // 0 = infinite questions
  coverageFollowUpBudgetPercent: z.number().int().min(0).max(100).optional(),
  maxCoveragePasses: z.number().int().min(1).max(10).optional(),
  maxPrdCoveragePasses: z.number().int().min(2).max(20).optional(),
  maxBeadsCoveragePasses: z.number().int().min(2).max(20).optional(),
  maxIterations: z.number().int().nonnegative().optional(), // 0 = infinite retries
})

function normalizeModelSelection(
  mainImplementerRaw: string | null | undefined,
  councilMembersRaw: string | null | undefined,
) {
  const mainImplementer = typeof mainImplementerRaw === 'string' ? mainImplementerRaw.trim() : ''
  const councilMembers = Array.from(new Set([
    mainImplementer,
    ...parseCouncilMembers(councilMembersRaw),
  ].filter(Boolean)))

  return {
    mainImplementer,
    councilMembers,
  }
}

function hasModelSelectionChange(
  existing: { mainImplementer: string | null; councilMembers: string | null },
  next: { mainImplementer: string | null | undefined; councilMembers: string | null | undefined },
) {
  const current = normalizeModelSelection(existing.mainImplementer, existing.councilMembers)
  const requested = normalizeModelSelection(next.mainImplementer, next.councilMembers)

  if (current.mainImplementer !== requested.mainImplementer) return true
  if (current.councilMembers.length !== requested.councilMembers.length) return true

  return current.councilMembers.some((memberId, index) => requested.councilMembers[index] !== memberId)
}

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

  const requestedMainImplementer = parsed.data.mainImplementer ?? existing.mainImplementer
  const requestedCouncilMembers = parsed.data.councilMembers ?? existing.councilMembers
  let modelPatch: Pick<typeof existing, 'mainImplementer' | 'councilMembers'>

  if (hasModelSelectionChange(existing, {
    mainImplementer: requestedMainImplementer,
    councilMembers: requestedCouncilMembers,
  })) {
    let validatedModels
    try {
      validatedModels = await validateModelSelection(requestedMainImplementer, requestedCouncilMembers)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Invalid model configuration' }, 400)
    }

    modelPatch = {
      mainImplementer: validatedModels.mainImplementer,
      councilMembers: JSON.stringify(validatedModels.councilMembers),
    }
  } else {
    modelPatch = {
      mainImplementer: existing.mainImplementer,
      councilMembers: existing.councilMembers,
    }
  }

  const result = db.update(profiles)
    .set({
      ...parsed.data,
      ...modelPatch,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(profiles.id, existing.id))
    .returning()
    .get()
  return c.json(result)
})

export { profileRouter }
