import { spawnSync } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const binExtension = process.platform === 'win32' ? '.cmd' : ''
const tsxBin = resolve(repoRoot, 'node_modules', '.bin', `tsx${binExtension}`)
const installStamp = resolve(repoRoot, 'node_modules', '.package-lock.json')
const trackedManifests = [
  resolve(repoRoot, 'package.json'),
  resolve(repoRoot, 'package-lock.json'),
]
const requiredDevBins = ['tsx', 'vite', 'vitepress', 'concurrently']

function pathExists(path) {
  try {
    accessSync(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function getMtimeMs(path) {
  try {
    return statSync(path).mtimeMs
  } catch {
    return null
  }
}

function getMissingBins() {
  return requiredDevBins.filter((name) => {
    const binPath = resolve(repoRoot, 'node_modules', '.bin', `${name}${binExtension}`)
    return !isExecutable(binPath)
  })
}

function getInstallReasons() {
  const reasons = []
  const missingBins = getMissingBins()

  if (!pathExists(resolve(repoRoot, 'node_modules'))) {
    reasons.push('node_modules is missing')
  }

  if (!pathExists(installStamp)) {
    reasons.push('the npm install stamp is missing')
  }

  if (missingBins.length > 0) {
    reasons.push(`missing local dev binaries: ${missingBins.join(', ')}`)
  }

  const installStampMtimeMs = getMtimeMs(installStamp)
  if (installStampMtimeMs !== null) {
    for (const manifestPath of trackedManifests) {
      const manifestMtimeMs = getMtimeMs(manifestPath)
      if (manifestMtimeMs !== null && manifestMtimeMs > installStampMtimeMs) {
        reasons.push(`${basename(manifestPath)} changed after the last npm install`)
      }
    }
  }

  return reasons
}

function runOrExit(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
  })

  if (result.error) {
    console.error(`[dev-preflight] Failed to start ${label}: ${result.error.message}`)
    process.exit(1)
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

const installReasons = getInstallReasons()
if (installReasons.length > 0) {
  console.log('[dev-preflight] Running npm install before starting dev:')
  for (const reason of installReasons) {
    console.log(`[dev-preflight] - ${reason}`)
  }

  runOrExit(npmCommand, ['install'], 'npm install')
}

const missingBinsAfterInstall = getMissingBins()
if (missingBinsAfterInstall.length > 0) {
  console.error(
    '[dev-preflight] Required dev tools are still missing after npm install: ' +
    missingBinsAfterInstall.join(', '),
  )
  process.exit(1)
}

runOrExit(tsxBin, [resolve(repoRoot, 'scripts', 'dev-preflight.ts')], 'the TypeScript dev preflight')
