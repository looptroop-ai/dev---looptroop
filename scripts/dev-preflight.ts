import { execFileSync } from 'node:child_process'
import net from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getBackendPort, getFrontendPort } from '../shared/appConfig'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

const REPO_PROCESS_MARKERS = [
  `${repoRoot}/node_modules/.bin/vite`,
  `${repoRoot}/server/index.ts`,
  `${repoRoot}/node_modules/concurrently`,
  `${repoRoot}/scripts/dev-preflight.ts`,
]

function listProcesses() {
  const output = execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' })
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const firstSpace = line.indexOf(' ')
      const pid = Number(line.slice(0, firstSpace))
      const args = line.slice(firstSpace + 1)
      return { pid, args }
    })
    .filter((entry) => Number.isInteger(entry.pid) && entry.pid > 0)
}

function isLoopTroopDevProcess(args: string) {
  return REPO_PROCESS_MARKERS.some((marker) => args.includes(marker))
}

function killProcess(pid: number) {
  try {
    process.kill(pid, 'SIGTERM')
    return true
  } catch {
    return false
  }
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

function describePortOccupants(port: number) {
  try {
    return execFileSync('ss', ['-ltnp', `( sport = :${port} )`], { encoding: 'utf8' }).trim()
  } catch {
    return `Port ${port} is in use by another process.`
  }
}

const processes = listProcesses()
const stalePids = processes
  .filter((entry) => entry.pid !== process.pid && isLoopTroopDevProcess(entry.args))
  .map((entry) => entry.pid)

if (stalePids.length > 0) {
  for (const pid of stalePids) {
    killProcess(pid)
  }
}

await new Promise((resolvePromise) => setTimeout(resolvePromise, stalePids.length > 0 ? 500 : 0))

for (const port of [getFrontendPort(), getBackendPort()]) {
  try {
    await ensurePortFree(port)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[dev-preflight] Cannot start LoopTroop on port ${port}: ${message}`)
    console.error(describePortOccupants(port))
    process.exit(1)
  }
}
