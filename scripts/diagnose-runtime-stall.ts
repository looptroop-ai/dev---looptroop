import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import Database from 'better-sqlite3'

interface CliOptions {
  backendPort?: number
  frontendPort?: number
  opencodeUrl?: string
  timeoutMs?: number
}

interface CommandResult {
  command: string
  durationMs: number
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
  error?: string
}

interface HttpProbeResult {
  label: string
  url: string
  durationMs: number
  ok: boolean
  status: number | null
  bodyPreview: string
  error?: string
}

interface FsLatencyProbe {
  label: string
  durationMs: number
  ok: boolean
  details: string
  error?: string
}

interface MountSnapshot {
  path: string
  target: string | null
  source: string | null
  fstype: string | null
  options: string | null
  error?: string
}

interface DiskUsageSnapshot {
  path: string
  filesystem: string | null
  totalKb: number | null
  usedKb: number | null
  availableKb: number | null
  usePercent: number | null
  mountedOn: string | null
  error?: string
}

interface InodeUsageSnapshot {
  path: string
  filesystem: string | null
  totalInodes: number | null
  usedInodes: number | null
  freeInodes: number | null
  usePercent: number | null
  mountedOn: string | null
  error?: string
}

interface PressureMetrics {
  avg10: number | null
  avg60: number | null
  avg300: number | null
  total: number | null
  raw: string
}

interface PressureSnapshot {
  path: string
  some: PressureMetrics | null
  full: PressureMetrics | null
  error?: string
}

interface ProcessIoSnapshot {
  pid: number
  values: Record<string, number>
  raw: string
  error?: string
}

interface CorrelationSample {
  at: string
  healthOk: boolean
  healthStatus: number | null
  healthDurationMs: number
  healthError?: string
  ticketsOk: boolean
  ticketsStatus: number | null
  ticketsDurationMs: number
  ticketsError?: string
  processStat: string | null
  processWchan: string | null
}

interface AttachedProjectRow {
  id: number
  folderPath: string
  createdAt: string
  updatedAt: string
}

interface TicketRow {
  external_id: string
  status: string
  updated_at: string
}

interface ActiveSessionRow {
  session_id: string
  ticket_id: number | null
  phase: string
  member_id: string | null
  step: string | null
  updated_at: string
}

interface ProjectSnapshot {
  id: number
  folderPath: string
  exists: boolean
  projectDbPath: string
  projectDbExists: boolean
  projectName: string | null
  shortname: string | null
  ticketCounter: number | null
  ticketCount: number
  activeSessionCount: number
  recentTickets: TicketRow[]
  activeSessions: ActiveSessionRow[]
  statusCounts: Array<{ status: string; count: number }>
  metaFilesChecked: number
  missingMetaFiles: number
  metaWithoutBaseBranch: number
  metaWarnings: string[]
  pathWarnings: string[]
  dbOpenMs: number
  dbQueryMs: number
  mount: MountSnapshot
  diskUsage: DiskUsageSnapshot
  inodeUsage: InodeUsageSnapshot
  latencyProbes: FsLatencyProbe[]
}

const cli = parseCliArgs(process.argv.slice(2))
const reportLines: string[] = []
const startedAt = new Date()
const runTimestamp = formatFileTimestamp(startedAt)
const reportDir = resolve(process.cwd(), 'tmp', 'diagnostics')
const reportPath = resolve(reportDir, `runtime-stall-${runTimestamp}.log`)
const commandAvailability = new Map<string, boolean>()

if (process.argv.includes('--help')) {
  printHelp()
  process.exit(0)
}

function print(line = '') {
  console.log(line)
  reportLines.push(line)
}

function heading(title: string) {
  print()
  print(`=== ${title} ===`)
}

function kv(label: string, value: unknown) {
  print(`${label}: ${formatValue(value)}`)
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'n/a'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value, null, 2)
}

function formatDuration(durationMs: number): string {
  return `${durationMs}ms`
}

function formatBodyPreview(raw: string, limit = 500): string {
  const compact = raw.replace(/\s+/g, ' ').trim()
  if (compact.length <= limit) return compact || '(empty body)'
  return `${compact.slice(0, limit)}...`
}

function formatFileTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('')
}

function parseCliArgs(args: string[]): CliOptions {
  const options: CliOptions = {}

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (!arg) continue

    const next = args[i + 1]

    if (arg === '--backend-port' && next) {
      options.backendPort = Number(next)
      i += 1
      continue
    }

    if (arg === '--frontend-port' && next) {
      options.frontendPort = Number(next)
      i += 1
      continue
    }

    if (arg === '--opencode-url' && next) {
      options.opencodeUrl = next
      i += 1
      continue
    }

    if (arg === '--timeout-ms' && next) {
      options.timeoutMs = Number(next)
      i += 1
    }
  }

  return options
}

function printHelp() {
  console.log(`LoopTroop runtime stall diagnostics

Usage:
  npm run diagnose:stall

Optional flags:
  --backend-port <port>
  --frontend-port <port>
  --opencode-url <url>
  --timeout-ms <ms>

What it checks:
  - Frontend, backend, and OpenCode endpoint responsiveness
  - Relevant running processes and backend listener details
  - Backend thread wait states when available
  - System load, memory, and Linux pressure stall metrics
  - Mount type, disk space, and inode usage for app/project paths
  - Per-process I/O counters from /proc/<pid>/io
  - App DB attached projects
  - Project DB ticket/session state
  - Git responsiveness for attached projects
  - A short backend correlation sampler across repeated probes
  - Git Trace2 perf output for repo status calls
  - Direct filesystem latency probes for project metadata paths
  - Ticket meta files that could trigger extra base-branch detection
  - Heuristic summary of the most likely cause
`)
}

function runShell(command: string, timeoutMs = 5000): CommandResult {
  const start = Date.now()
  const result = spawnSync('bash', ['-lc', command], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: timeoutMs,
  })

  const durationMs = Date.now() - start
  const error = result.error
  const timedOut = error?.name === 'TimeoutError'

  return {
    command,
    durationMs,
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    timedOut,
    ...(error ? { error: error.message } : {}),
  }
}

function printCommandResult(title: string, result: CommandResult) {
  heading(title)
  kv('Command', result.command)
  kv('Duration', formatDuration(result.durationMs))
  kv('Exit code', result.exitCode)
  kv('Signal', result.signal)
  kv('Timed out', result.timedOut)
  if (result.error) kv('Error', result.error)

  print('-- stdout --')
  print(result.stdout.trim() || '(empty)')
  print('-- stderr --')
  print(result.stderr.trim() || '(empty)')
}

function parseEnvFile(raw: Buffer | string): Record<string, string> {
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw
  const entries = text.split('\0').filter(Boolean)
  const env: Record<string, string> = {}

  for (const entry of entries) {
    const separator = entry.indexOf('=')
    if (separator <= 0) continue
    env[entry.slice(0, separator)] = entry.slice(separator + 1)
  }

  return env
}

