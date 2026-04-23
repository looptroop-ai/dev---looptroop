import { spawnSync } from 'node:child_process'
import { accessSync, constants, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(__dirname, '..')
export const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const packageJsonPath = resolve(repoRoot, 'package.json')
const packageLockPath = resolve(repoRoot, 'package-lock.json')
const binExtension = process.platform === 'win32' ? '.cmd' : ''
const installStamp = resolve(repoRoot, 'node_modules', '.package-lock.json')
const requiredDevBins = ['tsx', 'vite', 'vitepress', 'concurrently']
export const devPreflightReportPath = resolve(repoRoot, 'tmp', 'dev-preflight-report.json')

const KNOWN_AUDIT_LEFTOVERS: Record<string, { note: string; url: string }> = {
  'drizzle-kit': {
    note: 'Stable drizzle-kit still depends on deprecated @esbuild-kit/*; the upstream fix is only available in the beta line.',
    url: 'https://github.com/drizzle-team/drizzle-orm/issues/3067',
  },
  vitepress: {
    note: 'Stable VitePress still ships its own older Vite line, so this remains until an upstream stable release lands.',
    url: 'https://github.com/advisories/GHSA-p9ff-h696-f583',
  },
  mermaid: {
    note: 'Stable Mermaid still pulls uuid <14; the published advisory targets v3/v5/v6 buffer writes and is treated here as a stable-upstream leftover.',
    url: 'https://github.com/advisories/GHSA-w5hq-g745-h8pq',
  },
}

export interface InstallReport {
  ran: boolean
  reasons: string[]
  forced: boolean
  errors: string[]
}

export interface DependencySyncReport {
  skipped: boolean
  checked: boolean
  alreadyCurrent: boolean
  forced: boolean
  errors: string[]
  updatedDependencies: string[]
  updatedDevDependencies: string[]
}

export interface AuditTotals {
  info: number
  low: number
  moderate: number
  high: number
  critical: number
  total: number
}

export interface AuditIssue {
  name: string
  severity: keyof AuditTotals
  relatedPackages: string[]
  note?: string
  url?: string
}

export interface AuditRemediationReport {
  skipped: boolean
  fixRan: boolean
  fixChanged: boolean
  unresolved: AuditIssue[]
  totals: AuditTotals
  errors: string[]
}

export interface OpenCodeUpgradeReport {
  skipped: boolean
  available: boolean
  checked: boolean
  upgraded: boolean
  alreadyCurrent: boolean
  method?: string
  versionBefore?: string
  versionAfter?: string
  errors: string[]
}

export interface DevPreflightReport {
  generatedAt: string
  install: InstallReport
  dependencySync: DependencySyncReport
  audit: AuditRemediationReport
  opencode: OpenCodeUpgradeReport
}

interface PackageManifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

interface OutdatedEntry {
  current?: string
  wanted?: string
  latest?: string
}

interface NpmCommandResult {
  status: number | null
  stdout: string
  stderr: string
}

function readPackageManifest(): PackageManifest {
  return JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageManifest
}

function pathExists(path: string) {
  try {
    accessSync(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function isExecutable(path: string) {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function getMtimeMs(path: string) {
  try {
    return statSync(path).mtimeMs
  } catch {
    return null
  }
}

function readFileIfPresent(path: string) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

export function getMissingBins() {
  return requiredDevBins.filter((name) => {
    const binPath = resolve(repoRoot, 'node_modules', '.bin', `${name}${binExtension}`)
    return !isExecutable(binPath)
  })
}

export function getInstallReasons() {
  const reasons: string[] = []
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
    for (const manifestPath of [packageJsonPath, packageLockPath]) {
      const manifestMtimeMs = getMtimeMs(manifestPath)
      if (manifestMtimeMs !== null && manifestMtimeMs > installStampMtimeMs) {
        reasons.push(`${basename(manifestPath)} changed after the last npm install`)
      }
    }
  }

  return reasons
}

function trimCommandOutput(raw: string) {
  return raw.trim()
}

function stripAnsi(raw: string) {
  return raw.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
}

function runCommand(
  args: string[],
  label: string,
  { verbose = false }: { verbose?: boolean } = {},
): NpmCommandResult {
  const result = spawnSync(npmCommand, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: verbose ? 'inherit' : 'pipe',
  })

  if (result.error) {
    throw new Error(`Failed to start ${label}: ${result.error.message}`)
  }

  return {
    status: result.status,
    stdout: trimCommandOutput(result.stdout ?? ''),
    stderr: trimCommandOutput(result.stderr ?? ''),
  }
}

function runExternalCommand(
  command: string,
  args: string[],
  label: string,
  { verbose = false }: { verbose?: boolean } = {},
) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: verbose ? 'inherit' : 'pipe',
  })

  if (result.error) {
    return {
      missing: 'code' in result.error && result.error.code === 'ENOENT',
      status: result.status,
      stdout: '',
      stderr: '',
      error: result.error,
    }
  }

  return {
    missing: false,
    status: result.status,
    stdout: stripAnsi(trimCommandOutput(result.stdout ?? '')),
    stderr: stripAnsi(trimCommandOutput(result.stderr ?? '')),
    error: null,
  }
}

