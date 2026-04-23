import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { initializeDatabase } from '../../db/init'
import { db } from '../../db/index'
import { profiles } from '../../db/schema'
import { profileRouter } from '../profiles'

vi.mock('../../opencode/modelValidation', () => ({
  validateModelSelection: vi.fn(),
}))

import { validateModelSelection } from '../../opencode/modelValidation'

function createProfileApp() {
  const app = new Hono()
  app.route('/api', profileRouter)
  return app
}

describe('profileRouter coverage pass validation', () => {
  beforeEach(() => {
    initializeDatabase()
    db.delete(profiles).run()
    vi.restoreAllMocks()
  })

  it('accepts PRD and beads coverage pass values at the configured bounds', async () => {
    vi.mocked(validateModelSelection).mockResolvedValue({
      mainImplementer: 'openai/gpt-5.4',
      councilMembers: ['openai/gpt-5.4', 'anthropic/claude-sonnet-4'],
    })

    const app = createProfileApp()
    const response = await app.request('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mainImplementer: 'openai/gpt-5.4',
        councilMembers: '["openai/gpt-5.4","anthropic/claude-sonnet-4"]',
        maxPrdCoveragePasses: 2,
        maxBeadsCoveragePasses: 20,
      }),
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      maxPrdCoveragePasses: 2,
      maxBeadsCoveragePasses: 20,
    })
  })

  it('rejects out-of-range PRD and beads coverage pass values', async () => {
    db.insert(profiles).values({
      mainImplementer: 'openai/gpt-5.4',
      councilMembers: '["openai/gpt-5.4","anthropic/claude-sonnet-4"]',
    }).run()

    const app = createProfileApp()
    const response = await app.request('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        maxPrdCoveragePasses: 1,
        maxBeadsCoveragePasses: 21,
      }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid input',
    })
  })
})
