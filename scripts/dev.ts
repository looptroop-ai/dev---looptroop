import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_OPENCODE_BASE_URL, getBackendPort, getFrontendPort } from '../shared/appConfig'
import { resolveOpenCodeBaseUrl } from './opencode-dev-base-url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const concurrentlyBin = resolve(repoRoot, 'node_modules/.bin/concurrently')
const requestedBaseUrl = process.env.LOOPTROOP_OPENCODE_BASE_URL?.trim() || DEFAULT_OPENCODE_BASE_URL
const hasExplicitBaseUrl = Boolean(process.env.LOOPTROOP_OPENCODE_BASE_URL?.trim())
const childEnv = { ...process.env }

delete childEnv.NO_COLOR

const { baseUrl, note } = await resolveOpenCodeBaseUrl({
  requestedBaseUrl,
  hasExplicitBaseUrl,
  mockMode: process.env.LOOPTROOP_OPENCODE_MODE === 'mock',
})

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
