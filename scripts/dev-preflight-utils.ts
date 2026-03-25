export interface ProcessInfo {
  pid: number
  ppid: number
  args: string
}

export interface ProcessGraph {
  byPid: Map<number, ProcessInfo>
  childrenByPid: Map<number, ProcessInfo[]>
}

export function parseProcessTable(output: string): ProcessInfo[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(.+)$/)
      if (!match) {
        throw new Error(`Unable to parse process table line: ${line}`)
      }

      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        args: match[3]!,
      }
    })
    .filter((entry) => Number.isInteger(entry.pid) && entry.pid > 0)
}

export function buildProcessGraph(processes: ProcessInfo[]): ProcessGraph {
  const byPid = new Map<number, ProcessInfo>()
  const childrenByPid = new Map<number, ProcessInfo[]>()

  for (const process of processes) {
    byPid.set(process.pid, process)
    const children = childrenByPid.get(process.ppid) ?? []
    children.push(process)
    childrenByPid.set(process.ppid, children)
  }

  return { byPid, childrenByPid }
}

function normalizeCommandLine(args: string): string {
  return args.trim().replace(/\s+/g, ' ')
}

export function isLoopTroopDevProcess(args: string, repoRoot: string): boolean {
  const command = normalizeCommandLine(args)
  const repoMarkers = [
    `${repoRoot}/node_modules/.bin/vite`,
    `${repoRoot}/node_modules/.bin/concurrently`,
    `${repoRoot}/scripts/dev-opencode.ts`,
    `${repoRoot}/server/index.ts`,
    'node_modules/.bin/vite',
    'node_modules/.bin/concurrently',
    'scripts/dev-opencode.ts',
    'tsx watch server/index.ts',
    'server/index.ts',
    'npm run dev:opencode',
    'npm run dev:frontend',
    'npm run dev:backend',
    'npm:dev:opencode',
    'npm:dev:frontend',
    'npm:dev:backend',
  ]

  return repoMarkers.some((marker) => command.includes(marker))
}

export function findOwningRootProcess(
  process: ProcessInfo,
  graph: ProcessGraph,
  repoRoot: string,
): ProcessInfo | null {
  let current: ProcessInfo | undefined = process
  let root: ProcessInfo | null = isLoopTroopDevProcess(process.args, repoRoot) ? process : null

  while (current) {
    const parent = graph.byPid.get(current.ppid)
    if (!parent) break

    if (isLoopTroopDevProcess(parent.args, repoRoot)) {
      root = parent
    }

    current = parent
  }

  return root
}

export function collectProcessTree(rootPid: number, graph: ProcessGraph): ProcessInfo[] {
  const ordered: ProcessInfo[] = []
  const visited = new Set<number>()

  const visit = (pid: number) => {
    if (visited.has(pid)) return
    visited.add(pid)

    for (const child of graph.childrenByPid.get(pid) ?? []) {
      visit(child.pid)
    }

    const process = graph.byPid.get(pid)
    if (process) {
      ordered.push(process)
    }
  }

  visit(rootPid)
  return ordered
}

export function resolveProcessTreesToTerminate(
  processes: ProcessInfo[],
  occupantPids: number[],
  repoRoot: string,
): {
  roots: ProcessInfo[]
  unrelatedOccupants: ProcessInfo[]
} {
  const graph = buildProcessGraph(processes)
  const roots = new Map<number, ProcessInfo>()
  const unrelatedOccupants: ProcessInfo[] = []

  for (const occupantPid of occupantPids) {
    const occupant = graph.byPid.get(occupantPid)
    if (!occupant) continue

    const root = findOwningRootProcess(occupant, graph, repoRoot)
    if (!root) {
      unrelatedOccupants.push(occupant)
      continue
    }

    roots.set(root.pid, root)
  }

  return {
    roots: [...roots.values()],
    unrelatedOccupants,
  }
}

export function formatProcessSummary(process: ProcessInfo): string {
  return `pid=${process.pid} ppid=${process.ppid} args=${process.args}`
}
