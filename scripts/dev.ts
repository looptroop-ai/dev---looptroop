import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_OPENCODE_BASE_URL, getBackendPort, getDocsOrigin, getDocsPort, getFrontendPort } from '../shared/appConfig'
import { resolveOpenCodeBaseUrl } from './opencode-dev-base-url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const concurrentlyBin = resolve(repoRoot, 'node_modules/.bin/concurrently')
const requestedBaseUrl = process.env.LOOPTROOP_OPENCODE_BASE_URL?.trim() || DEFAULT_OPENCODE_BASE_URL
const hasExplicitBaseUrl = Boolean(process.env.LOOPTROOP_OPENCODE_BASE_URL?.trim())
const childEnv = { ...process.env }

delete childEnv.NO_COLOR

const { baseUrl, note, status } = await resolveOpenCodeBaseUrl({
  requestedBaseUrl,
  hasExplicitBaseUrl,
  mockMode: process.env.LOOPTROOP_OPENCODE_MODE === 'mock',
})

if (note) {
  console.log(`[dev] ${note}`)
}

if (status === 'ready-to-start' && !childEnv.OPENCODE_SERVER_PASSWORD?.trim()) {
  childEnv.OPENCODE_SERVER_USERNAME = childEnv.OPENCODE_SERVER_USERNAME?.trim() || 'opencode'
  childEnv.OPENCODE_SERVER_PASSWORD = randomBytes(18).toString('base64url')
  console.log('[dev] Securing the local OpenCode dev server with ephemeral basic auth.')
}

console.log(
  `[dev] Starting LoopTroop services:` +
  ` frontend=http://localhost:${getFrontendPort()}` +
  ` backend=http://localhost:${getBackendPort()}` +
  ` docs=${getDocsOrigin()} (port ${getDocsPort()})` +
  ` opencode=${baseUrl}`,
)
console.log('[dev] Launching frontend, backend, docs, and OpenCode watchers...')

const child = spawn(
  concurrentlyBin,
  [
    '-n',
    'oc,fe,be,docs',
    '-c',
    'yellow,blue,green,magenta',
    'npm:dev:opencode',
    'npm:dev:frontend',
    'npm:dev:backend',
    'npm:docs:dev',
  ],
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
