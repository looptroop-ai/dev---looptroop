import net from 'node:net'
import {
  appendPortOccupantDetails,
  inspectPortOccupants,
  type PortOccupantInspection,
} from './port-occupants'

const MAX_PORT_SCAN_ATTEMPTS = 50

type ProbeDependencies = {
  canConnect: (hostname: string, port: number) => Promise<boolean>
  canListen: (hostname: string, port: number) => Promise<boolean>
  inspectPortOccupants: (port: number) => PortOccupantInspection
  isOpenCodeResponding: (url: URL, hostname: string, port: number) => Promise<boolean>
}

type ResolveOptions = {
  requestedBaseUrl: string
  hasExplicitBaseUrl: boolean
  mockMode?: boolean
  maxPortScanAttempts?: number
  deps?: Partial<ProbeDependencies>
}

export type ResolvedOpenCodeBaseUrl = {
  baseUrl: string
  note?: string
  status: 'mock' | 'remote' | 'already-running' | 'ready-to-start'
}

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

export function getProbeHosts(url: URL) {
  return Array.from(new Set([
    url.hostname,
    url.hostname === '0.0.0.0' ? '127.0.0.1' : url.hostname,
    url.hostname === 'localhost' ? '127.0.0.1' : '',
  ].filter(Boolean)))
}

function getServeHostname(url: URL) {
  return url.hostname === 'localhost' ? '127.0.0.1' : url.hostname
}

function withOccupantDetails(
  message: string,
  port: number,
  deps: ProbeDependencies,
) {
  return appendPortOccupantDetails(message, deps.inspectPortOccupants(port).occupants)
}

async function canConnect(hostname: string, port: number) {
  return await new Promise<boolean>((resolvePromise) => {
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

async function canListen(hostname: string, port: number) {
  return await new Promise<boolean>((resolvePromise) => {
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

async function findAvailablePort(
  url: URL,
  startPort: number,
  maxPortScanAttempts: number,
  deps: ProbeDependencies,
) {
  const serveHostname = getServeHostname(url)

  for (let offset = 0; offset < maxPortScanAttempts; offset += 1) {
    const candidatePort = startPort + offset
    if (await deps.canListen(serveHostname, candidatePort)) {
      return candidatePort
    }
  }

  return null
}

export async function resolveOpenCodeBaseUrl(options: ResolveOptions): Promise<ResolvedOpenCodeBaseUrl> {
  const {
    requestedBaseUrl,
    hasExplicitBaseUrl,
    mockMode = false,
    maxPortScanAttempts = MAX_PORT_SCAN_ATTEMPTS,
    deps: providedDeps,
  } = options

  if (mockMode) {
    return {
      baseUrl: requestedBaseUrl,
      note: 'Mock OpenCode mode enabled; skipping local port resolution.',
      status: 'mock',
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
      status: 'remote',
    }
  }

  const deps: ProbeDependencies = {
    canConnect: providedDeps?.canConnect ?? canConnect,
    canListen: providedDeps?.canListen ?? canListen,
    inspectPortOccupants: providedDeps?.inspectPortOccupants ?? inspectPortOccupants,
    isOpenCodeResponding: providedDeps?.isOpenCodeResponding ?? isOpenCodeResponding,
  }

  const port = getPort(url)
  const probeHosts = getProbeHosts(url)

  for (const host of probeHosts) {
    if (await deps.isOpenCodeResponding(url, host, port)) {
      return {
        baseUrl: normalizedBaseUrl,
        note: `OpenCode already reachable at ${normalizedBaseUrl}; reusing it.`,
        status: 'already-running',
      }
    }
  }

  for (const host of probeHosts) {
    if (!(await deps.canConnect(host, port))) continue

    if (hasExplicitBaseUrl) {
      throw new Error(
        withOccupantDetails(
          `Configured OpenCode URL ${normalizedBaseUrl} is occupied by a non-OpenCode process on ${host}.`,
          port,
          deps,
        ) +
        ' ' +
        'Choose a different LOOPTROOP_OPENCODE_BASE_URL before running `npm run dev`.',
      )
    }

    const fallbackPort = await findAvailablePort(url, port + 1, maxPortScanAttempts, deps)
    if (!fallbackPort) {
      throw new Error(
        withOccupantDetails(
          `Default OpenCode port ${port} is occupied by another process on ${host} and no free fallback port was found.`,
          port,
          deps,
        ),
      )
    }

    const fallbackUrl = new URL(url.toString())
    fallbackUrl.port = String(fallbackPort)

    return {
      baseUrl: formatBaseUrl(fallbackUrl),
      note: withOccupantDetails(
        `Port ${port} is occupied on ${host}; using ${formatBaseUrl(fallbackUrl)} for OpenCode instead.`,
        port,
        deps,
      ),
      status: 'ready-to-start',
    }
  }

  return { baseUrl: normalizedBaseUrl, status: 'ready-to-start' }
}
