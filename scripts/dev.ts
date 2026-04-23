import { randomBytes } from 'node:crypto'
import concurrently from 'concurrently'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_OPENCODE_BASE_URL, getBackendPort, getDocsOrigin, getDocsPort, getFrontendPort } from '../shared/appConfig'
import { readDevPreflightReport } from './dev-maintenance'
import { resolveOpenCodeBaseUrl } from './opencode-dev-base-url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const requestedBaseUrl = process.env.LOOPTROOP_OPENCODE_BASE_URL?.trim() || DEFAULT_OPENCODE_BASE_URL
const hasExplicitBaseUrl = Boolean(process.env.LOOPTROOP_OPENCODE_BASE_URL?.trim())
const childEnv = { ...process.env }
const preflightReport = readDevPreflightReport()

delete childEnv.NO_COLOR
delete childEnv.FORCE_COLOR

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

function printSummaryLine(label: string, value: string) {
  console.log(`[dev] ${label.padEnd(13)} ${value}`)
}

console.log('[dev] LoopTroop startup summary')
printSummaryLine('Frontend', `http://localhost:${getFrontendPort()}`)
printSummaryLine('Backend', `http://localhost:${getBackendPort()}`)
printSummaryLine('Docs', `${getDocsOrigin()} (port ${getDocsPort()})`)
printSummaryLine('OpenCode', baseUrl)

if (preflightReport) {
  if (preflightReport.opencode.skipped) {
    printSummaryLine('OpenCode CLI', 'Skipped automatic OpenCode upgrade via LOOPTROOP_DEV_SKIP_OPENCODE_UPGRADE=1')
  } else if (!preflightReport.opencode.available) {
    printSummaryLine('OpenCode CLI', 'Local opencode binary not found; skipped automatic CLI upgrade')
  } else if (preflightReport.opencode.upgraded) {
    printSummaryLine(
      'OpenCode CLI',
      `Upgraded ${preflightReport.opencode.versionBefore ?? 'unknown'} -> ${preflightReport.opencode.versionAfter ?? 'unknown'}` +
      (preflightReport.opencode.method ? ` via ${preflightReport.opencode.method}` : ''),
    )
  } else {
    printSummaryLine(
      'OpenCode CLI',
      `Already current at ${preflightReport.opencode.versionAfter ?? preflightReport.opencode.versionBefore ?? 'unknown'}` +
      (preflightReport.opencode.method ? ` via ${preflightReport.opencode.method}` : ''),
    )
  }

  if (preflightReport.dependencySync.skipped) {
    printSummaryLine('Dependencies', 'Skipped automatic dependency sync via LOOPTROOP_DEV_SKIP_DEPS=1')
  } else if (preflightReport.dependencySync.alreadyCurrent) {
    printSummaryLine('Dependencies', 'All direct dependencies already matched npm latest stable')
  } else {
    printSummaryLine(
      'Dependencies',
      `Updated ${preflightReport.dependencySync.updatedDependencies.length} runtime and ` +
      `${preflightReport.dependencySync.updatedDevDependencies.length} dev packages to latest stable` +
      (preflightReport.dependencySync.forced ? ' (with npm --force fallback)' : ''),
    )
  }

  if (preflightReport.audit.skipped) {
    printSummaryLine('Audit', 'Skipped automatic audit remediation via LOOPTROOP_DEV_SKIP_DEPS=1')
  } else if (preflightReport.audit.unresolved.length === 0) {
    printSummaryLine('Audit', 'No remaining npm audit findings after remediation')
  } else {
    printSummaryLine(
      'Audit',
      `${preflightReport.audit.totals.total} remaining finding(s): ` +
      `high=${preflightReport.audit.totals.high}, moderate=${preflightReport.audit.totals.moderate}`,
    )
    for (const issue of preflightReport.audit.unresolved.slice(0, 3)) {
      console.log(`[dev]   - ${issue.name} (${issue.severity})${issue.note ? `: ${issue.note}` : ''}`)
    }
  }
}

console.log('[dev] Launching frontend, backend, docs, and OpenCode watchers...')

const { commands, result } = concurrently(
  [
    {
      command: 'npm:dev:opencode',
      name: 'OPEN',
      prefixColor: 'bgYellow.black',
      env: {
        ...childEnv,
        LOOPTROOP_OPENCODE_BASE_URL: baseUrl,
      },
    },
    {
      command: 'npm:dev:frontend',
      name: 'WEB',
      prefixColor: 'bgBlue.black',
      env: {
        ...childEnv,
        LOOPTROOP_OPENCODE_BASE_URL: baseUrl,
      },
    },
    {
      command: 'npm:dev:backend',
      name: 'API',
      prefixColor: 'bgGreen.black',
      env: {
        ...childEnv,
        LOOPTROOP_OPENCODE_BASE_URL: baseUrl,
      },
    },
    {
      command: 'npm:docs:dev',
      name: 'DOCS',
      prefixColor: 'bgMagenta.black',
      env: {
        ...childEnv,
        LOOPTROOP_OPENCODE_BASE_URL: baseUrl,
      },
    },
  ],
  {
    cwd: repoRoot,
    prefix: '[{time} {name}]',
    timestampFormat: 'HH:mm:ss',
    padPrefix: true,
    prefixColors: ['bgYellow.black', 'bgBlue.black', 'bgGreen.black', 'bgMagenta.black'],
    timings: true,
    successCondition: 'all',
    killOthersOn: ['failure'],
  },
)

for (const command of commands) {
  command.stateChange.subscribe((state) => {
    if (state === 'started') {
      console.log(`[dev] Service ${command.name} started.`)
    }
  })

  command.error.subscribe((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[dev] Service ${command.name} failed to spawn: ${message}`)
  })

  command.close.subscribe((event) => {
    const outcome = event.exitCode === 0
      ? 'stopped cleanly'
      : event.killed
        ? `was terminated (${event.exitCode})`
        : `exited with ${event.exitCode}`
    console.log(
      `[dev] Service ${command.name} ${outcome} after ${event.timings.durationSeconds.toFixed(1)}s.`,
    )
  })
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[dev] Received ${signal}; stopping dev services...`)
    for (const command of commands) {
      try {
        command.kill(signal)
      } catch {
        // Ignore shutdown races.
      }
    }
  })
}

try {
  await result
  process.exit(0)
} catch {
  process.exit(1)
}
