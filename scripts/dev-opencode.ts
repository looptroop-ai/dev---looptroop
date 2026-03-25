import net from 'node:net'
import { spawn } from 'node:child_process'
import { DEFAULT_OPENCODE_BASE_URL } from '../shared/appConfig'

const baseUrl = process.env.LOOPTROOP_OPENCODE_BASE_URL?.trim() || DEFAULT_OPENCODE_BASE_URL

if (process.env.LOOPTROOP_OPENCODE_MODE === 'mock') {
  console.log('[dev-opencode] Mock mode enabled, skipping OpenCode startup.')
  process.exit(0)
}

let url: URL

try {
  url = new URL(baseUrl)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[dev-opencode] Invalid OpenCode base URL "${baseUrl}": ${message}`)
  process.exit(1)
}

function isLocalHost(hostname: string) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '0.0.0.0' || hostname === '::1'
}

if (!isLocalHost(url.hostname)) {
  console.log(`[dev-opencode] OpenCode points to remote host (${baseUrl}), skipping local startup.`)
  process.exit(0)
}

const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))

if (!Number.isInteger(port) || port <= 0) {
  console.error(`[dev-opencode] Could not determine a valid port from "${baseUrl}".`)
  process.exit(1)
}

const probeHosts = Array.from(new Set([
  url.hostname,
  url.hostname === '0.0.0.0' ? '127.0.0.1' : url.hostname,
  url.hostname === 'localhost' ? '127.0.0.1' : '',
].filter(Boolean)))

function canConnect(hostname: string, targetPort: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: hostname, port: targetPort })

    const finish = (connected: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(connected)
    }

    socket.setTimeout(500)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

async function isOpenCodeResponding(hostname: string, targetPort: number): Promise<boolean> {
  try {
    const res = await fetch(`http://${hostname}:${targetPort}/provider`, {
      signal: AbortSignal.timeout(1000),
    })
    // OpenCode /provider returns 200 with { all, default, connected }.
    // Any other service (e.g. a different dev tool) will return 401/404/etc.
    return res.ok
  } catch {
    return false
  }
}

let alreadyRunning = false

for (const host of probeHosts) {
  if (await isOpenCodeResponding(host, port)) {
    alreadyRunning = true
    break
  }
}

if (!alreadyRunning) {
  // Port reachable but not serving the OpenCode API — refuse to proceed so that
  // the user gets a clear diagnostic instead of a cryptic 401 from an unrelated
  // service (e.g. a VS Code extension sharing the same port).
  for (const host of probeHosts) {
    if (await canConnect(host, port)) {
      console.error(
        `[dev-opencode] Port ${port} is already in use by a non-OpenCode process on ${host}.` +
        ` Set LOOPTROOP_OPENCODE_BASE_URL to a free port (e.g. http://127.0.0.1:4097) or` +
        ` stop the conflicting service before running \`npm run dev\`.`,
      )
      process.exit(1)
    }
  }
}

if (alreadyRunning) {
  console.log(`[dev-opencode] OpenCode already reachable at ${baseUrl}, skipping duplicate startup.`)
  process.exit(0)
}

const serveHostname = url.hostname === 'localhost' ? '127.0.0.1' : url.hostname
console.log(`[dev-opencode] Checking OpenCode availability at ${baseUrl}.`)
console.log(`[dev-opencode] Starting OpenCode on ${serveHostname}:${port}.`)

const child = spawn('opencode', ['serve', '--log-level', 'WARN', '--hostname', serveHostname, '--port', String(port)], {
  stdio: 'inherit',
})

child.once('error', (error) => {
  console.error(`[dev-opencode] Failed to start OpenCode: ${error.message}`)
  process.exit(1)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (!child.killed) {
      child.kill(signal)
    }
  })
}

child.once('exit', (code) => {
  process.exit(code ?? 0)
})
