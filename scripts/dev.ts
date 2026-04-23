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

type DevService = {
  name: string
  prefixColor: string
  command: string
  displayCommand: string
  description: string
}

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

function printDivider(title: string) {
  const bar = '='.repeat(18)
  console.log(`[dev] ${bar} ${title} ${bar}`)
}

const services: DevService[] = [
  {
    name: 'OPEN',
    prefixColor: 'bgYellow.black',
    command: 'npm:dev:opencode',
    displayCommand: 'tsx scripts/dev-opencode.ts',
    description: 'Ensure the local OpenCode server is reachable, then start it if needed.',
  },
  {
    name: 'WEB',
    prefixColor: 'bgBlue.black',
    command: 'npm:dev:frontend',
    displayCommand: 'vite',
    description: 'Start the frontend dev server for the LoopTroop dashboard.',
  },
  {
    name: 'API',
    prefixColor: 'bgGreen.black',
    command: 'npm:dev:backend',
    displayCommand: 'tsx scripts/dev-backend.ts',
    description: 'Watch the backend and restart it when server files change.',
  },
  {
    name: 'DOCS',
    prefixColor: 'bgMagenta.black',
    command: 'npm:docs:dev',
    displayCommand: 'tsx scripts/dev-docs.ts',
    description: 'Serve the VitePress documentation site alongside the app.',
  },
]

printDivider('Startup Summary')
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

printDivider('Service Plan')
console.log('[dev] Step 1        Preflight maintenance already completed before this launcher started.')
console.log('[dev]               Purpose: install missing packages, sync direct deps, run audit fix, and refresh the OpenCode CLI.')

services.forEach((service, index) => {
  const stepNumber = index + 2
  console.log(`[dev] Step ${String(stepNumber).padEnd(8)} ${service.name}  ${service.displayCommand}`)
  console.log(`[dev]               Purpose: ${service.description}`)
})

printDivider('Live Services')
console.log('[dev] Launching frontend, backend, docs, and OpenCode watchers...')

const { commands, result } = concurrently(
  services.map((service) => ({
    command: service.command,
    name: service.name,
    prefixColor: service.prefixColor,
    env: {
      ...childEnv,
      LOOPTROOP_OPENCODE_BASE_URL: baseUrl,
    },
  })),
  {
    cwd: repoRoot,
    prefix: '[{time} {name}]',
    timestampFormat: 'HH:mm:ss',
    padPrefix: true,
    prefixColors: services.map((service) => service.prefixColor),
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
