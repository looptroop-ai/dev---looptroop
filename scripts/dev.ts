import net from 'node:net'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_OPENCODE_BASE_URL, getBackendPort, getFrontendPort } from '../shared/appConfig'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const concurrentlyBin = resolve(repoRoot, 'node_modules/.bin/concurrently')
const requestedBaseUrl = process.env.LOOPTROOP_OPENCODE_BASE_URL?.trim() || DEFAULT_OPENCODE_BASE_URL
const hasExplicitBaseUrl = Boolean(process.env.LOOPTROOP_OPENCODE_BASE_URL?.trim())
const MAX_PORT_SCAN_ATTEMPTS = 50
const childEnv = { ...process.env }

delete childEnv.NO_COLOR

function isLocalHost(hostname: string) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '0.0.0.0' || hostname === '::1'
}

function formatBaseUrl(url: URL) {
  const pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')
  return `${url.protocol}//${url.host}${pathname}`
}

function getPort(url: URL) {
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Could not determine a valid port from "${formatBaseUrl(url)}".`)
  }
  return port
}

function getProbeHosts(url: URL) {
  return Array.from(new Set([
    url.hostname,
    url.hostname === '0.0.0.0' ? '127.0.0.1' : url.hostname,
    url.hostname === 'localhost' ? '127.0.0.1' : '',
  ].filter(Boolean)))
}

function getServeHostname(url: URL) {
  return url.hostname === 'localhost' ? '127.0.0.1' : url.hostname
}

function canConnect(hostname: string, port: number) {
  return new Promise<boolean>((resolvePromise) => {
    const socket = net.createConnection({ host: hostname, port })

    const finish = (connected: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolvePromise(connected)
    }

    socket.setTimeout(500)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

async function isOpenCodeResponding(url: URL, hostname: string, port: number) {
  try {
    const res = await fetch(`${url.protocol}//${hostname}:${port}/provider`, {
      signal: AbortSignal.timeout(1000),
    })
    return res.ok
  } catch {
    return false
  }
}

function canListen(hostname: string, port: number) {
  return new Promise<boolean>((resolvePromise) => {
    const server = net.createServer()
    server.unref()

    const finish = (free: boolean) => {
      server.removeAllListeners('error')
      server.removeAllListeners('listening')

      if (free) {
        server.close(() => resolvePromise(true))
        return
      }

      if (server.listening) {
        server.close(() => resolvePromise(false))
        return
      }

      resolvePromise(false)
    }

    server.once('error', () => finish(false))
    server.once('listening', () => finish(true))
    server.listen(port, hostname)
  })
}

async function findAvailablePort(url: URL, startPort: number) {
  const serveHostname = getServeHostname(url)

  for (let offset = 0; offset < MAX_PORT_SCAN_ATTEMPTS; offset += 1) {
    const candidatePort = startPort + offset
    if (await canListen(serveHostname, candidatePort)) {
      return candidatePort
    }
  }

  return null
}

async function resolveOpenCodeBaseUrl() {
  if (process.env.LOOPTROOP_OPENCODE_MODE === 'mock') {
    return {
      baseUrl: requestedBaseUrl,
      note: 'Mock OpenCode mode enabled; skipping local port resolution.',
    }
  }

  let url: URL

  try {
    url = new URL(requestedBaseUrl)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid OpenCode base URL "${requestedBaseUrl}": ${message}`)
  }

  const normalizedBaseUrl = formatBaseUrl(url)

  if (!isLocalHost(url.hostname)) {
    return {
      baseUrl: normalizedBaseUrl,
      note: `Using remote OpenCode at ${normalizedBaseUrl}.`,
    }
  }

  const port = getPort(url)
  const probeHosts = getProbeHosts(url)

  for (const host of probeHosts) {
    if (await isOpenCodeResponding(url, host, port)) {
      return {
        baseUrl: normalizedBaseUrl,
        note: `OpenCode already reachable at ${normalizedBaseUrl}; reusing it.`,
      }
    }
  }

  for (const host of probeHosts) {
    if (!(await canConnect(host, port))) continue

    if (hasExplicitBaseUrl) {
      throw new Error(
        `Configured OpenCode URL ${normalizedBaseUrl} is occupied by a non-OpenCode process on ${host}. ` +
        'Choose a different LOOPTROOP_OPENCODE_BASE_URL before running `npm run dev`.',
      )
    }

    const fallbackPort = await findAvailablePort(url, port + 1)
    if (!fallbackPort) {
      throw new Error(
        `Default OpenCode port ${port} is occupied by another process on ${host} and no free fallback port was found.`,
      )
    }

    const fallbackUrl = new URL(url.toString())
    fallbackUrl.port = String(fallbackPort)

    return {
      baseUrl: formatBaseUrl(fallbackUrl),
      note: `Port ${port} is occupied by another app on ${host}; using ${formatBaseUrl(fallbackUrl)} for OpenCode instead.`,
    }
  }

  return { baseUrl: normalizedBaseUrl }
}

const { baseUrl, note } = await resolveOpenCodeBaseUrl()

if (note) {
  console.log(`[dev] ${note}`)
}

console.log(
  `[dev] Starting LoopTroop services:` +
  ` frontend=http://localhost:${getFrontendPort()}` +
  ` backend=http://localhost:${getBackendPort()}` +
  ` opencode=${baseUrl}`,
)
console.log('[dev] Launching frontend, backend, and OpenCode watchers...')

const child = spawn(
  concurrentlyBin,
  ['-n', 'oc,fe,be', '-c', 'yellow,blue,green', 'npm:dev:opencode', 'npm:dev:frontend', 'npm:dev:backend'],
  {
    cwd: repoRoot,
    env: {
      ...childEnv,
      LOOPTROOP_OPENCODE_BASE_URL: baseUrl,
    },
    stdio: 'inherit',
  },
)

child.once('error', (error) => {
  console.error(`[dev] Failed to start dev stack: ${error.message}`)
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