function readProcessEnv(pid: number): Record<string, string> {
  try {
    return parseEnvFile(readFileSync(`/proc/${pid}/environ`))
  } catch {
    return {}
  }
}

function readProcessCwd(pid: number): string | null {
  try {
    return realpathSync(`/proc/${pid}/cwd`)
  } catch {
    return null
  }
}

function commandExists(binary: string): boolean {
  const cached = commandAvailability.get(binary)
  if (cached !== undefined) return cached
  const result = runShell(`command -v ${binary}`, 2000)
  const exists = result.exitCode === 0 && result.stdout.trim().length > 0
  commandAvailability.set(binary, exists)
  return exists
}

function findListeningPid(port: number): number | null {
  const lsofResult = runShell(`lsof -tiTCP:${port} -sTCP:LISTEN | head -n 1`, 3000)
  const lsofPid = Number(lsofResult.stdout.trim())
  if (Number.isInteger(lsofPid) && lsofPid > 0) return lsofPid

  const ssResult = runShell(`ss -ltnp '( sport = :${port} )'`, 3000)
  const match = ssResult.stdout.match(/pid=(\d+)/)
  if (match?.[1]) {
    const pid = Number(match[1])
    if (Number.isInteger(pid) && pid > 0) return pid
  }

  return null
}

async function probeHttp(label: string, url: string, timeoutMs: number): Promise<HttpProbeResult> {
  const start = Date.now()
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    const body = await response.text()
    return {
      label,
      url,
      durationMs: Date.now() - start,
      ok: response.ok,
      status: response.status,
      bodyPreview: formatBodyPreview(body),
    }
  } catch (error) {
    return {
      label,
      url,
      durationMs: Date.now() - start,
      ok: false,
      status: null,
      bodyPreview: '(no response body)',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function parsePercent(raw: string | undefined): number | null {
  if (!raw) return null
  const parsed = Number(raw.replace('%', ''))
  return Number.isFinite(parsed) ? parsed : null
}

function parseInteger(raw: string | undefined): number | null {
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function inspectMount(path: string): MountSnapshot {
  if (!existsSync(path)) {
    return {
      path,
      target: null,
      source: null,
      fstype: null,
      options: null,
      error: 'Path does not exist',
    }
  }

  if (!commandExists('findmnt')) {
    return {
      path,
      target: null,
      source: null,
      fstype: null,
      options: null,
      error: '`findmnt` is not available on this system',
    }
  }

  const result = runShell(`findmnt -rn -T ${shellQuote(path)} -o TARGET,SOURCE,FSTYPE,OPTIONS`, 3000)
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    return {
      path,
      target: null,
      source: null,
      fstype: null,
      options: null,
      error: result.stderr.trim() || result.error || 'Unable to resolve mount information',
    }
  }

  const line = result.stdout.trim().split('\n')[0]?.trim() ?? ''
  const parts = line.split(/\s+/)
  return {
    path,
    target: parts[0] ?? null,
    source: parts[1] ?? null,
    fstype: parts[2] ?? null,
    options: parts.slice(3).join(' ') || null,
  }
}

function inspectDiskUsage(path: string): DiskUsageSnapshot {
  if (!existsSync(path)) {
    return {
      path,
      filesystem: null,
      totalKb: null,
      usedKb: null,
      availableKb: null,
      usePercent: null,
      mountedOn: null,
      error: 'Path does not exist',
    }
  }

  const result = runShell(`df -Pk ${shellQuote(path)} | tail -n 1`, 3000)
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    return {
      path,
      filesystem: null,
      totalKb: null,
      usedKb: null,
      availableKb: null,
      usePercent: null,
      mountedOn: null,
      error: result.stderr.trim() || result.error || 'Unable to read df output',
    }
  }

  const parts = result.stdout.trim().split(/\s+/)
  return {
    path,
    filesystem: parts[0] ?? null,
    totalKb: parseInteger(parts[1]),
    usedKb: parseInteger(parts[2]),
    availableKb: parseInteger(parts[3]),
    usePercent: parsePercent(parts[4]),
    mountedOn: parts[5] ?? null,
  }
}

function inspectInodeUsage(path: string): InodeUsageSnapshot {
  if (!existsSync(path)) {
    return {
      path,
      filesystem: null,
      totalInodes: null,
      usedInodes: null,
      freeInodes: null,
      usePercent: null,
      mountedOn: null,
      error: 'Path does not exist',
    }
  }

  const result = runShell(`df -Pi ${shellQuote(path)} | tail -n 1`, 3000)
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    return {
      path,
      filesystem: null,
      totalInodes: null,
      usedInodes: null,
      freeInodes: null,
      usePercent: null,
      mountedOn: null,
      error: result.stderr.trim() || result.error || 'Unable to read inode df output',
    }
  }

  const parts = result.stdout.trim().split(/\s+/)
  const totalInodes = parseInteger(parts[1])
  const usedInodes = parseInteger(parts[2])
  const freeInodes = parseInteger(parts[3])
  const usePercent = parsePercent(parts[4])
  return {
    path,
    filesystem: parts[0] ?? null,
    totalInodes: totalInodes !== null && totalInodes >= 0 ? totalInodes : null,
    usedInodes: usedInodes !== null && usedInodes >= 0 ? usedInodes : null,
    freeInodes: freeInodes !== null && freeInodes >= 0 ? freeInodes : null,
    usePercent,
    mountedOn: parts[5] ?? null,
  }
}

