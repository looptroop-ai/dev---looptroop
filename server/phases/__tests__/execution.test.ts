import { describe, it, expect } from 'vitest'
import { getRunnable, getNextBead, isAllComplete } from '../execution/scheduler'
import { parseCompletionMarker } from '../execution/completionChecker'
import { isAllowedFile, filterAllowedFiles } from '../execution/gitOps'
import type { Bead } from '../beads/types'

const makeBead = (id: string, status: Bead['status'] = 'pending', deps: string[] = []): Bead => ({
  id,
  title: id,
  prdRefs: [],
  description: 'd',
  contextGuidance: '',
  acceptanceCriteria: ['ac'],
  tests: ['t'],
  testCommands: ['cmd'],
  priority: 1,
  status,
  labels: [],
  dependencies: deps,
  targetFiles: [],
  notes: [],
  iteration: 0,
  createdAt: '',
  updatedAt: '',
  beadStartCommit: null,
  estimatedComplexity: 'moderate',
  epicId: '',
  storyId: '',
})

describe('Bead Scheduler', () => {
  it('returns beads with no pending dependencies', () => {
    const beads = [makeBead('b1'), makeBead('b2', 'pending', ['b1'])]
    const runnable = getRunnable(beads)
    expect(runnable.length).toBe(1)
    expect(runnable[0]!.id).toBe('b1')
  })

  it('returns second bead after first completes', () => {
    const beads = [makeBead('b1', 'completed'), makeBead('b2', 'pending', ['b1'])]
    expect(getNextBead(beads)?.id).toBe('b2')
  })

  it('isAllComplete returns true when all done', () => {
    expect(isAllComplete([makeBead('b1', 'completed')])).toBe(true)
    expect(isAllComplete([makeBead('b1', 'pending')])).toBe(false)
  })
})

describe('Completion Checker', () => {
  const validMarker = JSON.stringify({
    bead_id: 'PROJ-1-EPIC-1-US-1-task1-h7qd',
    status: 'completed',
    checks: { tests: 'pass', lint: 'pass', typecheck: 'pass', qualitative: 'pass' },
  })

  const failedMarker = JSON.stringify({
    bead_id: 'PROJ-1-EPIC-1-US-1-task1-h7qd',
    status: 'failed',
    checks: { tests: 'fail', lint: 'pass', typecheck: 'pass', qualitative: 'pass' },
  })

  const gateFailMarker = JSON.stringify({
    bead_id: 'PROJ-1-EPIC-1-US-1-task1-h7qd',
    status: 'completed',
    checks: { tests: 'fail', lint: 'pass', typecheck: 'pass', qualitative: 'pass' },
  })

  it('detects complete marker with valid JSON', () => {
    const result = parseCompletionMarker(`output <BEAD_STATUS>${validMarker}</BEAD_STATUS>`)
    expect(result.complete).toBe(true)
    expect(result.markerFound).toBe(true)
    expect(result.gatesValid).toBe(true)
    expect(result.beadId).toBe('PROJ-1-EPIC-1-US-1-task1-h7qd')
    expect(result.checks).toEqual({ tests: 'pass', lint: 'pass', typecheck: 'pass', qualitative: 'pass' })
  })

  it('detects failed status marker', () => {
    const result = parseCompletionMarker(`output <BEAD_STATUS>${failedMarker}</BEAD_STATUS>`)
    expect(result.complete).toBe(false)
    expect(result.markerFound).toBe(true)
    expect(result.beadId).toBe('PROJ-1-EPIC-1-US-1-task1-h7qd')
  })

  it('rejects completed status with failing gates', () => {
    const result = parseCompletionMarker(`output <BEAD_STATUS>${gateFailMarker}</BEAD_STATUS>`)
    expect(result.complete).toBe(false)
    expect(result.markerFound).toBe(true)
    expect(result.gatesValid).toBe(false)
    expect(result.errors.some(e => e.includes('Quality gate failed'))).toBe(true)
  })

  it('rejects invalid JSON in marker', () => {
    const result = parseCompletionMarker('output <BEAD_STATUS>NOT JSON</BEAD_STATUS>')
    expect(result.complete).toBe(false)
    expect(result.markerFound).toBe(true)
    expect(result.errors.some(e => e.includes('Invalid JSON'))).toBe(true)
  })

  it('reports missing marker', () => {
    const result = parseCompletionMarker('no marker here')
    expect(result.complete).toBe(false)
    expect(result.markerFound).toBe(false)
  })
})

describe('Git Allowlist', () => {
  it('allows .ts files', () => expect(isAllowedFile('src/app.ts')).toBe(true))
  it('allows .tsx files', () => expect(isAllowedFile('src/App.tsx')).toBe(true))
  it('blocks runtime files', () => expect(isAllowedFile('.ticket/runtime/log.txt')).toBe(false))
  it('blocks node_modules', () =>
    expect(isAllowedFile('node_modules/pkg/index.js')).toBe(false))
  it('filters array correctly', () => {
    const files = ['src/a.ts', 'node_modules/x.js', '.ticket/runtime/y.txt', 'test.tsx']
    expect(filterAllowedFiles(files)).toEqual(['src/a.ts', 'test.tsx'])
  })
})
