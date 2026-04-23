import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  decideDailyMaintenanceTask,
  recordDailyMaintenanceSuccess,
  type DailyMaintenanceState,
} from '../scripts/dev-maintenance'

const tempDirs: string[] = []

function createState(): DailyMaintenanceState {
  return {
    version: 1,
    tasks: {},
  }
}

function makeTempFile(contents = 'x') {
  const dir = mkdtempSync(join(tmpdir(), 'looptroop-dev-maintenance-'))
  tempDirs.push(dir)
  const filePath = join(dir, 'marker.txt')
  writeFileSync(filePath, contents, 'utf8')
  return filePath
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

describe('daily dev maintenance decisions', () => {
  it('runs when the task has never completed before', () => {
    const decision = decideDailyMaintenanceTask({
      taskName: 'audit',
      state: createState(),
      now: new Date('2026-04-23T10:00:00'),
    })

    expect(decision.shouldRun).toBe(true)
    expect(decision.reason).toBe('never-ran')
    expect(decision.deferred).toBe(false)
  })

  it('defers when the task already completed earlier on the same local day', () => {
    const state = createState()
    recordDailyMaintenanceSuccess(state, 'opencode', new Date('2026-04-23T09:00:00'))

    const decision = decideDailyMaintenanceTask({
      taskName: 'opencode',
      state,
      now: new Date('2026-04-23T18:00:00'),
    })

    expect(decision.shouldRun).toBe(false)
    expect(decision.deferred).toBe(true)
    expect(decision.reason).toBe('already-ran-today')
    expect(decision.lastCompletedAt).toBeDefined()
    expect(decision.nextEligibleAt).toBeDefined()
  })

  it('runs again the same day when a watched file changed after the last completion', async () => {
    const markerPath = makeTempFile('before')
    const state = createState()
    recordDailyMaintenanceSuccess(state, 'dependencySync', new Date('2026-04-23T09:00:00'))
    writeFileSync(markerPath, 'after', 'utf8')

    const decision = decideDailyMaintenanceTask({
      taskName: 'dependencySync',
      state,
      now: new Date('2026-04-23T18:00:00'),
      invalidatedByPaths: [markerPath],
    })

    expect(decision.shouldRun).toBe(true)
    expect(decision.deferred).toBe(false)
    expect(decision.reason).toBe('invalidated')
  })

  it('runs again on a new local day even without invalidation', () => {
    const state = createState()
    recordDailyMaintenanceSuccess(state, 'audit', new Date('2026-04-23T22:00:00'))

    const decision = decideDailyMaintenanceTask({
      taskName: 'audit',
      state,
      now: new Date('2026-04-24T09:00:00'),
    })

    expect(decision.shouldRun).toBe(true)
    expect(decision.reason).toBe('new-day')
    expect(decision.deferred).toBe(false)
  })
})