function measureFsLatency(label: string, action: () => string): FsLatencyProbe {
  const startedAt = Date.now()
  try {
    const details = action()
    return {
      label,
      durationMs: Date.now() - startedAt,
      ok: true,
      details,
    }
  } catch (error) {
    return {
      label,
      durationMs: Date.now() - startedAt,
      ok: false,
      details: '(operation failed)',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function inspectPressureFile(path: string): PressureSnapshot {
  if (!existsSync(path)) {
    return {
      path,
      some: null,
      full: null,
      error: 'Pressure file not available on this system',
    }
  }

  try {
    const raw = readFileSync(path, 'utf8').trim()
    const parseLine = (prefix: 'some' | 'full'): PressureMetrics | null => {
      const line = raw.split('\n').find((entry) => entry.startsWith(`${prefix} `))
      if (!line) return null
      const metrics = Object.fromEntries(
        line
          .split(/\s+/)
          .slice(1)
          .map((entry) => entry.split('=').slice(0, 2) as [string, string]),
      )

      return {
        avg10: parseInteger(metrics.avg10),
        avg60: parseInteger(metrics.avg60),
        avg300: parseInteger(metrics.avg300),
        total: parseInteger(metrics.total),
        raw: line,
      }
    }

    return {
      path,
      some: parseLine('some'),
      full: parseLine('full'),
    }
  } catch (error) {
    return {
      path,
      some: null,
      full: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function readProcessIo(pid: number): ProcessIoSnapshot {
  const path = `/proc/${pid}/io`
  try {
    const raw = readFileSync(path, 'utf8').trim()
    const values = Object.fromEntries(
      raw
        .split('\n')
        .map((line) => line.split(':').map((part) => part.trim()))
        .filter((parts): parts is [string, string] => parts.length === 2)
        .map(([key, value]) => [key, Number(value)]),
    )

    return { pid, values, raw }
  } catch (error) {
    return {
      pid,
      values: {},
      raw: '',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function parseLocalPortFromUrl(rawUrl: string): number | null {
  try {
    const url = new URL(rawUrl)
    if (!['127.0.0.1', 'localhost', '0.0.0.0', '::1'].includes(url.hostname)) return null
    const defaultPort = url.protocol === 'https:' ? 443 : 80
    return Number(url.port || defaultPort)
  } catch {
    return null
  }
}

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

async function sampleRuntimeCorrelation(options: {
  backendPid: number | null
  backendHealthUrl: string
  ticketsUrl: string
  iterations?: number
  intervalMs?: number
  probeTimeoutMs?: number
}): Promise<CorrelationSample[]> {
  const samples: CorrelationSample[] = []
  const iterations = options.iterations ?? 5
  const intervalMs = options.intervalMs ?? 700
  const probeTimeoutMs = options.probeTimeoutMs ?? 900

  for (let index = 0; index < iterations; index += 1) {
    const [healthProbe, ticketsProbe] = await Promise.all([
      probeHttp(`correlation health ${index + 1}`, options.backendHealthUrl, probeTimeoutMs),
      probeHttp(`correlation tickets ${index + 1}`, options.ticketsUrl, probeTimeoutMs),
    ])

    let processStat: string | null = null
    let processWchan: string | null = null

    if (options.backendPid) {
      const processSnapshot = runShell(
        `ps -p ${options.backendPid} -o stat=,wchan=`,
        Math.max(1500, probeTimeoutMs),
      )

      const raw = processSnapshot.stdout.trim()
      if (raw) {
        const parts = raw.split(/\s+/)
        processStat = parts[0] ?? null
        processWchan = parts.slice(1).join(' ') || null
      }
    }

    samples.push({
      at: new Date().toISOString(),
      healthOk: healthProbe.ok,
      healthStatus: healthProbe.status,
      healthDurationMs: healthProbe.durationMs,
      ...(healthProbe.error ? { healthError: healthProbe.error } : {}),
      ticketsOk: ticketsProbe.ok,
      ticketsStatus: ticketsProbe.status,
      ticketsDurationMs: ticketsProbe.durationMs,
      ...(ticketsProbe.error ? { ticketsError: ticketsProbe.error } : {}),
      processStat,
      processWchan,
    })

    if (index < iterations - 1) {
      await sleep(intervalMs)
    }
  }

  return samples
}

function resolveAppConfigDir(env: Record<string, string>): string {
  const configured = env.LOOPTROOP_CONFIG_DIR?.trim()
  if (configured) {
    return isAbsolute(configured) ? configured : resolve(process.cwd(), configured)
  }

  const xdgConfigHome = env.XDG_CONFIG_HOME?.trim()
  const baseDir = xdgConfigHome
    ? (isAbsolute(xdgConfigHome) ? xdgConfigHome : resolve(process.cwd(), xdgConfigHome))
    : resolve(env.HOME?.trim() || homedir(), '.config')

  return resolve(baseDir, 'looptroop')
}

function resolveAppDbPath(env: Record<string, string>): string {
  const configured = env.LOOPTROOP_APP_DB_PATH?.trim()
  if (configured) {
    return isAbsolute(configured) ? configured : resolve(process.cwd(), configured)
  }

  return resolve(resolveAppConfigDir(env), 'app.sqlite')
}

function openReadonlyDatabase(path: string): Database.Database {
  return new Database(path, {
    readonly: true,
    fileMustExist: true,
  })
}

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
  ).get(tableName) as { name?: string } | undefined

  return row?.name === tableName
}

function inspectAppDatabase(appDbPath: string): {
  exists: boolean
  attachedProjects: AttachedProjectRow[]
  openMs: number
  queryMs: number
  error?: string
} {
  if (!existsSync(appDbPath)) {
    return { exists: false, attachedProjects: [], openMs: 0, queryMs: 0 }
  }

  let db: Database.Database | null = null
  const openStartedAt = Date.now()

  try {
    db = openReadonlyDatabase(appDbPath)
    const openMs = Date.now() - openStartedAt
    const queryStartedAt = Date.now()
    const attachedProjects = tableExists(db, 'attached_projects')
      ? db.prepare(
        `SELECT id, folder_path AS folderPath, created_at AS createdAt, updated_at AS updatedAt
         FROM attached_projects
         ORDER BY id`,
      ).all() as AttachedProjectRow[]
      : []
    const queryMs = Date.now() - queryStartedAt
    return { exists: true, attachedProjects, openMs, queryMs }
  } catch (error) {
    return {
      exists: true,
      attachedProjects: [],
      openMs: Date.now() - openStartedAt,
      queryMs: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    db?.close()
  }
}

function inspectTicketMetaFiles(projectRoot: string, ticketRefs: string[]): {
  checked: number
  missingMetaFiles: number
  metaWithoutBaseBranch: number
  warnings: string[]
} {
  const warnings: string[] = []
  let checked = 0
  let missingMetaFiles = 0
  let metaWithoutBaseBranch = 0

  for (const externalId of ticketRefs) {
    checked += 1
    const metaPath = resolve(projectRoot, '.looptroop', 'worktrees', externalId, '.ticket', 'meta', 'ticket.meta.json')
    if (!existsSync(metaPath)) {
      missingMetaFiles += 1
      if (warnings.length < 8) warnings.push(`${externalId}: missing ${metaPath}`)
      continue
    }

    try {
      const parsed = JSON.parse(readFileSync(metaPath, 'utf8')) as { baseBranch?: unknown }
      if (typeof parsed.baseBranch !== 'string' || parsed.baseBranch.trim().length === 0) {
        metaWithoutBaseBranch += 1
        if (warnings.length < 8) warnings.push(`${externalId}: meta present but baseBranch missing or empty`)
      }
    } catch (error) {
      metaWithoutBaseBranch += 1
      if (warnings.length < 8) {
        const message = error instanceof Error ? error.message : String(error)
        warnings.push(`${externalId}: failed to parse meta file (${message})`)
      }
    }
  }

  return { checked, missingMetaFiles, metaWithoutBaseBranch, warnings }
}

function inspectProjectDatabase(project: AttachedProjectRow): ProjectSnapshot {
  const projectDbPath = resolve(project.folderPath, '.looptroop', 'db.sqlite')
  const exists = existsSync(project.folderPath)
  const projectDbExists = existsSync(projectDbPath)
  const pathWarnings: string[] = []
  const mount = inspectMount(project.folderPath)
  const diskUsage = inspectDiskUsage(project.folderPath)
  const inodeUsage = inspectInodeUsage(project.folderPath)
  const latencyProbes: FsLatencyProbe[] = []

  if (project.folderPath.startsWith('/mnt/')) {
    pathWarnings.push('Project is on a mounted Windows drive under /mnt/. WSL file I/O stalls can block Node here.')
  }
  if (mount.fstype === '9p') {
    pathWarnings.push('Mount type is 9p, which is the common WSL path for mounted Windows drives and can stall on metadata-heavy access.')
    if (inodeUsage.usePercent === null) {
      pathWarnings.push('Inode counts on this 9p mount appear synthetic or unavailable, so inode usage is not a reliable signal here.')
    }
  }
  if (!exists) {
    pathWarnings.push('Project root path does not exist right now.')
  }
  if (!projectDbExists) {
    pathWarnings.push('Project DB file does not exist at .looptroop/db.sqlite.')
  }

  if (!projectDbExists) {
    return {
      id: project.id,
      folderPath: project.folderPath,
      exists,
      projectDbPath,
      projectDbExists,
      projectName: null,
      shortname: null,
      ticketCounter: null,
      ticketCount: 0,
      activeSessionCount: 0,
      recentTickets: [],
      activeSessions: [],
      statusCounts: [],
      metaFilesChecked: 0,
      missingMetaFiles: 0,
      metaWithoutBaseBranch: 0,
      metaWarnings: [],
      pathWarnings,
      dbOpenMs: 0,
      dbQueryMs: 0,
      mount,
      diskUsage,
      inodeUsage,
      latencyProbes,
    }
  }

  let db: Database.Database | null = null
  const dbOpenStartedAt = Date.now()

  try {
    db = openReadonlyDatabase(projectDbPath)
    const dbOpenMs = Date.now() - dbOpenStartedAt
    const queryStartedAt = Date.now()

    const projectRow = tableExists(db, 'projects')
      ? db.prepare(
        `SELECT name, shortname, ticket_counter AS ticketCounter FROM projects LIMIT 1`,
      ).get() as { name?: string | null; shortname?: string | null; ticketCounter?: number | null } | undefined
      : undefined

    const ticketCount = tableExists(db, 'tickets')
      ? (db.prepare(`SELECT COUNT(*) AS count FROM tickets`).get() as { count: number }).count
      : 0

    const recentTickets = tableExists(db, 'tickets')
      ? db.prepare(
        `SELECT external_id, status, updated_at
         FROM tickets
         ORDER BY updated_at DESC
         LIMIT 8`,
      ).all() as TicketRow[]
      : []

    const statusCounts = tableExists(db, 'tickets')
      ? db.prepare(
        `SELECT status, COUNT(*) AS count
         FROM tickets
         GROUP BY status
         ORDER BY count DESC, status ASC`,
      ).all() as Array<{ status: string; count: number }>
      : []

    const activeSessions = tableExists(db, 'opencode_sessions')
      ? db.prepare(
        `SELECT session_id, ticket_id, phase, member_id, step, updated_at
         FROM opencode_sessions
         WHERE state = 'active'
         ORDER BY updated_at DESC
         LIMIT 8`,
      ).all() as ActiveSessionRow[]
      : []

    const ticketRefs = tableExists(db, 'tickets')
      ? db.prepare(`SELECT external_id FROM tickets ORDER BY updated_at DESC`).all() as Array<{ external_id: string }>
      : []

    const metaInspection = inspectTicketMetaFiles(
      project.folderPath,
      ticketRefs.map((ticket) => ticket.external_id),
    )

    const latestExternalId = recentTickets[0]?.external_id ?? ticketRefs[0]?.external_id ?? null
    const gitHeadPath = resolve(project.folderPath, '.git', 'HEAD')
    const worktreesPath = resolve(project.folderPath, '.looptroop', 'worktrees')
    const latestMetaPath = latestExternalId
      ? resolve(project.folderPath, '.looptroop', 'worktrees', latestExternalId, '.ticket', 'meta', 'ticket.meta.json')
      : null

    latencyProbes.push(
      measureFsLatency('stat project root', () => {
        const stats = statSync(project.folderPath)
        return `mode=${stats.mode} size=${stats.size} mtime=${stats.mtime.toISOString()}`
      }),
    )

    latencyProbes.push(
      measureFsLatency('stat project db', () => {
        const stats = statSync(projectDbPath)
        return `size=${stats.size} mtime=${stats.mtime.toISOString()}`
      }),
    )

    latencyProbes.push(
      measureFsLatency('read .git/HEAD', () => formatBodyPreview(readFileSync(gitHeadPath, 'utf8'), 120)),
    )

    latencyProbes.push(
      measureFsLatency('list .looptroop/worktrees', () => {
        const entries = readdirSync(worktreesPath)
        return `entries=${entries.length} sample=${entries.slice(0, 5).join(', ') || '(none)'}`
      }),
    )

    if (latestMetaPath) {
      latencyProbes.push(
        measureFsLatency(`read latest ticket meta (${latestExternalId})`, () => {
          return formatBodyPreview(readFileSync(latestMetaPath, 'utf8'), 200)
        }),
      )
    }

    const dbQueryMs = Date.now() - queryStartedAt

    return {
      id: project.id,
      folderPath: project.folderPath,
      exists,
      projectDbPath,
      projectDbExists,
      projectName: projectRow?.name ?? null,
      shortname: projectRow?.shortname ?? null,
      ticketCounter: projectRow?.ticketCounter ?? null,
      ticketCount,
      activeSessionCount: activeSessions.length,
      recentTickets,
      activeSessions,
      statusCounts,
      metaFilesChecked: metaInspection.checked,
      missingMetaFiles: metaInspection.missingMetaFiles,
      metaWithoutBaseBranch: metaInspection.metaWithoutBaseBranch,
      metaWarnings: metaInspection.warnings,
      pathWarnings,
      dbOpenMs,
      dbQueryMs,
      mount,
      diskUsage,
      inodeUsage,
      latencyProbes,
    }
  } finally {
    db?.close()
  }
}

function printFileStats(title: string, filePath: string) {
  heading(title)
  kv('Path', filePath)
  kv('Exists', existsSync(filePath))
  if (!existsSync(filePath)) return

  try {
    const stats = statSync(filePath)
    kv('Size bytes', stats.size)
    kv('Modified at', stats.mtime.toISOString())
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    kv('Stat error', message)
  }
}

function printHttpProbe(result: HttpProbeResult) {
  heading(`HTTP Probe: ${result.label}`)
  kv('URL', result.url)
  kv('Duration', formatDuration(result.durationMs))
  kv('Success', result.ok)
  kv('Status', result.status)
  if (result.error) kv('Error', result.error)
  kv('Body preview', result.bodyPreview)
}

function printMountSnapshot(title: string, snapshot: MountSnapshot) {
  heading(title)
  kv('Path', snapshot.path)
  kv('Target', snapshot.target)
  kv('Source', snapshot.source)
  kv('Filesystem type', snapshot.fstype)
  kv('Options', snapshot.options)
  if (snapshot.error) kv('Error', snapshot.error)
}

function printDiskUsageSnapshot(title: string, snapshot: DiskUsageSnapshot) {
  heading(title)
  kv('Path', snapshot.path)
  kv('Filesystem', snapshot.filesystem)
  kv('Total KB', snapshot.totalKb)
  kv('Used KB', snapshot.usedKb)
  kv('Available KB', snapshot.availableKb)
  kv('Use %', snapshot.usePercent)
  kv('Mounted on', snapshot.mountedOn)
  if (snapshot.error) kv('Error', snapshot.error)
}

function printInodeUsageSnapshot(title: string, snapshot: InodeUsageSnapshot) {
  heading(title)
  kv('Path', snapshot.path)
  kv('Filesystem', snapshot.filesystem)
  kv('Total inodes', snapshot.totalInodes)
  kv('Used inodes', snapshot.usedInodes)
  kv('Free inodes', snapshot.freeInodes)
  kv('Use %', snapshot.usePercent)
  kv('Mounted on', snapshot.mountedOn)
  if (snapshot.error) kv('Error', snapshot.error)
}

function printLatencyProbes(title: string, probes: FsLatencyProbe[]) {
  heading(title)
  if (probes.length === 0) {
    print('(none)')
    return
  }

  for (const probe of probes) {
    print(`- ${probe.label}: ok=${probe.ok} duration=${formatDuration(probe.durationMs)} details=${probe.details}`)
    if (probe.error) {
      print(`  error=${probe.error}`)
    }
  }
}

function printPressureSnapshot(title: string, snapshot: PressureSnapshot) {
  heading(title)
  kv('Path', snapshot.path)
  if (snapshot.error) {
    kv('Error', snapshot.error)
    return
  }

  if (!snapshot.some && !snapshot.full) {
    print('(no pressure metrics reported)')
    return
  }

  if (snapshot.some) {
    kv('some.avg10', snapshot.some.avg10)
    kv('some.avg60', snapshot.some.avg60)
    kv('some.avg300', snapshot.some.avg300)
    kv('some.total', snapshot.some.total)
    kv('some.raw', snapshot.some.raw)
  }

  if (snapshot.full) {
    kv('full.avg10', snapshot.full.avg10)
    kv('full.avg60', snapshot.full.avg60)
    kv('full.avg300', snapshot.full.avg300)
    kv('full.total', snapshot.full.total)
    kv('full.raw', snapshot.full.raw)
  }
}

function printProcessIoSnapshot(title: string, snapshot: ProcessIoSnapshot) {
  heading(title)
  kv('PID', snapshot.pid)
  if (snapshot.error) {
    kv('Error', snapshot.error)
    return
  }

  for (const key of ['rchar', 'wchar', 'syscr', 'syscw', 'read_bytes', 'write_bytes', 'cancelled_write_bytes']) {
    kv(key, snapshot.values[key] ?? 'n/a')
  }
}

function printCorrelationSamples(title: string, samples: CorrelationSample[]) {
  heading(title)
  if (samples.length === 0) {
    print('(none)')
    return
  }

  for (const sample of samples) {
    print(
      `- at=${sample.at}` +
      ` health_ok=${sample.healthOk}` +
      ` health_status=${sample.healthStatus ?? 'n/a'}` +
      ` health_ms=${sample.healthDurationMs}` +
      ` tickets_ok=${sample.ticketsOk}` +
      ` tickets_status=${sample.ticketsStatus ?? 'n/a'}` +
      ` tickets_ms=${sample.ticketsDurationMs}` +
      ` stat=${sample.processStat ?? 'n/a'}` +
      ` wchan=${sample.processWchan ?? 'n/a'}` +
      ` health_error=${sample.healthError ?? 'n/a'}` +
      ` tickets_error=${sample.ticketsError ?? 'n/a'}`,
    )
  }
}

function printProjectSnapshot(project: ProjectSnapshot) {
  heading(`Attached Project ${project.id}`)
  kv('Folder', project.folderPath)
  kv('Path exists', project.exists)
  kv('Project DB', project.projectDbPath)
  kv('Project DB exists', project.projectDbExists)
  kv('Project name', project.projectName)
  kv('Project shortname', project.shortname)
  kv('Ticket counter', project.ticketCounter)
  kv('Ticket count', project.ticketCount)
  kv('Active session count', project.activeSessionCount)
  kv('DB open time', formatDuration(project.dbOpenMs))
  kv('DB query time', formatDuration(project.dbQueryMs))
  kv('Meta files checked', project.metaFilesChecked)
  kv('Missing meta files', project.missingMetaFiles)
  kv('Meta without baseBranch', project.metaWithoutBaseBranch)
  kv('Mount type', project.mount.fstype)
  kv('Mount source', project.mount.source)
  kv('Disk use %', project.diskUsage.usePercent)
  kv('Inode use %', project.inodeUsage.usePercent)

  print('Warnings:')
  if (project.pathWarnings.length === 0 && project.metaWarnings.length === 0) {
    print('(none)')
  } else {
    for (const warning of [...project.pathWarnings, ...project.metaWarnings]) {
      print(`- ${warning}`)
    }
  }

  print('Recent tickets:')
  if (project.recentTickets.length === 0) {
    print('(none)')
  } else {
    for (const ticket of project.recentTickets) {
      print(`- ${ticket.external_id} | ${ticket.status} | updated_at=${ticket.updated_at}`)
    }
  }

  print('Status counts:')
  if (project.statusCounts.length === 0) {
    print('(none)')
  } else {
    for (const status of project.statusCounts) {
      print(`- ${status.status}: ${status.count}`)
    }
  }

  print('Active OpenCode sessions:')
  if (project.activeSessions.length === 0) {
    print('(none)')
  } else {
    for (const session of project.activeSessions) {
      print(
        `- session=${session.session_id} ticket_id=${session.ticket_id ?? 'n/a'} phase=${session.phase}` +
        ` member=${session.member_id ?? 'n/a'} step=${session.step ?? 'n/a'} updated_at=${session.updated_at}`,
      )
    }
  }
}

function buildHeuristics(input: {
  backendPid: number | null
  backendThreadDump: string
  frontendProbe: HttpProbeResult
  healthProbe: HttpProbeResult
  ticketsProbe: HttpProbeResult
  opencodeProbe: HttpProbeResult
  attachedProjects: AttachedProjectRow[]
  projectSnapshots: ProjectSnapshot[]
  ioPressure: PressureSnapshot
  backendIo: ProcessIoSnapshot | null
  correlationSamples: CorrelationSample[]
}): string[] {
  const messages: string[] = []
  const totalTickets = input.projectSnapshots.reduce((sum, project) => sum + project.ticketCount, 0)
  const totalActiveSessions = input.projectSnapshots.reduce((sum, project) => sum + project.activeSessionCount, 0)
  const onMountedDrive = input.projectSnapshots.some((project) => project.folderPath.startsWith('/mnt/'))
  const mountedVia9p = input.projectSnapshots.some((project) => project.mount.fstype === '9p')
  const hasP9Wait = input.backendThreadDump.includes('p9_client_rpc')
  const backendTimedOut = Boolean(input.healthProbe.error?.includes('timed out'))
  const ticketsTimedOut = Boolean(input.ticketsProbe.error?.includes('timed out'))
  const opencodeTimedOut = Boolean(input.opencodeProbe.error?.includes('timed out'))
  const hasTicketDataOnDisk = totalTickets > 0
  const directDbReadable = input.projectSnapshots.some((project) => project.projectDbExists && project.dbQueryMs > 0)
  const someProjectDbWasSlow = input.projectSnapshots.some((project) => project.dbQueryMs >= 500)
  const slowFsProbe = input.projectSnapshots.some((project) => project.latencyProbes.some((probe) => probe.durationMs >= 750))
  const lowDiskProjects = input.projectSnapshots.filter((project) => (project.diskUsage.usePercent ?? 0) >= 95)
  const lowInodeProjects = input.projectSnapshots.filter((project) => (project.inodeUsage.usePercent ?? 0) >= 95)
  const missingBaseBranch = input.projectSnapshots.reduce((sum, project) => sum + project.metaWithoutBaseBranch, 0)
  const ioPressureSome = input.ioPressure.some?.avg10 ?? 0
  const ioPressureFull = input.ioPressure.full?.avg10 ?? 0
  const correlatedP9Timeouts = input.correlationSamples.filter((sample) =>
    (!sample.healthOk || !sample.ticketsOk)
    && (sample.processWchan?.includes('p9_client_rpc') ?? false),
  ).length
  const allCorrelatedSamples = input.correlationSamples.length > 0
    && correlatedP9Timeouts === input.correlationSamples.length

  if (input.backendPid === null) {
    messages.push('No backend listener was found on the configured backend port. If the UI is empty in this case, the backend may simply be down.')
  }

  if (input.attachedProjects.length === 0) {
    messages.push('No attached projects were found in the app DB. In that state, the UI would legitimately show no tickets.')
  }

  if (input.backendPid !== null && backendTimedOut && hasTicketDataOnDisk) {
    messages.push('The backend process was alive, but even /api/health timed out while project DBs still contained tickets. That strongly suggests a backend stall rather than ticket loss.')
  }

  if (input.backendPid !== null && ticketsTimedOut && hasTicketDataOnDisk) {
    messages.push('The UI would likely appear empty on refresh in this state, because /api/tickets could not answer even though tickets still existed on disk.')
  }

  if (onMountedDrive) {
    messages.push('At least one attached project lives under /mnt/. Even when the app is healthy, that keeps WSL mounted-drive latency in play as a recurring risk factor for future stalls.')
  }

  if (mountedVia9p) {
    messages.push('At least one attached project is mounted through a 9p filesystem. That is the typical WSL bridge for Windows drives and is a frequent cause of metadata-heavy stalls.')
  }

  if (hasP9Wait && onMountedDrive) {
    messages.push('The backend thread list included p9_client_rpc while at least one attached project lives under /mnt/. That is a strong signal of WSL mounted-drive I/O blocking the Node process.')
  }

  if (allCorrelatedSamples) {
    messages.push('Every correlation sample that checked the backend during this snapshot saw API failure together with p9_client_rpc. That is very strong evidence that the outage is directly tied to the mounted-drive path layer.')
  } else if (correlatedP9Timeouts > 0) {
    messages.push(`Some correlation samples (${correlatedP9Timeouts}/${input.correlationSamples.length}) saw API failure at the same time as p9_client_rpc. That materially increases confidence that the mounted-drive layer is the blocker, not a random unrelated slowdown.`)
  }

  if (totalActiveSessions > 0) {
    messages.push(`There were ${totalActiveSessions} active OpenCode session(s). Heavy active workflow phases can increase the chance of a temporary stall becoming user-visible.`)
  }

  if (!backendTimedOut && opencodeTimedOut) {
    messages.push('The backend answered, but /api/health/opencode timed out. OpenCode itself may have been slow or unreachable even if the backend was otherwise up.')
  }

  if (!backendTimedOut && input.frontendProbe.error?.includes('timed out')) {
    messages.push('The frontend probe timed out while the backend answered. That points to a slower dev UI at that moment, but it would not by itself explain tickets disappearing after refresh.')
  }

  if (directDbReadable && input.backendPid !== null && backendTimedOut) {
    messages.push('A fresh process could still read the project DB directly while the backend timed out. That points away from permanent SQLite corruption and toward the backend event loop or mounted-drive I/O being blocked.')
  }

  if (someProjectDbWasSlow) {
    messages.push('Direct project DB inspection was slower than usual. If this correlates with a stall, it is another hint that filesystem or mounted-drive latency is part of the problem.')
  }

  if (slowFsProbe) {
    messages.push('At least one direct filesystem probe on the project path was slow. That supports the theory that path-level file access latency, not just HTTP or SQLite, contributed to the stall.')
  }

  if (ioPressureSome >= 0.5 || ioPressureFull >= 0.1) {
    messages.push(`System I/O pressure was elevated (io.some.avg10=${ioPressureSome}, io.full.avg10=${ioPressureFull}). That means the whole environment was experiencing measurable I/O stall pressure during the snapshot.`)
  }

  if (lowDiskProjects.length > 0) {
    messages.push(`One or more project filesystems were almost full (${lowDiskProjects.map((project) => `${project.folderPath}=${project.diskUsage.usePercent}%`).join(', ')}). Low free space can amplify SQLite and WAL latency.`)
  }

  if (lowInodeProjects.length > 0) {
    messages.push(`One or more project filesystems were nearly out of inodes (${lowInodeProjects.map((project) => `${project.folderPath}=${project.inodeUsage.usePercent}%`).join(', ')}). Inode pressure can also create pathological slowdowns.`)
  }

  if (input.backendIo && !input.backendIo.error) {
    const writeBytes = input.backendIo.values.write_bytes ?? 0
    const readBytes = input.backendIo.values.read_bytes ?? 0
    if (writeBytes > 50_000_000 || readBytes > 50_000_000) {
      messages.push(`The backend process had already accumulated substantial direct disk I/O (read_bytes=${readBytes}, write_bytes=${writeBytes}). This does not prove a stall by itself, but it shows the backend is doing non-trivial storage work.`)
    }
  }

  if (missingBaseBranch > 0) {
    messages.push(`${missingBaseBranch} ticket meta file(s) were missing baseBranch data. When that happens, LoopTroop may do extra git base-branch detection work during ticket reads.`)
  }

  if (messages.length === 0) {
    messages.push('No single smoking gun was found. The report still captures process, DB, and network state so you can compare it against a healthy run.')
  }

  return messages
}

async function main() {
  heading('LoopTroop Runtime Stall Diagnostics')
  kv('Started at', startedAt.toISOString())
  kv('Working directory', process.cwd())
  kv('Node version', process.version)
  kv('Platform', `${process.platform} ${process.arch}`)
  kv('WSL distro', process.env.WSL_DISTRO_NAME ?? 'n/a')
  kv('CLI options', cli)

  const defaultEnv: Record<string, string> = {
    HOME: process.env.HOME ?? homedir(),
    ...(process.env.XDG_CONFIG_HOME ? { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME } : {}),
    ...(process.env.LOOPTROOP_CONFIG_DIR ? { LOOPTROOP_CONFIG_DIR: process.env.LOOPTROOP_CONFIG_DIR } : {}),
    ...(process.env.LOOPTROOP_APP_DB_PATH ? { LOOPTROOP_APP_DB_PATH: process.env.LOOPTROOP_APP_DB_PATH } : {}),
  }

  const backendPort = cli.backendPort
    ?? Number(process.env.LOOPTROOP_BACKEND_PORT || 3000)

  const backendPid = findListeningPid(backendPort)
  const backendEnv = backendPid ? readProcessEnv(backendPid) : {}
  const effectiveEnv = { ...defaultEnv, ...backendEnv }
  const effectiveBackendPort = cli.backendPort
    ?? Number(backendEnv.LOOPTROOP_BACKEND_PORT || process.env.LOOPTROOP_BACKEND_PORT || 3000)
  const effectiveFrontendPort = cli.frontendPort
    ?? Number(backendEnv.LOOPTROOP_FRONTEND_PORT || process.env.LOOPTROOP_FRONTEND_PORT || 5173)
  const effectiveOpenCodeUrl = cli.opencodeUrl
    ?? backendEnv.LOOPTROOP_OPENCODE_BASE_URL
    ?? process.env.LOOPTROOP_OPENCODE_BASE_URL
    ?? 'http://127.0.0.1:4096'
  const timeoutMs = Number.isFinite(cli.timeoutMs) && (cli.timeoutMs ?? 0) > 0 ? cli.timeoutMs! : 4000
  const appDbPath = resolveAppDbPath(effectiveEnv)
  const frontendPid = findListeningPid(effectiveFrontendPort)
  const opencodePort = parseLocalPortFromUrl(effectiveOpenCodeUrl)
  const opencodePid = opencodePort ? findListeningPid(opencodePort) : null
  const appDbMount = inspectMount(appDbPath)
  const appDbDiskUsage = inspectDiskUsage(appDbPath)
  const appDbInodeUsage = inspectInodeUsage(appDbPath)
  const appDbLatency = [
    measureFsLatency('stat app db', () => {
      const stats = statSync(appDbPath)
      return `size=${stats.size} mtime=${stats.mtime.toISOString()}`
    }),
    measureFsLatency('read app db header', () => {
      const buffer = readFileSync(appDbPath)
      return `header=${buffer.subarray(0, 16).toString('utf8').replace(/\0/g, '\\0')}`
    }),
  ]
  const ioPressure = inspectPressureFile('/proc/pressure/io')
  const memoryPressure = inspectPressureFile('/proc/pressure/memory')
  const cpuPressure = inspectPressureFile('/proc/pressure/cpu')

  heading('Resolved Runtime Configuration')
  kv('Backend port', effectiveBackendPort)
  kv('Frontend port', effectiveFrontendPort)
  kv('OpenCode URL', effectiveOpenCodeUrl)
  kv('HTTP probe timeout', timeoutMs)
  kv('Detected backend PID', backendPid)
  kv('Detected frontend PID', frontendPid)
  kv('Detected OpenCode PID', opencodePid)
  kv('Detected backend cwd', backendPid ? readProcessCwd(backendPid) : 'n/a')
  kv('Resolved app DB path', appDbPath)

  heading('Backend Environment Snapshot')
  if (Object.keys(backendEnv).length === 0) {
    print('(backend PID not found or /proc env unavailable)')
  } else {
    for (const key of [
      'HOME',
      'XDG_CONFIG_HOME',
      'LOOPTROOP_CONFIG_DIR',
      'LOOPTROOP_APP_DB_PATH',
      'LOOPTROOP_BACKEND_PORT',
      'LOOPTROOP_FRONTEND_PORT',
      'LOOPTROOP_FRONTEND_ORIGIN',
      'LOOPTROOP_OPENCODE_BASE_URL',
      'LOOPTROOP_OPENCODE_MODE',
    ]) {
      kv(key, backendEnv[key] ?? 'n/a')
    }
  }

  const frontendUrl = `http://localhost:${effectiveFrontendPort}`
  const backendHealthUrl = `http://localhost:${effectiveBackendPort}/api/health`
  const ticketsUrl = `http://localhost:${effectiveBackendPort}/api/tickets`
  const opencodeHealthUrl = `http://localhost:${effectiveBackendPort}/api/health/opencode`

  const frontendProbe = await probeHttp('frontend root', frontendUrl, timeoutMs)
  const healthProbe = await probeHttp('backend health', backendHealthUrl, timeoutMs)
  const ticketsProbe = await probeHttp('tickets list', ticketsUrl, timeoutMs)
  const opencodeProbe = await probeHttp('backend OpenCode health', opencodeHealthUrl, timeoutMs)
  const correlationSamples = await sampleRuntimeCorrelation({
    backendPid,
    backendHealthUrl,
    ticketsUrl,
    iterations: 5,
    intervalMs: 700,
    probeTimeoutMs: 900,
  })

  printHttpProbe(frontendProbe)
  printHttpProbe(healthProbe)
  printHttpProbe(ticketsProbe)
  printHttpProbe(opencodeProbe)
  printCorrelationSamples('Backend Stall Correlation Samples', correlationSamples)

  printPressureSnapshot('I/O Pressure Snapshot', ioPressure)
  printPressureSnapshot('Memory Pressure Snapshot', memoryPressure)
  printPressureSnapshot('CPU Pressure Snapshot', cpuPressure)

  printMountSnapshot('App DB Mount Snapshot', appDbMount)
  printDiskUsageSnapshot('App DB Disk Usage', appDbDiskUsage)
  printInodeUsageSnapshot('App DB Inode Usage', appDbInodeUsage)
  printLatencyProbes('App DB Filesystem Latency Probes', appDbLatency)

  const uptimeResult = runShell('uptime', 3000)
  printCommandResult('System Uptime', uptimeResult)

  const loadavgResult = runShell('cat /proc/loadavg', 2000)
  printCommandResult('Load Average Raw', loadavgResult)

  const freeResult = runShell('free -h', 3000)
  printCommandResult('Memory Snapshot', freeResult)

  const meminfoResult = runShell(`grep -E 'MemTotal|MemAvailable|SwapTotal|SwapFree|Dirty|Writeback|Cached' /proc/meminfo || true`, 2000)
  printCommandResult('Key /proc/meminfo Fields', meminfoResult)

  if (commandExists('vmstat')) {
    const vmstatResult = runShell('vmstat 1 2', 4000)
    printCommandResult('vmstat Sample', vmstatResult)
  }

  if (commandExists('iostat')) {
    const iostatResult = runShell('iostat -xz 1 2', 5000)
    printCommandResult('iostat Sample', iostatResult)
  } else {
    const diskstatsResult = runShell(`grep -E ' (sd|vd|nvme|dm-|loop)' /proc/diskstats || true`, 2000)
    printCommandResult('/proc/diskstats Snapshot', diskstatsResult)
  }

  const relevantProcessList = runShell(
    `ps -eo pid,ppid,etime,pcpu,pmem,args --sort=pid | grep -E "vite|server/index.ts|dev-opencode|opencode serve|npm run dev|tsx watch server/index.ts|tsx scripts/dev.ts" | grep -v grep`,
    5000,
  )
  printCommandResult('Relevant Process List', relevantProcessList)

  if (backendPid) {
    const backendPs = runShell(`ps -p ${backendPid} -o pid,ppid,etime,pcpu,pmem,stat,wchan:32,args`, 5000)
    printCommandResult(`Backend Process ${backendPid}`, backendPs)

    const backendThreads = runShell(`ps -L -p ${backendPid} -o pid,tid,pcpu,stat,wchan:32,comm`, 5000)
    printCommandResult(`Backend Threads ${backendPid}`, backendThreads)
    printProcessIoSnapshot(`Backend /proc/${backendPid}/io`, readProcessIo(backendPid))

    if (commandExists('lsof')) {
      const backendFiles = runShell(
        `lsof -p ${backendPid} | grep -E "app\\.sqlite|db\\.sqlite|sqlite|looptroop|\\.git|wal|shm" || true`,
        5000,
      )
      printCommandResult(`Backend Open Files ${backendPid}`, backendFiles)
    }
  }

  if (frontendPid) {
    printProcessIoSnapshot(`Frontend /proc/${frontendPid}/io`, readProcessIo(frontendPid))
  }

  if (opencodePid) {
    printProcessIoSnapshot(`OpenCode /proc/${opencodePid}/io`, readProcessIo(opencodePid))
  }

  if (commandExists('ss')) {
    const listeners = runShell(`ss -ltnp | grep -E ":${effectiveFrontendPort}|:${effectiveBackendPort}|4096|4097" || true`, 5000)
    printCommandResult('Listener Snapshot', listeners)
  }

  printFileStats('App DB File Stats', appDbPath)
  printFileStats('App DB WAL Stats', `${appDbPath}-wal`)
  printFileStats('App DB SHM Stats', `${appDbPath}-shm`)

  const appDbInspection = inspectAppDatabase(appDbPath)
  heading('App DB Inspection')
  kv('App DB exists', appDbInspection.exists)
  kv('Open time', formatDuration(appDbInspection.openMs))
  kv('Query time', formatDuration(appDbInspection.queryMs))
  if (appDbInspection.error) kv('Error', appDbInspection.error)
  kv('Attached project count', appDbInspection.attachedProjects.length)
  if (appDbInspection.attachedProjects.length === 0) {
    print('(no attached projects found)')
  } else {
    for (const project of appDbInspection.attachedProjects) {
      print(`- id=${project.id} folder=${project.folderPath} created_at=${project.createdAt} updated_at=${project.updatedAt}`)
    }
  }

  const projectSnapshots = appDbInspection.attachedProjects.map(inspectProjectDatabase)

  for (const project of projectSnapshots) {
    printProjectSnapshot(project)
    printMountSnapshot(`Project ${project.id} Mount Snapshot`, project.mount)
    printDiskUsageSnapshot(`Project ${project.id} Disk Usage`, project.diskUsage)
    printInodeUsageSnapshot(`Project ${project.id} Inode Usage`, project.inodeUsage)
    printLatencyProbes(`Project ${project.id} Filesystem Latency Probes`, project.latencyProbes)
    printFileStats(`Project ${project.id} DB File Stats`, project.projectDbPath)
    printFileStats(`Project ${project.id} DB WAL Stats`, `${project.projectDbPath}-wal`)
    printFileStats(`Project ${project.id} DB SHM Stats`, `${project.projectDbPath}-shm`)
    printFileStats(`Project ${project.id} Git Index Stats`, resolve(project.folderPath, '.git', 'index'))

    const gitStatus = runShell(`git -C ${shellQuote(project.folderPath)} status --short --branch`, 5000)
    printCommandResult(`Project ${project.id} Git Status`, gitStatus)

    const gitStatusTrace = runShell(
      `env GIT_TRACE2_PERF=1 git -C ${shellQuote(project.folderPath)} status --short --branch`,
      7000,
    )
    printCommandResult(`Project ${project.id} Git Status Trace2`, gitStatusTrace)

    const gitBranch = runShell(`git -C ${shellQuote(project.folderPath)} rev-parse --abbrev-ref HEAD`, 3000)
    printCommandResult(`Project ${project.id} Git Branch`, gitBranch)

    const gitRemoteHead = runShell(`git -C ${shellQuote(project.folderPath)} symbolic-ref --quiet --short refs/remotes/origin/HEAD`, 3000)
    printCommandResult(`Project ${project.id} Git Remote HEAD`, gitRemoteHead)
  }

  const heuristics = buildHeuristics({
    backendPid,
    backendThreadDump: backendPid ? runShell(`ps -L -p ${backendPid} -o pid,tid,pcpu,stat,wchan:32,comm`, 5000).stdout : '',
    frontendProbe,
    healthProbe,
    ticketsProbe,
    opencodeProbe,
    attachedProjects: appDbInspection.attachedProjects,
    projectSnapshots,
    ioPressure,
    backendIo: backendPid ? readProcessIo(backendPid) : null,
    correlationSamples,
  })

  heading('Likely Causes')
  for (const message of heuristics) {
    print(`- ${message}`)
  }

  mkdirSync(reportDir, { recursive: true })
  writeFileSync(reportPath, `${reportLines.join('\n')}\n`, 'utf8')

  heading('Report Saved')
  kv('Path', reportPath)
  kv('Finished at', new Date().toISOString())
  print()
  print('Run this again during the next outage and compare the "Likely Causes" plus the backend process/thread sections.')
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

await main()
