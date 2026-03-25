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

let alreadyRunning = false

for (const host of probeHosts) {
  if (await canConnect(host, port)) {
    alreadyRunning = true
    break
  }
}

if (alreadyRunning) {
  console.log(`[dev-opencode] OpenCode already reachable at ${baseUrl}, skipping duplicate startup.`)
  process.exit(0)
}

const serveHostname = url.hostname === 'localhost' ? '127.0.0.1' : url.hostname
console.log(`[dev-opencode] Starting OpenCode on ${serveHostname}:${port}.`)

const child = spawn('opencode', ['serve', '--print-logs', '--hostname', serveHostname, '--port', String(port)], {
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
