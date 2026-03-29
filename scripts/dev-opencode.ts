import { spawn } from 'node:child_process'
import { DEFAULT_OPENCODE_BASE_URL } from '../shared/appConfig'
import { resolveOpenCodeBaseUrl } from './opencode-dev-base-url'

const requestedBaseUrl = process.env.LOOPTROOP_OPENCODE_BASE_URL?.trim() || DEFAULT_OPENCODE_BASE_URL
const hasExplicitBaseUrl = Boolean(process.env.LOOPTROOP_OPENCODE_BASE_URL?.trim())

const { baseUrl, note, status } = await resolveOpenCodeBaseUrl({
  requestedBaseUrl,
  hasExplicitBaseUrl,
  mockMode: process.env.LOOPTROOP_OPENCODE_MODE === 'mock',
})

if (note) {
  console.log(`[dev-opencode] ${note}`)
}

if (status !== 'ready-to-start') {
  process.exit(0)
}

const url = new URL(baseUrl)
const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))

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