function runInstallCommand(
  args: string[],
  label: string,
  { verbose = false, allowForceFallback = false }: { verbose?: boolean; allowForceFallback?: boolean } = {},
) {
  const initial = runCommand(args, label, { verbose })
  if (initial.status === 0) {
    return { forced: false }
  }

  if (!allowForceFallback) {
    const message = initial.stderr || initial.stdout || `${label} failed with code ${initial.status ?? 'unknown'}`
    throw new Error(message)
  }

  console.warn(`[dev-preflight] ${label} failed; retrying with --force.`)
  const forced = runCommand([...args, '--force'], `${label} --force`, { verbose })
  if (forced.status === 0) {
    return { forced: true }
  }

  const message = forced.stderr || forced.stdout || `${label} --force failed with code ${forced.status ?? 'unknown'}`
  throw new Error(message)
}

function emptyTotals(): AuditTotals {
  return {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
    total: 0,
  }
}

function severityRank(severity: string) {
  switch (severity) {
    case 'critical':
      return 5
    case 'high':
      return 4
    case 'moderate':
      return 3
    case 'low':
      return 2
    case 'info':
      return 1
    default:
      return 0
  }
}

function chooseAuditDisplayName(name: string, effects: string[] | undefined) {
  if (name === '@esbuild-kit/core-utils' || name === '@esbuild-kit/esm-loader') {
    return 'drizzle-kit'
  }

  if (name === 'uuid') {
    return 'mermaid'
  }

  if (name === 'vite') {
    return 'vitepress'
  }

  if (name === 'esbuild' && (effects?.includes('vite') || effects?.includes('vitepress'))) {
    return 'vitepress'
  }

  for (const effect of effects ?? []) {
    if (KNOWN_AUDIT_LEFTOVERS[effect]) {
      return effect
    }
  }

  return KNOWN_AUDIT_LEFTOVERS[name] ? name : (effects?.[0] ?? name)
}

