import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDocsOrigin, getDocsPort } from '../shared/appConfig'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const binExtension = process.platform === 'win32' ? '.cmd' : ''
const vitepressBin = resolve(repoRoot, 'node_modules', '.bin', `vitepress${binExtension}`)
const docsPort = getDocsPort()
const docsOrigin = getDocsOrigin()

console.log(`[dev-docs] Starting VitePress docs at ${docsOrigin}.`)

const child = spawn(vitepressBin, ['dev', 'docs', '--port', String(docsPort), '--strictPort'], {
  cwd: repoRoot,
  stdio: 'inherit',
})

child.once('error', (error) => {
  console.error(`[dev-docs] Failed to start VitePress: ${error.message}`)
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
