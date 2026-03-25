import { execFileSync } from 'node:child_process'
import net from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getBackendPort, getFrontendPort } from '../shared/appConfig'
import {
  buildProcessGraph,
  collectProcessTree,
  formatProcessSummary,
  isLoopTroopDevProcess,
  findOwningRootProcess,
  parseProcessTable,
  resolveProcessTreesToTerminate,
  type ProcessInfo,
} from './dev-preflight-utils'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const verboseLogging = process.env.LOOPTROOP_DEV_VERBOSE === '1'

function listProcesses() {
  const output = execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' })
  return parseProcessTable(output)
}

function collectProtectedPids(currentPid: number, graph: ReturnType<typeof buildProcessGraph>) {
  const protectedPids = new Set<number>()
  let current = graph.byPid.get(currentPid)

  while (current) {
    protectedPids.add(current.pid)
    current = graph.byPid.get(current.ppid)
  }

  return protectedPids
}

function killProcess(pid: number, signal: NodeJS.Signals = 'SIGTERM') {
  try {
    process.kill(pid, signal)
    return true
  } catch {
    return false
  }
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function sleep(ms: number) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

async function ensurePortFree(port: number) {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const server = net.createServer()
    server.once('error', (error) => {
      server.close()
      rejectPromise(error)
    })
    server.listen(port, '127.0.0.1', () => {
      server.close((closeError) => {
        if (closeError) {
          rejectPromise(closeError)
          return
        }
        resolvePromise()
      })
    })
  })
}

function getPortOccupantOutput(port: number): string | null {
  try {
    return execFileSync('ss', ['-ltnp', `( sport = :${port} )`], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

function describePortOccupants(port: number) {
  return getPortOccupantOutput(port) ?? `Port ${port} is in use by another process.`
}

function listPortOccupantPids(port: number): number[] {
  const output = getPortOccupantOutput(port)
  if (!output) return []
  const matches = output.matchAll(/pid=(\d+)/g)
  return Array.from(new Set(Array.from(matches, (match) => Number(match[1]))))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)
}

async function terminateProcessTree(root: ProcessInfo, graph = buildProcessGraph(listProcesses())) {
  const processTree = collectProcessTree(root.pid, graph)
  console.log(
    `[dev-preflight] Stopping stale LoopTroop dev tree rooted at ${formatProcessSummary(root)}` +
    ` (${processTree.length} ${processTree.length === 1 ? 'process' : 'processes'}).`,
  )
  if (verboseLogging) {
    console.log(`[dev-preflight]   tree: ${processTree.map(formatProcessSummary).join(' | ')}`)
  }

  for (const entry of processTree) {
    killProcess(entry.pid)
  }

  await sleep(300)

  const survivors = processTree.filter((entry) => isProcessAlive(entry.pid))
  if (survivors.length > 0) {
    console.warn(
      `[dev-preflight] Escalating to SIGKILL for ${survivors.length} stubborn ` +
      `${survivors.length === 1 ? 'process' : 'processes'} in the stale dev tree.`,
    )
    if (verboseLogging) {
      console.warn(`[dev-preflight]   survivors: ${survivors.map(formatProcessSummary).join(' | ')}`)
    }
    for (const entry of survivors) {
      killProcess(entry.pid, 'SIGKILL')
    }
    await sleep(300)
  }
}

async function reclaimOccupiedPorts(ports: number[]) {
  const processes = listProcesses()
  const graph = buildProcessGraph(processes)
  const protectedPids = collectProtectedPids(process.pid, graph)

  const initialRoots = new Map<number, ProcessInfo>()
  const unresolvedOccupants: Array<{ port: number; process: ProcessInfo }> = []

  for (const port of ports) {
    const occupantPids = listPortOccupantPids(port)
    const resolution = resolveProcessTreesToTerminate(processes, occupantPids, repoRoot)
    for (const root of resolution.roots) {
      if (protectedPids.has(root.pid)) continue
      initialRoots.set(root.pid, root)
    }
    for (const occupant of resolution.unrelatedOccupants) {
      unresolvedOccupants.push({ port, process: occupant })
    }
  }

  if (unresolvedOccupants.length > 0) {
    for (const occupant of unresolvedOccupants) {
      console.error(`[dev-preflight] Refusing to terminate unrelated occupant on port ${occupant.port}: ${formatProcessSummary(occupant.process)}`)
    }
    return false
  }

  for (const root of initialRoots.values()) {
    await terminateProcessTree(root, graph)
  }

  await sleep(500)
  return true
}

const processes = listProcesses()
const graph = buildProcessGraph(processes)
const protectedPids = collectProtectedPids(process.pid, graph)
const staleRoots = new Map<number, ProcessInfo>()
for (const processEntry of processes) {
  if (processEntry.pid === process.pid) continue
  if (!isLoopTroopDevProcess(processEntry.args, repoRoot)) continue
  const root = findOwningRootProcess(processEntry, graph, repoRoot)
  if (root && !protectedPids.has(root.pid)) {
    staleRoots.set(root.pid, root)
  }
}

for (const root of staleRoots.values()) {
  await terminateProcessTree(root, graph)
}

if (staleRoots.size > 0) {
  await sleep(500)
}

const reclaimed = await reclaimOccupiedPorts([getFrontendPort(), getBackendPort()])
if (!reclaimed) {
  process.exit(1)
}

for (const port of [getFrontendPort(), getBackendPort()]) {
  try {
    await ensurePortFree(port)
  } catch (error) {
    const occupantPids = listPortOccupantPids(port)
    const remainingProcesses = listProcesses()
    const resolution = resolveProcessTreesToTerminate(remainingProcesses, occupantPids, repoRoot)
    if (resolution.roots.length > 0) {
      const graph = buildProcessGraph(remainingProcesses)
      const protectedPids = collectProtectedPids(process.pid, graph)
      for (const root of resolution.roots) {
        if (protectedPids.has(root.pid)) continue
        await terminateProcessTree(root, graph)
      }
      await sleep(500)
    }

    try {
      await ensurePortFree(port)
    } catch (retryError) {
      const message = retryError instanceof Error ? retryError.message : String(retryError)
      console.error(`[dev-preflight] Cannot start LoopTroop on port ${port}: ${message}`)
      console.error(describePortOccupants(port))
      if (error instanceof Error && error.message) {
        console.error(`[dev-preflight] Initial check failed with: ${error.message}`)
      }
      process.exit(1)
    }
  }
}
