import { describe, expect, it } from 'vitest'
import {
  buildProcessGraph,
  collectProcessTree,
  isLoopTroopDevProcess,
  parseProcessTable,
  resolveProcessTreesToTerminate,
} from '../scripts/dev-preflight-utils'
import { formatPortOccupantSummary } from '../scripts/port-occupants'

const repoRoot = '/mnt/d/LoopTroop'

describe('dev preflight helpers', () => {
  it('detects the repo dev process shapes that the preflight must reclaim', () => {
    expect(isLoopTroopDevProcess(`${repoRoot}/node_modules/.bin/concurrently -n oc,fe,be`, repoRoot)).toBe(true)
    expect(isLoopTroopDevProcess(`node ${repoRoot}/node_modules/.bin/vite`, repoRoot)).toBe(true)
    expect(isLoopTroopDevProcess(`node ${repoRoot}/node_modules/.bin/tsx watch server/index.ts`, repoRoot)).toBe(true)
    expect(isLoopTroopDevProcess(`sh -c CHOKIDAR_USEPOLLING=1 tsx watch server/index.ts`, repoRoot)).toBe(true)
    expect(isLoopTroopDevProcess(`node ${repoRoot}/node_modules/.bin/tsx scripts/dev-opencode.ts`, repoRoot)).toBe(true)
    expect(isLoopTroopDevProcess(`node ${repoRoot}/server/index.ts`, repoRoot)).toBe(true)
    expect(isLoopTroopDevProcess(`node ${repoRoot}/node_modules/.bin/vitest run`, repoRoot)).toBe(false)
    expect(isLoopTroopDevProcess(`node ${repoRoot}/node_modules/.bin/tsx scripts/dev-preflight.ts`, repoRoot)).toBe(false)
    expect(isLoopTroopDevProcess(`python -m http.server 3000`, repoRoot)).toBe(false)
  })

  it('reclaims the owning watcher tree for a spawned server/index.ts occupant', () => {
    const processes = parseProcessTable([
      '100 1 sh -c CHOKIDAR_USEPOLLING=1 tsx watch server/index.ts',
      '101 100 node /mnt/d/LoopTroop/node_modules/.bin/tsx watch server/index.ts',
      '102 101 node /mnt/d/LoopTroop/server/index.ts',
      '200 1 node /mnt/d/LoopTroop/node_modules/.bin/vite',
    ].join('\n'))
    const graph = buildProcessGraph(processes)

    const resolution = resolveProcessTreesToTerminate(processes, [102, 200], repoRoot)
    expect(resolution.roots.map((entry) => entry.pid).sort((a, b) => a - b)).toEqual([100, 200])

    const backendTree = collectProcessTree(100, graph).map((entry) => entry.pid)
    expect(backendTree).toEqual([102, 101, 100])
  })

  it('keeps unrelated port occupants out of the cleanup set', () => {
    const processes = parseProcessTable([
      '300 1 python -m http.server 3000',
    ].join('\n'))

    const resolution = resolveProcessTreesToTerminate(processes, [300], repoRoot)
    expect(resolution.roots).toHaveLength(0)
    expect(resolution.unrelatedOccupants.map((entry) => entry.pid)).toEqual([300])
    expect(formatPortOccupantSummary({
      pid: resolution.unrelatedOccupants[0]?.pid,
      command: resolution.unrelatedOccupants[0]?.args,
    })).toBe('python (pid 300, cmd: python -m http.server 3000)')
  })
})
