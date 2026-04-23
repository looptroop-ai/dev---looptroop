import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const binExtension = process.platform === 'win32' ? '.cmd' : ''
const tsxBin = resolve(repoRoot, 'node_modules', '.bin', `tsx${binExtension}`)
const explicitPolling = process.env.CHOKIDAR_USEPOLLING?.trim()
const workspaceLooksMounted = process.platform !== 'win32' && repoRoot.startsWith('/mnt/')

const childEnv = { ...process.env }

function isTruthy(value: string) {
  return value !== '' && value !== '0' && value.toLowerCase() !== 'false'
}

if (explicitPolling) {
  if (isTruthy(explicitPolling)) {
    childEnv.CHOKIDAR_USEPOLLING = explicitPolling
    console.log(`[dev-backend] Respecting CHOKIDAR_USEPOLLING=${explicitPolling}.`)
  } else {
    delete childEnv.CHOKIDAR_USEPOLLING
    console.log('[dev-backend] Respecting CHOKIDAR_USEPOLLING disable override; using native file watching.')
  }
} else if (workspaceLooksMounted) {
  childEnv.CHOKIDAR_USEPOLLING = '1'
  console.log('[dev-backend] Mounted-drive workspace detected; enabling chokidar polling.')
} else {
  delete childEnv.CHOKIDAR_USEPOLLING
  console.log('[dev-backend] Using native file watching.')
}

const child = spawn(tsxBin, ['watch', 'server/index.ts'], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: childEnv,
})

child.once('error', (error) => {
  console.error(`[dev-backend] Failed to start backend watcher: ${error.message}`)
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