function parseJson<T>(text: string): T | null {
  if (!text) return null

  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

function summarizeAuditIssues(vulnerabilities: Record<string, {
  name: string
  severity: keyof AuditTotals
  effects?: string[]
}> | undefined): AuditIssue[] {
  const issues = new Map<string, AuditIssue>()

  for (const [name, vulnerability] of Object.entries(vulnerabilities ?? {})) {
    const displayName = chooseAuditDisplayName(name, vulnerability.effects)
    const known = KNOWN_AUDIT_LEFTOVERS[displayName] ?? KNOWN_AUDIT_LEFTOVERS[name]
    const existing = issues.get(displayName)

    if (!existing) {
      issues.set(displayName, {
        name: displayName,
        severity: vulnerability.severity,
        relatedPackages: [name],
        note: known?.note,
        url: known?.url,
      })
      continue
    }

    if (severityRank(vulnerability.severity) > severityRank(existing.severity)) {
      existing.severity = vulnerability.severity
    }

    if (!existing.relatedPackages.includes(name)) {
      existing.relatedPackages.push(name)
    }
  }

  return [...issues.values()].sort((left, right) => {
    const severityDelta = severityRank(right.severity) - severityRank(left.severity)
    return severityDelta !== 0 ? severityDelta : left.name.localeCompare(right.name)
  })
}

export function ensureInstallIfNeeded({ verbose = false }: { verbose?: boolean } = {}): InstallReport {
  const reasons = getInstallReasons()
  if (reasons.length === 0) {
    return {
      ran: false,
      reasons: [],
      forced: false,
      errors: [],
    }
  }

  console.log('[dev-preflight] Running npm install before starting dev:')
  for (const reason of reasons) {
    console.log(`[dev-preflight] - ${reason}`)
  }

  try {
    const result = runInstallCommand(['install'], 'npm install', {
      verbose,
      allowForceFallback: true,
    })

    return {
      ran: true,
      reasons,
      forced: result.forced,
      errors: [],
    }
  } catch (error) {
    return {
      ran: true,
      reasons,
      forced: false,
      errors: [error instanceof Error ? error.message : String(error)],
    }
  }
}

export function syncDirectDependencies(
  { verbose = false, skip = false }: { verbose?: boolean; skip?: boolean } = {},
): DependencySyncReport {
  if (skip) {
    return {
      skipped: true,
      checked: false,
      alreadyCurrent: false,
      forced: false,
      errors: [],
      updatedDependencies: [],
      updatedDevDependencies: [],
    }
  }

  const outdatedResult = runCommand(['outdated', '--json', '--long'], 'npm outdated', { verbose: false })
  if (!outdatedResult.stdout) {
    return {
      skipped: false,
      checked: true,
      alreadyCurrent: true,
      forced: false,
      errors: [],
      updatedDependencies: [],
      updatedDevDependencies: [],
    }
  }

  const outdated = parseJson<Record<string, OutdatedEntry>>(outdatedResult.stdout)
  if (!outdated) {
    const message = outdatedResult.stderr || outdatedResult.stdout
    return {
      skipped: false,
      checked: false,
      alreadyCurrent: false,
      forced: false,
      errors: message ? [`Unable to parse npm outdated output: ${message}`] : [],
      updatedDependencies: [],
      updatedDevDependencies: [],
    }
  }

  const manifest = readPackageManifest()
  const updatedDependencies = Object.entries(outdated)
    .filter(([, entry]) => entry.current && entry.latest && entry.current !== entry.latest)
    .map(([name]) => name)
    .filter((name) => manifest.dependencies?.[name] != null)
  const updatedDevDependencies = Object.entries(outdated)
    .filter(([, entry]) => entry.current && entry.latest && entry.current !== entry.latest)
    .map(([name]) => name)
    .filter((name) => manifest.devDependencies?.[name] != null)

  if (updatedDependencies.length === 0 && updatedDevDependencies.length === 0) {
    return {
      skipped: false,
      checked: true,
      alreadyCurrent: true,
      forced: false,
      errors: [],
      updatedDependencies: [],
      updatedDevDependencies: [],
    }
  }

  let forced = false
  const errors: string[] = []

  try {
    if (updatedDependencies.length > 0) {
      console.log(
        `[dev-preflight] Updating ${updatedDependencies.length} direct runtime ` +
        `${updatedDependencies.length === 1 ? 'dependency' : 'dependencies'} to latest stable.`,
      )
      const result = runInstallCommand(
        ['install', ...updatedDependencies.map((name) => `${name}@latest`)],
        'npm install <dependencies>@latest',
        { verbose, allowForceFallback: true },
      )
      forced = forced || result.forced
    }

    if (updatedDevDependencies.length > 0) {
      console.log(
        `[dev-preflight] Updating ${updatedDevDependencies.length} direct dev ` +
        `${updatedDevDependencies.length === 1 ? 'dependency' : 'dependencies'} to latest stable.`,
      )
      const result = runInstallCommand(
        ['install', '-D', ...updatedDevDependencies.map((name) => `${name}@latest`)],
        'npm install -D <dependencies>@latest',
        { verbose, allowForceFallback: true },
      )
      forced = forced || result.forced
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }

  return {
    skipped: false,
    checked: true,
    alreadyCurrent: false,
    forced,
    errors,
    updatedDependencies,
    updatedDevDependencies,
  }
}

export function remediateAudit(
  { verbose = false, skip = false }: { verbose?: boolean; skip?: boolean } = {},
): AuditRemediationReport {
  if (skip) {
    return {
      skipped: true,
      fixRan: false,
      fixChanged: false,
      unresolved: [],
      totals: emptyTotals(),
      errors: [],
    }
  }

  const lockContentsBefore = readFileIfPresent(packageLockPath)
  const errors: string[] = []
  let fixRan = false

  try {
    fixRan = true
    runCommand(['audit', 'fix'], 'npm audit fix', { verbose })
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }

  const lockContentsAfter = readFileIfPresent(packageLockPath)
  const fixChanged = lockContentsBefore !== lockContentsAfter

  const auditResult = runCommand(['audit', '--json'], 'npm audit --json', { verbose: false })
  const auditJson = parseJson<{
    vulnerabilities?: Record<string, {
      name: string
      severity: keyof AuditTotals
      effects?: string[]
    }>
    metadata?: {
      vulnerabilities?: AuditTotals
    }
  }>(auditResult.stdout)

  if (!auditJson) {
    const message = auditResult.stderr || auditResult.stdout
    if (message) {
      errors.push(`Unable to parse npm audit output: ${message}`)
    }
  }

  return {
    skipped: false,
    fixRan,
    fixChanged,
    unresolved: summarizeAuditIssues(auditJson?.vulnerabilities),
    totals: auditJson?.metadata?.vulnerabilities ?? emptyTotals(),
    errors,
  }
}

function getOpenCodeVersion() {
  const result = runExternalCommand('opencode', ['--version'], 'opencode --version')
  if (result.missing) {
    return { available: false as const, version: null }
  }

  if (result.error) {
    throw new Error(`Failed to start opencode --version: ${result.error.message}`)
  }

  if (result.status !== 0) {
    const message = result.stderr || result.stdout || `opencode --version failed with code ${result.status ?? 'unknown'}`
    throw new Error(message)
  }

  const version = (result.stdout || result.stderr).trim() || null
  return { available: true as const, version }
}

export function upgradeOpenCodeCli(
  { verbose = false, skip = false, logPrefix = 'dev-preflight' }: { verbose?: boolean; skip?: boolean; logPrefix?: string } = {},
): OpenCodeUpgradeReport {
  if (skip) {
    return {
      skipped: true,
      available: false,
      checked: false,
      upgraded: false,
      alreadyCurrent: false,
      errors: [],
    }
  }

  let versionBefore: string | undefined
  let versionAfter: string | undefined

  try {
    const before = getOpenCodeVersion()
    if (!before.available) {
      return {
        skipped: false,
        available: false,
        checked: false,
        upgraded: false,
        alreadyCurrent: false,
        errors: [],
      }
    }

    versionBefore = before.version ?? undefined
    if (logPrefix) {
      console.log(`[${logPrefix}] Checking OpenCode CLI for updates.`)
    }

    const result = runExternalCommand('opencode', ['upgrade'], 'opencode upgrade', { verbose })
    if (result.missing) {
      return {
        skipped: false,
        available: false,
        checked: false,
        upgraded: false,
        alreadyCurrent: false,
        versionBefore,
        errors: [],
      }
    }

    if (result.error) {
      throw new Error(`Failed to start opencode upgrade: ${result.error.message}`)
    }

    if (result.status !== 0) {
      const message = result.stderr || result.stdout || `opencode upgrade failed with code ${result.status ?? 'unknown'}`
      return {
        skipped: false,
        available: true,
        checked: true,
        upgraded: false,
        alreadyCurrent: false,
        versionBefore,
        errors: [message],
      }
    }

    const after = getOpenCodeVersion()
    versionAfter = after.version ?? undefined

    const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
    const method = output.match(/Using method:\s*(.+)/i)?.[1]?.trim()
    const alreadyCurrent = /upgrade skipped:/i.test(output) ||
      (Boolean(versionBefore) && Boolean(versionAfter) && versionBefore === versionAfter)
    const upgraded = Boolean(versionBefore && versionAfter && versionBefore !== versionAfter)

    return {
      skipped: false,
      available: true,
      checked: true,
      upgraded,
      alreadyCurrent,
      method,
      versionBefore,
      versionAfter,
      errors: [],
    }
  } catch (error) {
    return {
      skipped: false,
      available: true,
      checked: false,
      upgraded: false,
      alreadyCurrent: false,
      versionBefore,
      versionAfter,
      errors: [error instanceof Error ? error.message : String(error)],
    }
  }
}

export function writeDevPreflightReport(report: DevPreflightReport) {
  mkdirSync(dirname(devPreflightReportPath), { recursive: true })
  writeFileSync(devPreflightReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

export function readDevPreflightReport(): DevPreflightReport | null {
  if (!existsSync(devPreflightReportPath)) {
    return null
  }

  return parseJson<DevPreflightReport>(readFileSync(devPreflightReportPath, 'utf8'))
}
