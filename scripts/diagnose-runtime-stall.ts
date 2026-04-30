import { spawnSync } from 'node:child_process'
import { promises as dnsPromises } from 'node:dns'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import Database from 'better-sqlite3'

interface CliOptions {
  backendPort?: number
  frontendPort?: number
  opencodeUrl?: string
  timeoutMs?: number
  sampleMs?: number
  trendMs?: number
  trendIntervalMs?: number
  noColor?: boolean
}

interface CommandResult {
  command: string
  shell?: string
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

interface ProcessRuntimeSnapshot {
  pid: number
  command: string | null
  state: string | null
  wchan: string | null
  cpuTicks: number | null
  rssKb: number | null
  numThreads: number | null
  fdCount: number | null
  readBytes: number | null
  writeBytes: number | null
  syscr: number | null
  syscw: number | null
  capturedAtMs: number
  error?: string
}

interface ProcessActivitySample {
  label: string
  pid: number | null
  durationMs: number
  cpuPercent: number | null
  rssKb: number | null
  numThreads: number | null
  fdCount: number | null
  fdCountDelta: number | null
  readBytesDelta: number | null
  writeBytesDelta: number | null
  syscrDelta: number | null
  syscwDelta: number | null
  state: string | null
  wchan: string | null
  command: string | null
  error?: string
}

interface SystemProcessUsage {
  pid: number
  command: string
  cpuPercent: number | null
  rssKb: number | null
  readBytesDelta: number | null
  writeBytesDelta: number | null
}

interface SystemProcessActivitySnapshot {
  durationMs: number
  processCount: number
  topCpu: SystemProcessUsage[]
  topRss: SystemProcessUsage[]
  topReadBytes: SystemProcessUsage[]
  topWriteBytes: SystemProcessUsage[]
}

interface TrendFileTarget {
  label: string
  path: string
}

interface TrendFileSample {
  label: string
  path: string
  exists: boolean
  sizeBytes: number | null
  sizeDeltaBytes: number | null
  modifiedAt: string | null
  error?: string
}

interface PressureTrendDelta {
  ioSomeUs: number | null
  ioFullUs: number | null
  memorySomeUs: number | null
  memoryFullUs: number | null
  cpuSomeUs: number | null
  cpuFullUs: number | null
}

interface PressureTrendTotals {
  ioSome: number | null
  ioFull: number | null
  memorySome: number | null
  memoryFull: number | null
  cpuSome: number | null
  cpuFull: number | null
}

interface RuntimeTrendSample {
  index: number
  at: string
  elapsedMs: number
  intervalMs: number
  loopDriftMs: number
  health: HttpProbeResult
  tickets: HttpProbeResult
  processActivities: ProcessActivitySample[]
  systemActivity: SystemProcessActivitySnapshot
  files: TrendFileSample[]
  pressureDelta: PressureTrendDelta
}

interface RuntimeTrendReport {
  enabled: boolean
  durationMs: number
  intervalMs: number
  samples: RuntimeTrendSample[]
}

interface ProcessRecord {
  pid: number
  ppid: number | null
  elapsed: string | null
  pcpu: number | null
  pmem: number | null
  rssKb: number | null
  args: string
}

interface ProcessMemorySnapshot {
  pid: number
  name: string | null
  state: string | null
  vmRssKb: number | null
  vmHwmKb: number | null
  vmSizeKb: number | null
  vmPeakKb: number | null
  threads: number | null
  fdSize: number | null
  voluntaryCtxtSwitches: number | null
  nonvoluntaryCtxtSwitches: number | null
  oomScore: number | null
  oomScoreAdj: number | null
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

interface SpawnLatencyBaseline {
  label: string
  result: CommandResult
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
  latestNonTerminalTicketLog: TicketLogPreview | null
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

interface TicketLogPreview {
  externalId: string
  status: string
  logPath: string
  exists: boolean
  tailLines: string[]
  warning?: string
}

type Platform = 'linux' | 'wsl' | 'macos' | 'windows'

interface DnsProbeResult {
  hostname: string
  ok: boolean
  durationMs: number
  addresses: string[]
  error?: string
}

interface FdLimits {
  soft: number | null
  hard: number | null
  error?: string
}

interface TcpStats {
  established: number
  timeWait: number
  closeWait: number
  listen: number
  error?: string
}

interface SwapSnapshot {
  totalKb: number | null
  freeKb: number | null
  usedKb: number | null
  usePercent: number | null
  error?: string
}

interface DiagnosticHeap {
  heapUsedMb: number
  heapTotalMb: number
  externalMb: number
  rssMb: number
}

interface MacosSystemMetrics {
  vmStatRaw: string | null
  loadAvg: string | null
  cpuCount: number | null
  topProcessesRaw: string | null
  error?: string
}

const cli = parseCliArgs(process.argv.slice(2))
const reportLines: string[] = []
const startedAt = new Date()
const runTimestamp = formatFileTimestamp(startedAt)
const reportDir = resolve(process.cwd(), 'tmp', 'diagnostics')
const reportPath = resolve(reportDir, `runtime-stall-${runTimestamp}.log`)
const commandAvailability = new Map<string, boolean>()

let detectedPlatform: Platform | null = null

function detectPlatform(): Platform {
  if (detectedPlatform) return detectedPlatform
  if (process.platform === 'win32') {
    detectedPlatform = 'windows'
    return detectedPlatform
  }
  if (process.platform === 'darwin') {
    detectedPlatform = 'macos'
    return detectedPlatform
  }
  const procVersion = (() => {
    try { return readFileSync('/proc/version', 'utf8').toLowerCase() } catch { return '' }
  })()
  detectedPlatform = procVersion.includes('microsoft') ? 'wsl' : 'linux'
  return detectedPlatform
}

const colorEnabled = (() => {
  if (process.argv.includes('--no-color') || process.env.NO_COLOR) return false
  if (process.env.FORCE_COLOR) return true
  return Boolean(process.stdout.isTTY)
})()

if (process.argv.includes('--help')) {
  printHelp()
  process.exit(0)
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

type AnsiColor = 'red' | 'yellow' | 'green' | 'cyan' | 'bold' | 'dim' | 'magenta'

const ANSI: Record<AnsiColor, string> = {
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  magenta: '\x1b[35m',
}
const ANSI_RESET = '\x1b[0m'

function colorize(text: string, color: AnsiColor): string {
  if (!colorEnabled) return text
  return `${ANSI[color]}${text}${ANSI_RESET}`
}

type Severity = 'ok' | 'warn' | 'crit' | 'info' | 'na'

function icon(severity: Severity): string {
  switch (severity) {
    case 'ok': return colorize('✅', 'green')
    case 'warn': return colorize('⚠️ ', 'yellow')
    case 'crit': return colorize('🚨', 'red')
    case 'info': return colorize('ℹ️ ', 'cyan')
    case 'na': return colorize('–', 'dim')
  }
}

function print(line = '') {
  console.log(line)
  reportLines.push(stripAnsi(line))
}

function heading(title: string) {
  print()
  const decorated = colorize(`── ${title} ──`, 'bold')
  print(decorated)
}

function banner(emojiAndTitle: string) {
  const LINE_WIDTH = 62
  const inner = ` ${emojiAndTitle} `
  const pad = Math.max(0, LINE_WIDTH - inner.length)
  const top = `╔${'═'.repeat(LINE_WIDTH + 2)}╗`
  const mid = `║${inner}${' '.repeat(pad)} ║`
  const bot = `╚${'═'.repeat(LINE_WIDTH + 2)}╝`
  print()
  print(colorize(top, 'bold'))
  print(colorize(mid, 'bold'))
  print(colorize(bot, 'bold'))
}

function drawHealthBar(percent: number, width = 20): string {
  const filledCount = Math.round((percent / 100) * width)
  const emptyCount = width - filledCount
  const filled = '■'.repeat(Math.max(0, filledCount))
  const empty = '□'.repeat(Math.max(0, emptyCount))
  
  let color: AnsiColor = 'green'
  if (percent > 90) color = 'red'
  else if (percent > 70) color = 'yellow'
  
  return colorize(`[${filled}${empty}]`, color) + ` ${percent.toFixed(1)}%`
}

function printRiskAssessment(heuristics: string[]) {
  const criticals = heuristics.filter(h => h.toLowerCase().includes('critical') || h.toLowerCase().includes('🚨') || h.toLowerCase().includes('down') || h.toLowerCase().includes('timed out'))
  const warnings = heuristics.filter(h => !criticals.includes(h) && (h.toLowerCase().includes('warning') || h.toLowerCase().includes('⚠️') || h.toLowerCase().includes('slow') || h.toLowerCase().includes('elevated') || h.toLowerCase().includes('high')))
  const infos = heuristics.filter(h => !criticals.includes(h) && !warnings.includes(h))

  banner('🎯  RISK ASSESSMENT')
  
  if (criticals.length > 0) {
    print(colorize('🔴 CRITICAL ISSUES', 'red'))
    for (const msg of criticals) print(`  - ${msg}`)
  }
  
  if (warnings.length > 0) {
    if (criticals.length > 0) print()
    print(colorize('🟡 WARNINGS', 'yellow'))
    for (const msg of warnings) print(`  - ${msg}`)
  }
  
  if (infos.length > 0) {
    if (criticals.length > 0 || warnings.length > 0) print()
    print(colorize('🔵 OBSERVATIONS', 'cyan'))
    for (const msg of infos) print(`  - ${msg}`)
  }
  
  if (heuristics.length === 0) {
    print(colorize('✅ No significant risks detected.', 'green'))
  }
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

function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a'
  const abs = Math.abs(value)
  if (abs >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GiB`
  if (abs >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`
  if (abs >= 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${value} B`
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a'
  return `${value.toFixed(1)}%`
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
      continue
    }

    if (arg === '--sample-ms' && next) {
      options.sampleMs = Number(next)
      i += 1
      continue
    }

    if (arg === '--trend-ms' && next) {
      options.trendMs = Number(next)
      i += 1
      continue
    }

    if (arg === '--trend-interval-ms' && next) {
      options.trendIntervalMs = Number(next)
      i += 1
      continue
    }

    if (arg === '--no-color') {
      options.noColor = true
      continue
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
  --sample-ms <ms>
  --trend-ms <ms>            Short trend window duration. Default: 5000. Use 0 to disable.
  --trend-interval-ms <ms>   Trend sample interval. Default: 1000.
  --no-color         Disable colored output (also respects NO_COLOR env var)

What it checks:
  - Frontend, backend, and OpenCode endpoint responsiveness
  - Relevant running processes, backend listener details, and fallback watcher/candidate detection
  - Backend thread wait states when available
  - One-window CPU, memory, I/O, and file-descriptor activity for backend/frontend/OpenCode
  - Whole-system top CPU/RSS/read-I/O/write-I/O consumers during the sample window
  - Per-process memory snapshots from /proc (RSS/HWM/threads/OOM score)
  - System load, memory, and Linux pressure stall metrics
  - Linux cgroup resource snapshot when available
  - Mount type, disk space, and inode usage for app/project paths
  - Per-process I/O counters from /proc/<pid>/io
  - Workspace mount/watcher risk checks for WSL mounted drives
  - Best-effort kernel OOM scan from dmesg
  - App DB attached projects
  - Project DB ticket/session state
  - Git responsiveness for attached projects
  - A short backend correlation sampler across repeated probes
  - A short trend sampler for process CPU/RSS/I/O, HTTP latency, pressure deltas, and growing files
  - Shell startup baseline to separate diagnostic overhead from real probe latency
  - Git Trace2 perf output for repo status calls
  - Direct filesystem latency probes for project metadata paths
  - Ticket meta files that could trigger extra base-branch detection
  - Heuristic summary of the most likely cause
`)
}

function runShell(command: string, timeoutMs = 5000): CommandResult {
  const start = Date.now()
  const platform = detectPlatform()

  let shellCmd: string
  let shellArgs: string[]

  if (platform === 'windows') {
    shellCmd = 'powershell.exe'
    shellArgs = ['-NoProfile', '-NonInteractive', '-Command', command]
  } else {
    // Linux, macOS, WSL — try bash first, fall back to sh
    shellCmd = 'bash'
    shellArgs = ['--noprofile', '--norc', '-c', command]
  }

  const result = spawnSync(shellCmd, shellArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: timeoutMs,
  })

  const durationMs = Date.now() - start
  const error = result.error

  // If bash not found, retry with sh
  if (error && (error as NodeJS.ErrnoException).code === 'ENOENT' && shellCmd === 'bash') {
    const fallback = spawnSync('sh', ['-c', command], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: timeoutMs,
    })
    const fallbackError = fallback.error
    const timedOut = fallbackError?.name === 'TimeoutError'
    return {
      command,
      shell: 'sh -c',
      durationMs: Date.now() - start,
      exitCode: fallback.status,
      signal: fallback.signal,
      stdout: fallback.stdout ?? '',
      stderr: fallback.stderr ?? '',
      timedOut,
      ...(fallbackError ? { error: fallbackError.message } : {}),
    }
  }

  const timedOut = error?.name === 'TimeoutError'
  return {
    command,
    shell: `${shellCmd} ${shellArgs.slice(0, -1).join(' ')}`,
    durationMs,
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    timedOut,
    ...(error ? { error: error.message } : {}),
  }
}

function runProcess(command: string, args: string[], timeoutMs = 3000): CommandResult {
  const start = Date.now()
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: timeoutMs,
  })

  const durationMs = Date.now() - start
  const error = result.error
  const timedOut = error?.name === 'TimeoutError'
  const displayCommand = [command, ...args].map((part) => part.includes(' ') ? shellQuote(part) : part).join(' ')

  return {
    command: displayCommand,
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
  if (result.shell) kv('Shell', result.shell)
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

function collectShellLatencyBaselines(): SpawnLatencyBaseline[] {
  const platform = detectPlatform()
  const baselines: SpawnLatencyBaseline[] = []

  if (platform !== 'windows') {
    baselines.push({ label: 'direct true', result: runProcess('/bin/true', [], 3000) })
    baselines.push({ label: 'sh -c true', result: runProcess('sh', ['-c', 'true'], 3000) })
    baselines.push({ label: 'bash --noprofile --norc -c true', result: runProcess('bash', ['--noprofile', '--norc', '-c', 'true'], 3000) })
    baselines.push({ label: 'bash -lc true', result: runProcess('bash', ['-lc', 'true'], 3000) })
  }

  const psResult = runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], 5000)
  if (!psResult.error?.includes('ENOENT')) {
    baselines.push({ label: 'powershell.exe -NoProfile -Command exit 0', result: psResult })
  }

  return baselines
}

function printShellLatencyBaselines(baselines: SpawnLatencyBaseline[]) {
  heading('Shell Startup Latency Baseline')
  for (const baseline of baselines) {
    print(`- ${baseline.label}: duration=${formatDuration(baseline.result.durationMs)} exit=${baseline.result.exitCode}`)
    if (baseline.result.timedOut) print('  timed_out=true')
    if (baseline.result.error) print(`  error=${baseline.result.error}`)
  }
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
  const platform = detectPlatform()
  if (platform !== 'linux' && platform !== 'wsl') return {}
  try {
    return parseEnvFile(readFileSync(`/proc/${pid}/environ`))
  } catch {
    return {}
  }
}

function readProcessCwd(pid: number): string | null {
  const platform = detectPlatform()
  if (platform !== 'linux' && platform !== 'wsl') return null
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

function measureDiskWriteLatency(dirPath: string): FsLatencyProbe {
  const startedAt = Date.now()
  const tempFile = resolve(dirPath, `.stall-diag-${Math.random().toString(36).slice(2)}.tmp`)
  const buffer = Buffer.alloc(1024 * 64, 'x') // 64KB write

  try {
    writeFileSync(tempFile, buffer)
    const stats = statSync(tempFile)
    const readBack = readFileSync(tempFile)
    try {
      unlinkSync(tempFile)
    } catch { /* ignore */ }
    
    return {
      label: 'disk write/read latency (64KB)',
      durationMs: Date.now() - startedAt,
      ok: true,
      details: `wrote ${stats.size} bytes, read back ${readBack.length} bytes`,
    }
  } catch (error) {
    return {
      label: 'disk write latency (64KB)',
      durationMs: Date.now() - startedAt,
      ok: false,
      details: '(operation failed)',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function runPowerShell(command: string, timeoutMs = 5000): CommandResult {
  return runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], timeoutMs)
}

function findListeningPid(port: number): number | null {
  const platform = detectPlatform()
  if (platform === 'windows') {
    const result = runPowerShell(`Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Select-Object -First 1`, 3000)
    const pid = Number(result.stdout.trim())
    return Number.isInteger(pid) && pid > 0 ? pid : null
  }

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
  const platform = detectPlatform()
  if (platform !== 'linux' && platform !== 'wsl') {
    return {
      path,
      some: null,
      full: null,
      error: `Pressure metrics not available on ${platform}`,
    }
  }
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
  const platform = detectPlatform()
  if (platform !== 'linux' && platform !== 'wsl') {
    return {
      pid,
      values: {},
      raw: '',
      error: `Process I/O counters not available on ${platform}`,
    }
  }
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

function readGetconfNumber(name: string, fallback: number): number {
  const result = runProcess('getconf', [name], 2000)
  const parsed = Number(result.stdout.trim())
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

let cachedClockTicksPerSecond: number | null = null
let cachedPageSizeBytes: number | null = null

function getClockTicksPerSecond(): number {
  cachedClockTicksPerSecond ??= readGetconfNumber('CLK_TCK', 100)
  return cachedClockTicksPerSecond
}

function getPageSizeBytes(): number {
  cachedPageSizeBytes ??= readGetconfNumber('PAGESIZE', 4096)
  return cachedPageSizeBytes
}

function readOptionalProcText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return null
  }
}

function readFdCount(pid: number): number | null {
  const platform = detectPlatform()
  if (platform !== 'linux' && platform !== 'wsl') return null
  try {
    return readdirSync(`/proc/${pid}/fd`).length
  } catch {
    return null
  }
}

function readProcessCommand(pid: number, fallback: string | null): string | null {
  try {
    const raw = readFileSync(`/proc/${pid}/cmdline`)
      .toString('utf8')
      .replace(/\0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (raw.length > 0) return formatBodyPreview(raw, 180)
  } catch {
    // Fall through to comm/stat fallback.
  }

  return fallback ? formatBodyPreview(fallback, 180) : null
}

function readProcessRuntimeSnapshot(pid: number): ProcessRuntimeSnapshot {
  const capturedAtMs = Date.now()
  const platform = detectPlatform()
  if (platform !== 'linux' && platform !== 'wsl') {
    return {
      pid,
      command: null,
      state: null,
      wchan: null,
      cpuTicks: null,
      rssKb: null,
      numThreads: null,
      fdCount: null,
      readBytes: null,
      writeBytes: null,
      syscr: null,
      syscw: null,
      capturedAtMs,
      error: `Process runtime snapshots not available on ${platform}`,
    }
  }

  try {
    const rawStat = readFileSync(`/proc/${pid}/stat`, 'utf8').trim()
    const commandStart = rawStat.indexOf('(')
    const commandEnd = rawStat.lastIndexOf(')')
    if (commandStart < 0 || commandEnd <= commandStart) {
      throw new Error('Unable to parse /proc stat command field')
    }

    const statCommand = rawStat.slice(commandStart + 1, commandEnd)
    const fields = rawStat.slice(commandEnd + 2).trim().split(/\s+/)
    const utimeTicks = parseInteger(fields[11])
    const stimeTicks = parseInteger(fields[12])
    const rssPages = parseInteger(fields[21])
    const io = readProcessIo(pid)
    const cpuTicks = utimeTicks !== null && stimeTicks !== null ? utimeTicks + stimeTicks : null

    return {
      pid,
      command: readProcessCommand(pid, statCommand),
      state: fields[0] ?? null,
      wchan: readOptionalProcText(`/proc/${pid}/wchan`),
      cpuTicks,
      rssKb: rssPages !== null ? Math.max(0, Math.round((rssPages * getPageSizeBytes()) / 1024)) : null,
      numThreads: parseInteger(fields[17]),
      fdCount: readFdCount(pid),
      readBytes: io.values.read_bytes ?? null,
      writeBytes: io.values.write_bytes ?? null,
      syscr: io.values.syscr ?? null,
      syscw: io.values.syscw ?? null,
      capturedAtMs,
      ...(io.error ? { error: `I/O counters unavailable: ${io.error}` } : {}),
    }
  } catch (error) {
    return {
      pid,
      command: null,
      state: null,
      wchan: null,
      cpuTicks: null,
      rssKb: null,
      numThreads: null,
      fdCount: null,
      readBytes: null,
      writeBytes: null,
      syscr: null,
      syscw: null,
      capturedAtMs,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function numberDelta(start: number | null, end: number | null): number | null {
  if (start === null || end === null) return null
  return end - start
}

function buildProcessActivitySample(
  label: string,
  pid: number | null,
  start: ProcessRuntimeSnapshot | null,
  end: ProcessRuntimeSnapshot | null,
  durationMs: number,
): ProcessActivitySample {
  if (pid === null) {
    return {
      label,
      pid,
      durationMs,
      cpuPercent: null,
      rssKb: null,
      numThreads: null,
      fdCount: null,
      fdCountDelta: null,
      readBytesDelta: null,
      writeBytesDelta: null,
      syscrDelta: null,
      syscwDelta: null,
      state: null,
      wchan: null,
      command: null,
      error: 'PID not available',
    }
  }

  if (!start || !end) {
    return {
      label,
      pid,
      durationMs,
      cpuPercent: null,
      rssKb: end?.rssKb ?? null,
      numThreads: end?.numThreads ?? null,
      fdCount: end?.fdCount ?? null,
      fdCountDelta: null,
      readBytesDelta: null,
      writeBytesDelta: null,
      syscrDelta: null,
      syscwDelta: null,
      state: end?.state ?? null,
      wchan: end?.wchan ?? null,
      command: end?.command ?? start?.command ?? null,
      error: end?.error ?? start?.error ?? 'Unable to sample process',
    }
  }

  const cpuTickDelta = numberDelta(start.cpuTicks, end.cpuTicks)
  const elapsedSeconds = durationMs / 1000
  const cpuPercent = cpuTickDelta !== null && elapsedSeconds > 0
    ? (cpuTickDelta / getClockTicksPerSecond() / elapsedSeconds) * 100
    : null

  return {
    label,
    pid,
    durationMs,
    cpuPercent,
    rssKb: end.rssKb,
    numThreads: end.numThreads,
    fdCount: end.fdCount,
    fdCountDelta: numberDelta(start.fdCount, end.fdCount),
    readBytesDelta: numberDelta(start.readBytes, end.readBytes),
    writeBytesDelta: numberDelta(start.writeBytes, end.writeBytes),
    syscrDelta: numberDelta(start.syscr, end.syscr),
    syscwDelta: numberDelta(start.syscw, end.syscw),
    state: end.state,
    wchan: end.wchan,
    command: end.command ?? start.command,
    error: end.error ?? start.error,
  }
}

async function sampleProcessActivities(
  targets: Array<{ label: string; pid: number | null }>,
  sampleMs: number,
): Promise<ProcessActivitySample[]> {
  const starts = new Map<number, ProcessRuntimeSnapshot>()
  for (const target of targets) {
    if (target.pid !== null) starts.set(target.pid, readProcessRuntimeSnapshot(target.pid))
  }

  const startedAtMs = Date.now()
  await sleep(sampleMs)
  const durationMs = Date.now() - startedAtMs

  const ends = new Map<number, ProcessRuntimeSnapshot>()
  for (const target of targets) {
    if (target.pid !== null) ends.set(target.pid, readProcessRuntimeSnapshot(target.pid))
  }

  return targets.map((target) => buildProcessActivitySample(
    target.label,
    target.pid,
    target.pid !== null ? starts.get(target.pid) ?? null : null,
    target.pid !== null ? ends.get(target.pid) ?? null : null,
    durationMs,
  ))
}

function listSystemRuntimeSnapshots(): ProcessRuntimeSnapshot[] {
  const platform = detectPlatform()
  if (platform !== 'linux' && platform !== 'wsl') return []
  return readdirSync('/proc')
    .filter((entry) => /^\d+$/.test(entry))
    .flatMap((entry) => {
      const pid = Number(entry)
      if (!Number.isInteger(pid) || pid <= 0) return []
      const snapshot = readProcessRuntimeSnapshot(pid)
      return snapshot.error && !snapshot.command ? [] : [snapshot]
    })
}

function toSystemProcessUsage(
  end: ProcessRuntimeSnapshot,
  start: ProcessRuntimeSnapshot | null,
  durationMs: number,
): SystemProcessUsage {
  const cpuTickDelta = start ? numberDelta(start.cpuTicks, end.cpuTicks) : null
  const elapsedSeconds = durationMs / 1000
  const cpuPercent = cpuTickDelta !== null && elapsedSeconds > 0
    ? (cpuTickDelta / getClockTicksPerSecond() / elapsedSeconds) * 100
    : null

  return {
    pid: end.pid,
    command: end.command ?? '(unknown)',
    cpuPercent,
    rssKb: end.rssKb,
    readBytesDelta: start ? numberDelta(start.readBytes, end.readBytes) : null,
    writeBytesDelta: start ? numberDelta(start.writeBytes, end.writeBytes) : null,
  }
}

async function sampleSystemProcessActivity(sampleMs: number): Promise<SystemProcessActivitySnapshot> {
  const startSnapshots = new Map(listSystemRuntimeSnapshots().map((snapshot) => [snapshot.pid, snapshot]))
  const startedAtMs = Date.now()
  await sleep(sampleMs)
  const durationMs = Date.now() - startedAtMs
  const endSnapshots = listSystemRuntimeSnapshots()
  return buildSystemProcessActivitySnapshot(startSnapshots, endSnapshots, durationMs)
}

function buildSystemProcessActivitySnapshot(
  startSnapshots: Map<number, ProcessRuntimeSnapshot>,
  endSnapshots: ProcessRuntimeSnapshot[],
  durationMs: number,
): SystemProcessActivitySnapshot {
  const usages = endSnapshots.map((snapshot) => toSystemProcessUsage(
    snapshot,
    startSnapshots.get(snapshot.pid) ?? null,
    durationMs,
  ))

  const byNumberDesc = <K extends keyof SystemProcessUsage>(key: K) =>
    [...usages]
      .filter((usage) => typeof usage[key] === 'number' && Number.isFinite(usage[key] as number))
      .sort((a, b) => ((b[key] as number | null) ?? -Infinity) - ((a[key] as number | null) ?? -Infinity))

  const byIoDeltaDesc = (key: 'readBytesDelta' | 'writeBytesDelta') =>
    byNumberDesc(key).filter((usage) => (usage[key] ?? 0) > 0)

  return {
    durationMs,
    processCount: endSnapshots.length,
    topCpu: byNumberDesc('cpuPercent').filter((usage) => (usage.cpuPercent ?? 0) > 0).slice(0, 10),
    topRss: byNumberDesc('rssKb').slice(0, 10),
    topReadBytes: byIoDeltaDesc('readBytesDelta').slice(0, 10),
    topWriteBytes: byIoDeltaDesc('writeBytesDelta').slice(0, 10),
  }
}

function readTrendFileSample(target: TrendFileTarget, previous?: TrendFileSample): TrendFileSample {
  try {
    const previousSize = previous?.sizeBytes
    if (!existsSync(target.path)) {
      return {
        label: target.label,
        path: target.path,
        exists: false,
        sizeBytes: null,
        sizeDeltaBytes: typeof previousSize === 'number' ? -previousSize : null,
        modifiedAt: null,
      }
    }

    const stats = statSync(target.path)
    return {
      label: target.label,
      path: target.path,
      exists: true,
      sizeBytes: stats.size,
      sizeDeltaBytes: typeof previousSize === 'number'
        ? stats.size - previousSize
        : previous && !previous.exists
          ? stats.size
          : null,
      modifiedAt: stats.mtime.toISOString(),
    }
  } catch (error) {
    return {
      label: target.label,
      path: target.path,
      exists: false,
      sizeBytes: null,
      sizeDeltaBytes: null,
      modifiedAt: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function readPressureTrendTotals(): PressureTrendTotals {
  const io = inspectPressureFile('/proc/pressure/io')
  const memory = inspectPressureFile('/proc/pressure/memory')
  const cpu = inspectPressureFile('/proc/pressure/cpu')

  return {
    ioSome: io.some?.total ?? null,
    ioFull: io.full?.total ?? null,
    memorySome: memory.some?.total ?? null,
    memoryFull: memory.full?.total ?? null,
    cpuSome: cpu.some?.total ?? null,
    cpuFull: cpu.full?.total ?? null,
  }
}

function buildPressureTrendDelta(start: PressureTrendTotals, end: PressureTrendTotals): PressureTrendDelta {
  return {
    ioSomeUs: numberDelta(start.ioSome, end.ioSome),
    ioFullUs: numberDelta(start.ioFull, end.ioFull),
    memorySomeUs: numberDelta(start.memorySome, end.memorySome),
    memoryFullUs: numberDelta(start.memoryFull, end.memoryFull),
    cpuSomeUs: numberDelta(start.cpuSome, end.cpuSome),
    cpuFullUs: numberDelta(start.cpuFull, end.cpuFull),
  }
}

function buildTrendFileTargets(appDbPath: string, projectSnapshots: ProjectSnapshot[]): TrendFileTarget[] {
  const targets: TrendFileTarget[] = [
    { label: 'app db', path: appDbPath },
    { label: 'app db wal', path: `${appDbPath}-wal` },
    { label: 'app db shm', path: `${appDbPath}-shm` },
  ]

  for (const project of projectSnapshots) {
    targets.push({ label: `project ${project.id} db`, path: project.projectDbPath })
    targets.push({ label: `project ${project.id} db wal`, path: `${project.projectDbPath}-wal` })
    targets.push({ label: `project ${project.id} db shm`, path: `${project.projectDbPath}-shm` })
    if (project.latestNonTerminalTicketLog?.logPath) {
      targets.push({
        label: `project ${project.id} ${project.latestNonTerminalTicketLog.externalId} log`,
        path: project.latestNonTerminalTicketLog.logPath,
      })
    }
  }

  const seen = new Set<string>()
  return targets.filter((target) => {
    if (seen.has(target.path)) return false
    seen.add(target.path)
    return true
  })
}

async function sampleRuntimeTrend(options: {
  durationMs: number
  intervalMs: number
  backendHealthUrl: string
  ticketsUrl: string
  probeTimeoutMs: number
  processTargets: Array<{ label: string; pid: number | null }>
  fileTargets: TrendFileTarget[]
}): Promise<RuntimeTrendReport> {
  const durationMs = Math.max(0, Math.floor(options.durationMs))
  if (durationMs <= 0) {
    return {
      enabled: false,
      durationMs,
      intervalMs: options.intervalMs,
      samples: [],
    }
  }

  const intervalMs = Math.max(250, Math.floor(options.intervalMs))
  const samples: RuntimeTrendSample[] = []
  const startedAtMs = Date.now()
  let previousCapturedAtMs = startedAtMs
  let previousProcesses = new Map<number, ProcessRuntimeSnapshot>()
  let previousSystemProcesses = new Map(listSystemRuntimeSnapshots().map((snapshot) => [snapshot.pid, snapshot]))
  let previousFiles = new Map<string, TrendFileSample>()
  let previousPressure = readPressureTrendTotals()

  for (const target of options.processTargets) {
    if (target.pid !== null) previousProcesses.set(target.pid, readProcessRuntimeSnapshot(target.pid))
  }
  for (const target of options.fileTargets) {
    previousFiles.set(target.path, readTrendFileSample(target))
  }

  const sampleCount = Math.max(1, Math.ceil(durationMs / intervalMs))

  for (let index = 1; index <= sampleCount; index += 1) {
    const scheduledAtMs = startedAtMs + index * intervalMs
    const waitMs = Math.max(0, Math.min(intervalMs, scheduledAtMs - Date.now()))
    if (waitMs > 0) await sleep(waitMs)

    const wokeAtMs = Date.now()
    const [health, tickets] = await Promise.all([
      probeHttp(`trend health ${index}`, options.backendHealthUrl, options.probeTimeoutMs),
      probeHttp(`trend tickets ${index}`, options.ticketsUrl, options.probeTimeoutMs),
    ])

    const endProcesses = new Map<number, ProcessRuntimeSnapshot>()
    for (const target of options.processTargets) {
      if (target.pid !== null) endProcesses.set(target.pid, readProcessRuntimeSnapshot(target.pid))
    }

    const endSystemProcesses = listSystemRuntimeSnapshots()
    const endPressure = readPressureTrendTotals()
    const capturedAtMs = Date.now()
    const actualIntervalMs = Math.max(1, capturedAtMs - previousCapturedAtMs)
    const fileSamples = options.fileTargets.map((target) => readTrendFileSample(target, previousFiles.get(target.path)))
    const processActivities = options.processTargets.map((target) => buildProcessActivitySample(
      target.label,
      target.pid,
      target.pid !== null ? previousProcesses.get(target.pid) ?? null : null,
      target.pid !== null ? endProcesses.get(target.pid) ?? null : null,
      actualIntervalMs,
    ))

    samples.push({
      index,
      at: new Date(capturedAtMs).toISOString(),
      elapsedMs: capturedAtMs - startedAtMs,
      intervalMs: actualIntervalMs,
      loopDriftMs: Math.max(0, wokeAtMs - scheduledAtMs),
      health,
      tickets,
      processActivities,
      systemActivity: buildSystemProcessActivitySnapshot(previousSystemProcesses, endSystemProcesses, actualIntervalMs),
      files: fileSamples,
      pressureDelta: buildPressureTrendDelta(previousPressure, endPressure),
    })

    previousCapturedAtMs = capturedAtMs
    previousProcesses = endProcesses
    previousSystemProcesses = new Map(endSystemProcesses.map((snapshot) => [snapshot.pid, snapshot]))
    previousPressure = endPressure
    previousFiles = new Map(fileSamples.map((sample) => [sample.path, sample]))
  }

  return {
    enabled: true,
    durationMs,
    intervalMs,
    samples,
  }
}

function listProcessRecords(): ProcessRecord[] {
  const result = runShell(`ps -eo pid=,ppid=,etime=,pcpu=,pmem=,rss=,args= --sort=pid`, 5000)
  if (result.exitCode !== 0 || !result.stdout.trim()) return []

  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const parts = line.split(/\s+/, 7)
      if (parts.length < 7) return []

      const [pidRaw, ppidRaw, elapsedRaw, pcpuRaw, pmemRaw, rssRaw, argsRaw] = parts
      const pid = Number(pidRaw)
      if (!Number.isInteger(pid) || pid <= 0) return []

      return [{
        pid,
        ppid: parseInteger(ppidRaw),
        elapsed: elapsedRaw || null,
        pcpu: parseInteger(pcpuRaw),
        pmem: parseInteger(pmemRaw),
        rssKb: parseInteger(rssRaw),
        args: argsRaw ?? '',
      }]
    })
}

function findFirstProcessMatch(processes: ProcessRecord[], patterns: RegExp[]): ProcessRecord | null {
  for (const pattern of patterns) {
    const match = processes.find((process) => pattern.test(process.args))
    if (match) return match
  }

  return null
}

function readProcessMemorySnapshot(pid: number): ProcessMemorySnapshot {
  const platform = detectPlatform()
  if (platform === 'windows') {
    const result = runPowerShell(`Get-Process -Id ${pid} | Select-Object Name, CPU, WorkingSet64, PeakWorkingSet64, VirtualMemorySize64 | ConvertTo-Json`, 3000)
    try {
      const data = JSON.parse(result.stdout)
      return {
        pid,
        name: data.Name ?? null,
        state: null,
        vmRssKb: data.WorkingSet64 ? Math.round(data.WorkingSet64 / 1024) : null,
        vmHwmKb: data.PeakWorkingSet64 ? Math.round(data.PeakWorkingSet64 / 1024) : null,
        vmSizeKb: data.VirtualMemorySize64 ? Math.round(data.VirtualMemorySize64 / 1024) : null,
        vmPeakKb: null,
        threads: null,
        fdSize: null,
        voluntaryCtxtSwitches: null,
        nonvoluntaryCtxtSwitches: null,
        oomScore: null,
        oomScoreAdj: null,
      }
    } catch {
      return { pid, name: null, state: null, vmRssKb: null, vmHwmKb: null, vmSizeKb: null, vmPeakKb: null, threads: null, fdSize: null, voluntaryCtxtSwitches: null, nonvoluntaryCtxtSwitches: null, oomScore: null, oomScoreAdj: null, error: 'Failed to parse PowerShell output' }
    }
  }

  if (platform !== 'linux' && platform !== 'wsl') {
    return {
      pid,
      name: null,
      state: null,
      vmRssKb: null,
      vmHwmKb: null,
      vmSizeKb: null,
      vmPeakKb: null,
      threads: null,
      fdSize: null,
      voluntaryCtxtSwitches: null,
      nonvoluntaryCtxtSwitches: null,
      oomScore: null,
      oomScoreAdj: null,
      error: `Process memory snapshots not available on ${platform}`,
    }
  }
  const statusPath = `/proc/${pid}/status`

  try {
    const raw = readFileSync(statusPath, 'utf8')
    const values = Object.fromEntries(
      raw
        .split('\n')
        .map((line) => {
          const separator = line.indexOf(':')
          if (separator <= 0) return ['', '']
          return [line.slice(0, separator), line.slice(separator + 1).trim()]
        })
        .filter(([key]) => key.length > 0),
    ) as Record<string, string>

    const readProcNumber = (path: string): number | null => {
      try {
        return parseInteger(readFileSync(path, 'utf8').trim())
      } catch {
        return null
      }
    }

    return {
      pid,
      name: values.Name ?? null,
      state: values.State ?? null,
      vmRssKb: parseInteger(values.VmRSS?.split(/\s+/)[0]),
      vmHwmKb: parseInteger(values.VmHWM?.split(/\s+/)[0]),
      vmSizeKb: parseInteger(values.VmSize?.split(/\s+/)[0]),
      vmPeakKb: parseInteger(values.VmPeak?.split(/\s+/)[0]),
      threads: parseInteger(values.Threads),
      fdSize: parseInteger(values.FDSize),
      voluntaryCtxtSwitches: parseInteger(values.voluntary_ctxt_switches),
      nonvoluntaryCtxtSwitches: parseInteger(values.nonvoluntary_ctxt_switches),
      oomScore: readProcNumber(`/proc/${pid}/oom_score`),
      oomScoreAdj: readProcNumber(`/proc/${pid}/oom_score_adj`),
    }
  } catch (error) {
    return {
      pid,
      name: null,
      state: null,
      vmRssKb: null,
      vmHwmKb: null,
      vmSizeKb: null,
      vmPeakKb: null,
      threads: null,
      fdSize: null,
      voluntaryCtxtSwitches: null,
      nonvoluntaryCtxtSwitches: null,
      oomScore: null,
      oomScoreAdj: null,
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

async function measureEventLoopLag(): Promise<number> {
  const start = Date.now()
  await new Promise<void>((resolve) => setImmediate(resolve))
  return Date.now() - start
}

async function probeDns(hostname: string): Promise<DnsProbeResult> {
  const start = Date.now()
  try {
    const result = await dnsPromises.lookup(hostname, { all: true })
    const addresses = Array.isArray(result) ? result.map((r: { address: string }) => r.address) : [result.address]
    return {
      hostname,
      ok: true,
      durationMs: Date.now() - start,
      addresses,
    }
  } catch (error) {
    return {
      hostname,
      ok: false,
      durationMs: Date.now() - start,
      addresses: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function readFdLimits(): FdLimits {
  const platform = detectPlatform()
  if (platform === 'windows') {
    return { soft: null, hard: null, error: 'FD limits not applicable on Windows' }
  }
  try {
    const softResult = runShell('ulimit -Sn', 2000)
    const hardResult = runShell('ulimit -Hn', 2000)
    const soft = parseInteger(softResult.stdout.trim())
    const hard = parseInteger(hardResult.stdout.trim())
    return { soft, hard }
  } catch (error) {
    return { soft: null, hard: null, error: error instanceof Error ? error.message : String(error) }
  }
}

function readTcpStats(): TcpStats {
  const platform = detectPlatform()
  try {
    if (platform === 'linux' || platform === 'wsl') {
      const result = runShell('ss -tn 2>/dev/null | tail -n +2', 3000)
      if (result.exitCode !== 0 || result.error) return { established: 0, timeWait: 0, closeWait: 0, listen: 0, error: result.stderr || result.error }
      const lines = result.stdout.split('\n').filter(Boolean)
      const count = (state: string) => lines.filter((l) => l.startsWith(state)).length
      const listenResult = runShell('ss -tln 2>/dev/null | tail -n +2 | wc -l', 2000)
      return {
        established: count('ESTAB'),
        timeWait: count('TIME-WAIT'),
        closeWait: count('CLOSE-WAIT'),
        listen: parseInteger(listenResult.stdout.trim()) ?? 0,
      }
    }
    if (platform === 'macos') {
      const result = runShell('netstat -an -p tcp 2>/dev/null', 3000)
      if (result.exitCode !== 0) return { established: 0, timeWait: 0, closeWait: 0, listen: 0, error: result.stderr }
      const lines = result.stdout.split('\n').filter((l) => l.startsWith('tcp'))
      const count = (state: string) => lines.filter((l) => l.includes(state)).length
      return {
        established: count('ESTABLISHED'),
        timeWait: count('TIME_WAIT'),
        closeWait: count('CLOSE_WAIT'),
        listen: count('LISTEN'),
      }
    }
    if (platform === 'windows') {
      const result = runShell('netstat -ano', 3000)
      if (result.exitCode !== 0) return { established: 0, timeWait: 0, closeWait: 0, listen: 0, error: result.stderr }
      const lines = result.stdout.split('\n').filter((l) => l.includes('TCP'))
      const count = (state: string) => lines.filter((l) => l.includes(state)).length
      return {
        established: count('ESTABLISHED'),
        timeWait: count('TIME_WAIT'),
        closeWait: count('CLOSE_WAIT'),
        listen: count('LISTENING'),
      }
    }
    return { established: 0, timeWait: 0, closeWait: 0, listen: 0, error: 'Platform not supported' }
  } catch (error) {
    return { established: 0, timeWait: 0, closeWait: 0, listen: 0, error: error instanceof Error ? error.message : String(error) }
  }
}

function countZombieProcesses(): number {
  const platform = detectPlatform()
  try {
    if (platform === 'linux' || platform === 'wsl') {
      const entries = readdirSync('/proc').filter((entry) => /^\d+$/.test(entry))
      let count = 0
      for (const entry of entries) {
        try {
          const status = readFileSync(`/proc/${entry}/status`, 'utf8')
          if (/^State:\s+Z/m.test(status)) count += 1
        } catch { /* ignore */ }
      }
      return count
    }
    if (platform === 'macos') {
      const result = runShell("ps aux | awk '$8 == \"Z\"' | wc -l", 3000)
      return parseInteger(result.stdout.trim()) ?? 0
    }
    return 0
  } catch {
    return 0
  }
}

function readDiagnosticProcessHeap(): DiagnosticHeap {
  const mem = process.memoryUsage()
  return {
    heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024 * 10) / 10,
    heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024 * 10) / 10,
    externalMb: Math.round(mem.external / 1024 / 1024 * 10) / 10,
    rssMb: Math.round(mem.rss / 1024 / 1024 * 10) / 10,
  }
}

function readSwapSnapshot(): SwapSnapshot {
  const platform = detectPlatform()
  if (platform === 'macos' || platform === 'windows') {
    return { totalKb: null, freeKb: null, usedKb: null, usePercent: null, error: `Swap metrics not available via /proc on ${platform}` }
  }
  try {
    const raw = readOptionalProcText('/proc/meminfo')
    if (!raw) return { totalKb: null, freeKb: null, usedKb: null, usePercent: null, error: '/proc/meminfo not available' }
    const parse = (key: string): number | null => {
      const match = raw.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'))
      return match ? parseInt(match[1], 10) : null
    }
    const totalKb = parse('SwapTotal')
    const freeKb = parse('SwapFree')
    const usedKb = totalKb !== null && freeKb !== null ? totalKb - freeKb : null
    const usePercent = totalKb && totalKb > 0 && usedKb !== null ? Math.round(usedKb / totalKb * 100 * 10) / 10 : null
    return { totalKb, freeKb, usedKb, usePercent }
  } catch (error) {
    return { totalKb: null, freeKb: null, usedKb: null, usePercent: null, error: error instanceof Error ? error.message : String(error) }
  }
}

function collectMacosSystemMetrics(): MacosSystemMetrics {
  const platform = detectPlatform()
  if (platform !== 'macos') {
    return { vmStatRaw: null, loadAvg: null, cpuCount: null, topProcessesRaw: null, error: 'Only available on macOS' }
  }
  const vmStat = runShell('vm_stat', 3000)
  const loadAvg = runShell('sysctl -n vm.loadavg', 2000)
  const cpuCountResult = runShell('sysctl -n hw.ncpu', 2000)
  const topResult = runShell("top -l 1 -n 10 -stats pid,command,cpu,rsize 2>/dev/null | tail -n +13", 5000)
  return {
    vmStatRaw: vmStat.exitCode === 0 ? vmStat.stdout.trim() : null,
    loadAvg: loadAvg.exitCode === 0 ? loadAvg.stdout.trim() : null,
    cpuCount: parseInteger(cpuCountResult.stdout.trim()),
    topProcessesRaw: topResult.exitCode === 0 ? topResult.stdout.trim() : null,
    error: [vmStat, loadAvg, cpuCountResult].some((r) => r.exitCode !== 0) ? 'Some macOS metrics failed' : undefined,
  }
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

function formatExecutionLogTailLine(rawLine: string): string {
  try {
    const parsed = JSON.parse(rawLine) as {
      timestamp?: unknown
      phase?: unknown
      type?: unknown
      message?: unknown
      content?: unknown
    }
    const timestamp = typeof parsed.timestamp === 'string' ? parsed.timestamp : 'n/a'
    const phase = typeof parsed.phase === 'string' ? parsed.phase : 'n/a'
    const type = typeof parsed.type === 'string' ? parsed.type : 'n/a'
    const messageSource = typeof parsed.message === 'string'
      ? parsed.message
      : typeof parsed.content === 'string'
        ? parsed.content
        : rawLine
    return `${timestamp} | ${phase} | ${type} | ${formatBodyPreview(messageSource, 220)}`
  } catch {
    return formatBodyPreview(rawLine, 260)
  }
}

function readTicketExecutionLogPreview(
  projectRoot: string,
  ticket: TicketRow,
  maxLines = 8,
): TicketLogPreview {
  const logPath = resolve(projectRoot, '.looptroop', 'worktrees', ticket.external_id, '.ticket', 'runtime', 'execution-log.jsonl')
  if (!existsSync(logPath)) {
    return {
      externalId: ticket.external_id,
      status: ticket.status,
      logPath,
      exists: false,
      tailLines: [],
      warning: 'Execution log file is missing.',
    }
  }

  try {
    const raw = readFileSync(logPath, 'utf8')
    const tailLines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(-maxLines)
      .map(formatExecutionLogTailLine)

    return {
      externalId: ticket.external_id,
      status: ticket.status,
      logPath,
      exists: true,
      tailLines,
      ...(tailLines.length === 0 ? { warning: 'Execution log file exists but contains no entries.' } : {}),
    }
  } catch (error) {
    return {
      externalId: ticket.external_id,
      status: ticket.status,
      logPath,
      exists: true,
      tailLines: [],
      warning: error instanceof Error ? error.message : String(error),
    }
  }
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
      latestNonTerminalTicketLog: null,
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

    const latestNonTerminalTicket = tableExists(db, 'tickets')
      ? db.prepare(
        `SELECT external_id, status, updated_at
         FROM tickets
         WHERE status NOT IN ('COMPLETED', 'CANCELED')
         ORDER BY updated_at DESC
         LIMIT 1`,
      ).get() as TicketRow | undefined
      : undefined

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
    const latestNonTerminalTicketLog = latestNonTerminalTicket
      ? readTicketExecutionLogPreview(project.folderPath, latestNonTerminalTicket)
      : null

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
      latestNonTerminalTicketLog,
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

function printProcessCandidate(title: string, process: ProcessRecord | null) {
  heading(title)
  if (!process) {
    print('(not found)')
    return
  }

  kv('PID', process.pid)
  kv('PPID', process.ppid)
  kv('Elapsed', process.elapsed)
  kv('CPU %', process.pcpu)
  kv('MEM %', process.pmem)
  kv('RSS KB', process.rssKb)
  kv('Args', process.args)
}

function printProcessMemorySnapshot(title: string, snapshot: ProcessMemorySnapshot | null) {
  heading(title)
  if (!snapshot) {
    print('(not available)')
    return
  }

  kv('PID', snapshot.pid)
  if (snapshot.error) {
    kv('Error', snapshot.error)
    return
  }

  kv('Name', snapshot.name)
  kv('State', snapshot.state)
  kv('VmRSS KB', snapshot.vmRssKb)
  kv('VmHWM KB', snapshot.vmHwmKb)
  kv('VmSize KB', snapshot.vmSizeKb)
  kv('VmPeak KB', snapshot.vmPeakKb)
  kv('Threads', snapshot.threads)
  kv('FDSize', snapshot.fdSize)
  kv('voluntary_ctxt_switches', snapshot.voluntaryCtxtSwitches)
  kv('nonvoluntary_ctxt_switches', snapshot.nonvoluntaryCtxtSwitches)
  kv('oom_score', snapshot.oomScore)
  kv('oom_score_adj', snapshot.oomScoreAdj)
}

function printProcessActivitySamples(title: string, samples: ProcessActivitySample[]) {
  heading(title)
  if (samples.length === 0) {
    print('(none)')
    return
  }

  for (const sample of samples) {
    print(
      `- ${sample.label}` +
      ` pid=${sample.pid ?? 'n/a'}` +
      ` sample_ms=${sample.durationMs}` +
      ` cpu=${formatPercent(sample.cpuPercent)}` +
      ` rss=${formatBytes(sample.rssKb !== null ? sample.rssKb * 1024 : null)}` +
      ` threads=${sample.numThreads ?? 'n/a'}` +
      ` fds=${sample.fdCount ?? 'n/a'}` +
      ` fd_delta=${sample.fdCountDelta ?? 'n/a'}` +
      ` read_delta=${formatBytes(sample.readBytesDelta)}` +
      ` write_delta=${formatBytes(sample.writeBytesDelta)}` +
      ` syscr_delta=${sample.syscrDelta ?? 'n/a'}` +
      ` syscw_delta=${sample.syscwDelta ?? 'n/a'}` +
      ` state=${sample.state ?? 'n/a'}` +
      ` wchan=${sample.wchan ?? 'n/a'}`,
    )
    if (sample.command) print(`  command=${sample.command}`)
    if (sample.error) print(`  warning=${sample.error}`)
  }
}

function printSystemUsageList(title: string, usages: SystemProcessUsage[], metric: 'cpu' | 'rss' | 'read' | 'write') {
  print(title)
  if (usages.length === 0) {
    print('- (none observed during sample)')
    return
  }

  for (const usage of usages) {
    const metricText = metric === 'cpu'
      ? formatPercent(usage.cpuPercent)
      : metric === 'rss'
        ? formatBytes(usage.rssKb !== null ? usage.rssKb * 1024 : null)
        : metric === 'read'
          ? formatBytes(usage.readBytesDelta)
          : formatBytes(usage.writeBytesDelta)
    print(`- pid=${usage.pid} ${metric}=${metricText} cmd=${usage.command}`)
  }
}

function printSystemProcessActivitySnapshot(title: string, snapshot: SystemProcessActivitySnapshot) {
  heading(title)
  kv('Sample duration', formatDuration(snapshot.durationMs))
  kv('Processes sampled', snapshot.processCount)
  printSystemUsageList('Top CPU consumers:', snapshot.topCpu, 'cpu')
  printSystemUsageList('Top RSS consumers:', snapshot.topRss, 'rss')
  printSystemUsageList('Top read I/O consumers during sample:', snapshot.topReadBytes, 'read')
  printSystemUsageList('Top write I/O consumers during sample:', snapshot.topWriteBytes, 'write')
}

function formatTrendHttpProbe(probe: HttpProbeResult): string {
  const status = probe.status ?? 'n/a'
  return `${probe.ok ? 'ok' : 'fail'}:${status}:${formatDuration(probe.durationMs)}`
}

function formatPressureDelta(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'n/a'
  if (value === 0) return '0ms'
  return `${(value / 1000).toFixed(1)}ms`
}

function hasPressureDelta(delta: PressureTrendDelta): boolean {
  return Object.values(delta).some((value) => (value ?? 0) > 0)
}

function formatSystemUsageShort(usage: SystemProcessUsage | undefined, metric: 'cpu' | 'read' | 'write'): string {
  if (!usage) return 'n/a'
  const metricText = metric === 'cpu'
    ? formatPercent(usage.cpuPercent)
    : metric === 'read'
      ? formatBytes(usage.readBytesDelta)
      : formatBytes(usage.writeBytesDelta)
  return `pid=${usage.pid} ${metric}=${metricText} cmd=${formatBodyPreview(usage.command, 90)}`
}

function printRuntimeTrendReport(title: string, report: RuntimeTrendReport) {
  heading(title)
  if (!report.enabled) {
    print('(disabled; pass --trend-ms with a positive value to enable)')
    return
  }
  if (report.samples.length === 0) {
    print('(no samples captured)')
    return
  }

  const healthMax = Math.max(...report.samples.map((sample) => sample.health.durationMs))
  const ticketsMax = Math.max(...report.samples.map((sample) => sample.tickets.durationMs))
  const healthFailures = report.samples.filter((sample) => !sample.health.ok).length
  const ticketFailures = report.samples.filter((sample) => !sample.tickets.ok).length
  const maxProcessCpu = report.samples
    .flatMap((sample) => sample.processActivities)
    .filter((sample) => sample.cpuPercent !== null)
    .sort((left, right) => (right.cpuPercent ?? -Infinity) - (left.cpuPercent ?? -Infinity))[0]
  const maxFileGrowth = report.samples
    .flatMap((sample) => sample.files)
    .filter((sample) => (sample.sizeDeltaBytes ?? 0) > 0)
    .sort((left, right) => (right.sizeDeltaBytes ?? 0) - (left.sizeDeltaBytes ?? 0))[0]

  kv('Trend window', formatDuration(report.durationMs))
  kv('Trend interval target', formatDuration(report.intervalMs))
  kv('Samples captured', report.samples.length)
  kv('Health max', formatDuration(healthMax))
  kv('Tickets max', formatDuration(ticketsMax))
  kv('Health failures', healthFailures)
  kv('Tickets failures', ticketFailures)
  if (maxProcessCpu) {
    print(`Max watched-process CPU: ${maxProcessCpu.label} pid=${maxProcessCpu.pid ?? 'n/a'} cpu=${formatPercent(maxProcessCpu.cpuPercent)} at rss=${formatBytes(maxProcessCpu.rssKb !== null ? maxProcessCpu.rssKb * 1024 : null)}`)
  }
  if (maxFileGrowth) {
    print(`Largest watched-file growth: ${maxFileGrowth.label} delta=${formatBytes(maxFileGrowth.sizeDeltaBytes)} size=${formatBytes(maxFileGrowth.sizeBytes)}`)
  }

  for (const sample of report.samples) {
    print(
      `- #${sample.index}` +
      ` at=${sample.at}` +
      ` elapsed=${formatDuration(sample.elapsedMs)}` +
      ` interval=${formatDuration(sample.intervalMs)}` +
      ` drift=${formatDuration(sample.loopDriftMs)}` +
      ` health=${formatTrendHttpProbe(sample.health)}` +
      ` tickets=${formatTrendHttpProbe(sample.tickets)}` +
      ` top_cpu=${formatSystemUsageShort(sample.systemActivity.topCpu[0], 'cpu')}` +
      ` top_write=${formatSystemUsageShort(sample.systemActivity.topWriteBytes[0], 'write')}`,
    )

    for (const processSample of sample.processActivities) {
      print(
        `  process ${processSample.label}` +
        ` pid=${processSample.pid ?? 'n/a'}` +
        ` cpu=${formatPercent(processSample.cpuPercent)}` +
        ` rss=${formatBytes(processSample.rssKb !== null ? processSample.rssKb * 1024 : null)}` +
        ` fd_delta=${processSample.fdCountDelta ?? 'n/a'}` +
        ` read_delta=${formatBytes(processSample.readBytesDelta)}` +
        ` write_delta=${formatBytes(processSample.writeBytesDelta)}` +
        ` state=${processSample.state ?? 'n/a'}` +
        ` wchan=${processSample.wchan ?? 'n/a'}`,
      )
    }

    if (hasPressureDelta(sample.pressureDelta)) {
      print(
        `  pressure_delta` +
        ` io_some=${formatPressureDelta(sample.pressureDelta.ioSomeUs)}` +
        ` io_full=${formatPressureDelta(sample.pressureDelta.ioFullUs)}` +
        ` memory_some=${formatPressureDelta(sample.pressureDelta.memorySomeUs)}` +
        ` memory_full=${formatPressureDelta(sample.pressureDelta.memoryFullUs)}` +
        ` cpu_some=${formatPressureDelta(sample.pressureDelta.cpuSomeUs)}` +
        ` cpu_full=${formatPressureDelta(sample.pressureDelta.cpuFullUs)}`,
      )
    }

    const changedFiles = sample.files.filter((file) => file.error || (file.sizeDeltaBytes ?? 0) !== 0)
    if (changedFiles.length === 0) {
      print('  file_changes=(none)')
    } else {
      for (const file of changedFiles) {
        print(
          `  file ${file.label}` +
          ` exists=${file.exists}` +
          ` size=${formatBytes(file.sizeBytes)}` +
          ` delta=${formatBytes(file.sizeDeltaBytes)}` +
          ` mtime=${file.modifiedAt ?? 'n/a'}` +
          `${file.error ? ` error=${file.error}` : ''}`,
        )
      }
    }
  }
}

function readMemoryStatSummary(): string | null {
  const raw = readOptionalProcText('/sys/fs/cgroup/memory.stat')
  if (!raw) return null

  const wanted = new Set(['anon', 'file', 'file_dirty', 'file_writeback', 'swapcached', 'pgmajfault'])
  return raw
    .split('\n')
    .filter((line) => wanted.has(line.split(/\s+/)[0] ?? ''))
    .join('; ')
}

function printCgroupResourceSnapshot() {
  heading('Cgroup Resource Snapshot')
  const platform = detectPlatform()
  if (platform !== 'linux' && platform !== 'wsl') {
    print('(cgroup not available on this platform)')
    return
  }
  const entries = [
    ['cgroup.controllers', '/sys/fs/cgroup/cgroup.controllers'],
    ['cpuset.cpus.effective', '/sys/fs/cgroup/cpuset.cpus.effective'],
    ['memory.max', '/sys/fs/cgroup/memory.max'],
    ['memory.current', '/sys/fs/cgroup/memory.current'],
    ['memory.stat summary', null],
    ['memory.swap.max', '/sys/fs/cgroup/memory.swap.max'],
    ['memory.swap.current', '/sys/fs/cgroup/memory.swap.current'],
    ['cpu.max', '/sys/fs/cgroup/cpu.max'],
    ['cpu.stat', '/sys/fs/cgroup/cpu.stat'],
    ['io.stat', '/sys/fs/cgroup/io.stat'],
    ['pids.max', '/sys/fs/cgroup/pids.max'],
    ['pids.current', '/sys/fs/cgroup/pids.current'],
  ] as const

  for (const [label, path] of entries) {
    const raw = path === null ? readMemoryStatSummary() : readOptionalProcText(path)
    kv(label, raw ?? 'n/a')
  }
}

function printCorrelationSamples(title: string, samples: CorrelationSample[]) {
  heading(title)
  if (samples.length === 0) {
    print('(none)')
    return
  }

  const healthDurations = samples.map((sample) => sample.healthDurationMs)
  const ticketDurations = samples.map((sample) => sample.ticketsDurationMs)
  kv('Health max', formatDuration(Math.max(...healthDurations)))
  kv('Tickets max', formatDuration(Math.max(...ticketDurations)))
  kv('Health failures', samples.filter((sample) => !sample.healthOk).length)
  kv('Tickets failures', samples.filter((sample) => !sample.ticketsOk).length)

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

  print('Latest non-terminal ticket execution log tail:')
  if (!project.latestNonTerminalTicketLog) {
    print('(none)')
  } else {
    print(
      `- ticket=${project.latestNonTerminalTicketLog.externalId} status=${project.latestNonTerminalTicketLog.status}` +
      ` exists=${project.latestNonTerminalTicketLog.exists} path=${project.latestNonTerminalTicketLog.logPath}`,
    )
    if (project.latestNonTerminalTicketLog.warning) {
      print(`- warning=${project.latestNonTerminalTicketLog.warning}`)
    }
    if (project.latestNonTerminalTicketLog.tailLines.length === 0) {
      print('(no log lines)')
    } else {
      for (const line of project.latestNonTerminalTicketLog.tailLines) {
        print(`- ${line}`)
      }
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

function printAdvancedDiagnostics(params: {
  eventLoopLagMs: number
  dnsProbe: DnsProbeResult
  fdLimits: FdLimits
  tcpStats: TcpStats
  zombieCount: number
  heap: DiagnosticHeap
  swap: SwapSnapshot
  macosMetrics: MacosSystemMetrics
}) {
  banner('🧬  ADVANCED DIAGNOSTICS')

  heading('Event Loop Lag')
  const lagSeverity: Severity = params.eventLoopLagMs > 200 ? 'crit' : params.eventLoopLagMs > 50 ? 'warn' : 'ok'
  kv(`${icon(lagSeverity)} Event loop lag`, `${params.eventLoopLagMs}ms`)
  if (params.eventLoopLagMs > 50) {
    print(`  Hint: Lag >50ms suggests the Node.js event loop is busy. This diagnostic script is affected too.`)
  }

  heading('DNS Resolution Probe')
  const dnsSeverity: Severity = params.dnsProbe.ok ? 'ok' : 'crit'
  kv(`${icon(dnsSeverity)} localhost`, params.dnsProbe.ok
    ? `${params.dnsProbe.durationMs}ms → ${params.dnsProbe.addresses.join(', ')}`
    : `FAILED – ${params.dnsProbe.error}`)

  heading('File Descriptor Limits')
  if (params.fdLimits.error && !params.fdLimits.soft) {
    kv('FD limits', params.fdLimits.error)
  } else {
    kv('FD soft limit', params.fdLimits.soft ?? 'n/a')
    kv('FD hard limit', params.fdLimits.hard ?? 'n/a')
  }

  heading('TCP Connection States')
  if (params.tcpStats.error && params.tcpStats.established === 0) {
    kv('TCP stats', params.tcpStats.error)
  } else {
    const twSeverity: Severity = params.tcpStats.timeWait > 1000 ? 'crit' : params.tcpStats.timeWait > 200 ? 'warn' : 'ok'
    kv('ESTABLISHED', params.tcpStats.established)
    kv(`${icon(twSeverity)} TIME_WAIT`, params.tcpStats.timeWait)
    kv('CLOSE_WAIT', params.tcpStats.closeWait)
    kv('LISTEN', params.tcpStats.listen)
  }

  heading('Zombie Processes')
  const zombieSeverity: Severity = params.zombieCount > 0 ? 'warn' : 'ok'
  kv(`${icon(zombieSeverity)} Zombie count`, params.zombieCount)

  heading('Diagnostic Process Heap (this script)')
  kv('Heap used', `${params.heap.heapUsedMb} MiB`)
  kv('Heap total', `${params.heap.heapTotalMb} MiB`)
  kv('External', `${params.heap.externalMb} MiB`)
  kv('RSS', `${params.heap.rssMb} MiB`)

  heading('Swap Pressure')
  if (params.swap.error && params.swap.totalKb === null) {
    kv('Swap', params.swap.error)
  } else {
    const swapSeverity: Severity = (params.swap.usePercent ?? 0) > 80 ? 'crit' : (params.swap.usePercent ?? 0) > 50 ? 'warn' : 'ok'
    kv(`${icon(swapSeverity)} Swap total`, formatBytes(params.swap.totalKb !== null ? params.swap.totalKb * 1024 : null))
    kv('Swap free', formatBytes(params.swap.freeKb !== null ? params.swap.freeKb * 1024 : null))
    kv('Swap used', formatBytes(params.swap.usedKb !== null ? params.swap.usedKb * 1024 : null))
    kv('Swap use %', formatPercent(params.swap.usePercent))
  }

  const platform = detectPlatform()
  if (platform === 'macos') {
    heading('macOS System Metrics')
    kv('CPU count', params.macosMetrics.cpuCount ?? 'n/a')
    kv('Load avg', params.macosMetrics.loadAvg ?? 'n/a')
    if (params.macosMetrics.vmStatRaw) {
      print('vm_stat:')
      for (const line of params.macosMetrics.vmStatRaw.split('\n').slice(0, 15)) {
        print(`  ${line}`)
      }
    }
    if (params.macosMetrics.topProcessesRaw) {
      print('Top processes:')
      for (const line of params.macosMetrics.topProcessesRaw.split('\n').slice(0, 12)) {
        print(`  ${line}`)
      }
    }
  }
}

function printQuickSummary(params: {
  backendPid: number | null
  frontendPid: number | null
  opencodePid: number | null
  healthProbe: HttpProbeResult
  frontendProbe: HttpProbeResult
  opencodeProbe: HttpProbeResult
  ioPressure: PressureSnapshot
  workspaceDiskUsage: DiskUsageSnapshot
  platform: Platform
  eventLoopLagMs: number
}) {
  const LINE_WIDTH = 72

  const backendSeverity: Severity = params.backendPid !== null ? (params.healthProbe.ok ? 'ok' : 'warn') : 'crit'
  const frontendSeverity: Severity = params.frontendPid !== null ? (params.frontendProbe.ok ? 'ok' : 'warn') : 'crit'
  const opencodeSeverity: Severity = params.opencodePid !== null ? (params.opencodeProbe.ok ? 'ok' : 'warn') : 'na'
  const ioPressureVal = params.ioPressure.some?.avg10 ?? 0
  const systemSeverity: Severity = ioPressureVal > 10 ? 'crit' : ioPressureVal > 2 ? 'warn' : 'ok'
  const diskPercent = params.workspaceDiskUsage.usePercent ?? 0
  const diskSeverity: Severity = diskPercent >= 95 ? 'crit' : diskPercent >= 85 ? 'warn' : 'ok'
  const loopSeverity: Severity = params.eventLoopLagMs > 200 ? 'crit' : params.eventLoopLagMs > 50 ? 'warn' : 'ok'

  const row = (label: string, ic: string, detail: string) => {
    const text = `  ${ic}  ${label.padEnd(16)}${detail}`
    const stripped = stripAnsi(text)
    const padded = text + ' '.repeat(Math.max(0, LINE_WIDTH - stripped.length))
    return colorize('║', 'bold') + padded + colorize('║', 'bold')
  }

  const divider = colorize(`╠${'═'.repeat(LINE_WIDTH)}╣`, 'bold')
  const top = colorize(`╔${'═'.repeat(LINE_WIDTH)}╗`, 'bold')
  const bot = colorize(`╚${'═'.repeat(LINE_WIDTH)}╝`, 'bold')
  const titleText = '  QUICK HEALTH STATUS  '
  const titlePad = LINE_WIDTH - titleText.length
  const titleLeft = Math.floor(titlePad / 2)
  const titleRight = titlePad - titleLeft
  const titleLine = colorize(`║${'═'.repeat(titleLeft)}${colorize(titleText, 'bold')}${'═'.repeat(titleRight)}║`, 'bold')

  print()
  print(top)
  print(titleLine)
  print(divider)
  const backendDetail = params.backendPid
    ? `PID ${params.backendPid.toString().padEnd(6)} HTTP ${params.healthProbe.durationMs}ms`
    : 'Not detected'
  print(row('Backend', icon(backendSeverity), backendDetail))

  const frontendDetail = params.frontendPid
    ? `PID ${params.frontendPid.toString().padEnd(6)} HTTP ${params.frontendProbe.durationMs}ms`
    : 'Not detected'
  print(row('Frontend', icon(frontendSeverity), frontendDetail))

  const opencodeDetail = params.opencodePid
    ? `PID ${params.opencodePid.toString().padEnd(6)} HTTP ${params.opencodeProbe.durationMs}ms`
    : 'Not detected'
  print(row('OpenCode', icon(opencodeSeverity), opencodeDetail))

  print(divider)
  print(row('Platform', icon('info'), params.platform.toUpperCase()))
  
  const ioDetail = params.ioPressure.error
    ? 'n/a'
    : drawHealthBar(ioPressureVal * 5, 20) // Multiplier to make small pressure visible
  print(row('I/O Pressure', icon(systemSeverity), ioDetail))

  print(row('Disk Usage', icon(diskSeverity), drawHealthBar(diskPercent, 20)))
  
  const loopColor = params.eventLoopLagMs > 200 ? 'red' : params.eventLoopLagMs > 50 ? 'yellow' : 'green'
  print(row('Event Loop', icon(loopSeverity), colorize(`${params.eventLoopLagMs}ms lag`, loopColor)))
  print(bot)
}

function buildHeuristics(input: {
  backendPid: number | null
  backendInspectPid: number | null
  backendCandidate: ProcessRecord | null
  backendMemory: ProcessMemorySnapshot | null
  backendCwd: string | null
  backendEnv: Record<string, string>
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
  workspaceMount: MountSnapshot
  shellLatencyBaselines: SpawnLatencyBaseline[]
  processActivities: ProcessActivitySample[]
  systemActivity: SystemProcessActivitySnapshot
  runtimeTrend: RuntimeTrendReport
  eventLoopLagMs: number
  fdLimits: FdLimits
  tcpStats: TcpStats
  zombieCount: number
  swap: SwapSnapshot
  dnsProbe: DnsProbeResult
  walSizeBytes: number
  appDbWalSizeBytes: number
  diskWriteLatency: FsLatencyProbe
  uvThreadpoolSize: number | null
  gitIndexSizeBytes: number | null
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
  const missingProjectPaths = input.projectSnapshots.filter((project) => !project.exists)
  const missingBaseBranch = input.projectSnapshots.reduce((sum, project) => sum + project.metaWithoutBaseBranch, 0)
  const ioPressureSome = input.ioPressure.some?.avg10 ?? 0
  const ioPressureFull = input.ioPressure.full?.avg10 ?? 0
  const correlatedP9Timeouts = input.correlationSamples.filter((sample) =>
    (!sample.healthOk || !sample.ticketsOk)
    && (sample.processWchan?.includes('p9_client_rpc') ?? false),
  ).length
  const allCorrelatedSamples = input.correlationSamples.length > 0
    && correlatedP9Timeouts === input.correlationSamples.length
  const backendWatcherOnMountedDrive = Boolean(
    input.backendCandidate?.args.includes('tsx watch server/index.ts')
    && (input.backendCwd?.startsWith('/mnt/') || input.workspaceMount.fstype === '9p'),
  )
  const backendPollingEnabled = input.backendEnv.CHOKIDAR_USEPOLLING === '1'
  const backendVmRssKb = input.backendMemory?.vmRssKb ?? 0
  const backendVmHwmKb = input.backendMemory?.vmHwmKb ?? 0
  const backendCpuPercent = input.backendCandidate?.pcpu ?? 0
  const runningNonIoBlockedSamples = input.correlationSamples.filter((sample) =>
    (sample.processStat?.includes('R') ?? false)
    && !(sample.processWchan?.includes('p9_client_rpc') ?? false),
  ).length
  const minimalBashStartupMs = input.shellLatencyBaselines.find(
    (baseline) => baseline.label === 'bash --noprofile --norc -c true',
  )?.result.durationMs
  const loginBashStartupMs = input.shellLatencyBaselines.find(
    (baseline) => baseline.label === 'bash -lc true',
  )?.result.durationMs
  const backendActivity = input.processActivities.find((sample) => sample.label === 'backend')
  const frontendActivity = input.processActivities.find((sample) => sample.label === 'frontend')
  const opencodeActivity = input.processActivities.find((sample) => sample.label === 'opencode')
  const topCpuProcess = input.systemActivity.topCpu[0]
  const topReadProcess = input.systemActivity.topReadBytes[0]
  const topWriteProcess = input.systemActivity.topWriteBytes[0]
  const trendSamples = input.runtimeTrend.enabled ? input.runtimeTrend.samples : []
  const slowTrendTickets = trendSamples.filter((sample) => !sample.tickets.ok || sample.tickets.durationMs >= 750)
  const slowTrendHealth = trendSamples.filter((sample) => !sample.health.ok || sample.health.durationMs >= 750)
  const maxTrendProcessCpu = trendSamples
    .flatMap((sample) => sample.processActivities)
    .filter((sample) => sample.cpuPercent !== null)
    .sort((left, right) => (right.cpuPercent ?? -Infinity) - (left.cpuPercent ?? -Infinity))[0]
  const maxTrendFileGrowth = trendSamples
    .flatMap((sample) => sample.files)
    .filter((sample) => (sample.sizeDeltaBytes ?? 0) > 0)
    .sort((left, right) => (right.sizeDeltaBytes ?? 0) - (left.sizeDeltaBytes ?? 0))[0]
  const maxTrendWrite = trendSamples
    .flatMap((sample) => sample.systemActivity.topWriteBytes)
    .filter((usage) => (usage.writeBytesDelta ?? 0) > 0)
    .sort((left, right) => (right.writeBytesDelta ?? 0) - (left.writeBytesDelta ?? 0))[0]
  const trendPressureSpikes = trendSamples.filter((sample) =>
    (sample.pressureDelta.ioSomeUs ?? 0) >= 50_000
    || (sample.pressureDelta.ioFullUs ?? 0) >= 10_000
    || (sample.pressureDelta.memorySomeUs ?? 0) >= 50_000
    || (sample.pressureDelta.cpuSomeUs ?? 0) >= 100_000,
  )

  if (input.backendPid === null) {
    messages.push('🚨 CRITICAL: No backend listener was found on the configured backend port. The app is likely offline.')
  }

  if (input.diskWriteLatency.durationMs > 500) {
    messages.push(`🚨 CRITICAL: Extremely slow disk write latency (${input.diskWriteLatency.durationMs}ms for 64KB). This will cause massive stalls in all file operations.`)
  } else if (input.diskWriteLatency.durationMs > 100) {
    messages.push(`⚠️ WARNING: Elevated disk write latency (${input.diskWriteLatency.durationMs}ms for 64KB). File-heavy operations like Git or SQLite WAL will be slow.`)
  }

  if (input.uvThreadpoolSize !== null && input.uvThreadpoolSize <= 4) {
    messages.push(`🔵 INFO: UV_THREADPOOL_SIZE is at default (4). Increasing this (e.g., to 16 or 32) can improve performance if many concurrent I/O or SQLite tasks are active.`)
  }

  if (input.gitIndexSizeBytes && input.gitIndexSizeBytes > 10 * 1024 * 1024) {
    messages.push(`⚠️ WARNING: Large Git index detected (${formatBytes(input.gitIndexSizeBytes)}). This can make git status calls expensive and slow down the UI refresh.`)
  }

  const competitors = input.systemActivity.topCpu.filter(p => !p.command.includes('node') && !p.command.includes('tsx') && !p.command.includes('opencode') && (p.cpuPercent ?? 0) > 30)
  if (competitors.length > 0) {
    messages.push(`⚠️ WARNING: Non-LoopTroop processes are consuming significant CPU: ${competitors.map(p => `${p.command} (${p.cpuPercent?.toFixed(1)}%)`).join(', ')}`)
  }

  if (input.backendPid === null && input.backendCandidate) {
    messages.push(`A backend candidate process was still alive (pid=${input.backendCandidate.pid}, args=${input.backendCandidate.args}). That usually means the watch wrapper survived after the actual backend server stopped listening or crashed.`)
  }

  if (input.attachedProjects.length === 0) {
    messages.push('No attached projects were found in the app DB. In that state, the UI would legitimately show no tickets.')
  }

  if (missingProjectPaths.length > 0) {
    messages.push(`The app DB still contains attached project path(s) that no longer exist on disk (${missingProjectPaths.map((project) => project.folderPath).join(', ')}). That stale attachment state should be cleaned up because it can make the UI look inconsistent after refresh.`)
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

  if (backendWatcherOnMountedDrive && backendPollingEnabled) {
    messages.push('The backend is being watched via tsx/chokidar polling on a mounted-drive path under /mnt/. That combination is expensive in WSL and can turn normal file activity into high CPU, latency spikes, or apparent hangs.')
  }

  if (input.workspaceMount.fstype === '9p') {
    messages.push('The current LoopTroop workspace itself is running from a 9p-mounted path. Even before attached projects are considered, the dev watcher stack is paying WSL mounted-drive penalties here.')
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

  if ((backendActivity?.cpuPercent ?? 0) >= 80) {
    messages.push(`During the ${backendActivity?.durationMs}ms process sample, the backend used ${formatPercent(backendActivity?.cpuPercent)} CPU. That points to backend event-loop work or synchronous processing as a direct contributor.`)
  }

  if ((frontendActivity?.cpuPercent ?? 0) >= 80) {
    messages.push(`During the ${frontendActivity?.durationMs}ms process sample, the frontend dev server used ${formatPercent(frontendActivity?.cpuPercent)} CPU. That can make Vite/HMR and page refreshes feel slow even when backend APIs answer.`)
  }

  if ((opencodeActivity?.cpuPercent ?? 0) >= 50) {
    messages.push(`During the ${opencodeActivity?.durationMs}ms process sample, OpenCode used ${formatPercent(opencodeActivity?.cpuPercent)} CPU. Active model/session work can compete with the app for local CPU.`)
  }

  if (slowTrendTickets.length > 0) {
    const worst = slowTrendTickets
      .slice()
      .sort((left, right) => right.tickets.durationMs - left.tickets.durationMs)[0]
    messages.push(`During the short trend window, /api/tickets was slow or failed in ${slowTrendTickets.length}/${trendSamples.length} sample(s); worst=${formatDuration(worst.tickets.durationMs)} status=${worst.tickets.status ?? 'n/a'} error=${worst.tickets.error ?? 'n/a'}. This is the strongest report-local signal that the UI slowdown was visible at the ticket-list API layer.`)
  }

  if (slowTrendHealth.length > 0) {
    const worst = slowTrendHealth
      .slice()
      .sort((left, right) => right.health.durationMs - left.health.durationMs)[0]
    messages.push(`During the short trend window, backend health was slow or failed in ${slowTrendHealth.length}/${trendSamples.length} sample(s); worst=${formatDuration(worst.health.durationMs)} status=${worst.health.status ?? 'n/a'} error=${worst.health.error ?? 'n/a'}. That points to a broader backend stall rather than only a heavy ticket query.`)
  }

  if ((maxTrendProcessCpu?.cpuPercent ?? 0) >= 80) {
    messages.push(`The short trend window caught a watched process CPU spike: ${maxTrendProcessCpu?.label} pid=${maxTrendProcessCpu?.pid ?? 'n/a'} at ${formatPercent(maxTrendProcessCpu?.cpuPercent)}. Check the per-sample trend lines to see whether the spike lines up with API latency.`)
  }

  if ((maxTrendFileGrowth?.sizeDeltaBytes ?? 0) >= 1024 * 1024) {
    messages.push(`A watched file grew by ${formatBytes(maxTrendFileGrowth?.sizeDeltaBytes)} inside one trend interval (${maxTrendFileGrowth?.label}). If this is an execution log or WAL, the app may be paying for fast-growing persisted runtime state during refresh.`)
  }

  if ((maxTrendWrite?.writeBytesDelta ?? 0) >= 10 * 1024 * 1024) {
    messages.push(`The short trend window caught a whole-system write spike of ${formatBytes(maxTrendWrite?.writeBytesDelta)} from pid=${maxTrendWrite?.pid}: ${maxTrendWrite?.command}. That helps identify whether LoopTroop or another local process was competing for storage.`)
  }

  if (trendPressureSpikes.length > 0) {
    messages.push(`Linux pressure-stall counters moved during ${trendPressureSpikes.length}/${trendSamples.length} trend sample(s). If API latency rose in the same samples, the slowdown likely involved scheduler, memory, or I/O pressure rather than just application code.`)
  }

  if ((backendActivity?.readBytesDelta ?? 0) + (backendActivity?.writeBytesDelta ?? 0) >= 10 * 1024 * 1024) {
    messages.push(`During the process sample, the backend performed ${formatBytes((backendActivity?.readBytesDelta ?? 0) + (backendActivity?.writeBytesDelta ?? 0))} of direct disk I/O. If API latency rose at the same time, storage work is a likely contributor.`)
  }

  if ((backendActivity?.fdCount ?? 0) >= 1024) {
    messages.push(`The backend had ${backendActivity?.fdCount} open file descriptors during the activity sample. That is high enough to check for watcher/socket/file leaks if it keeps growing across runs.`)
  }

  if (backendVmRssKb >= 1_250_000 || backendVmHwmKb >= 1_500_000) {
    messages.push(`The backend candidate process had high resident/high-water memory (VmRSS=${backendVmRssKb} KB, VmHWM=${backendVmHwmKb} KB). That is consistent with a Node heap-growth problem rather than a pure network outage.`)
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

  if (
    directDbReadable
    && input.backendPid !== null
    && backendTimedOut
    && (backendCpuPercent >= 70 || runningNonIoBlockedSamples > 0)
  ) {
    messages.push(`The backend timed out while direct DB reads still worked and the Node process looked CPU-busy (pcpu=${backendCpuPercent}, running_samples=${runningNonIoBlockedSamples}/${input.correlationSamples.length}). That pattern is consistent with an event-loop hot loop or recursive internal work, not missing tickets or broken SQLite state.`)
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

  if ((topCpuProcess?.cpuPercent ?? 0) >= 50) {
    messages.push(`The top whole-system CPU consumer during the sample was pid=${topCpuProcess?.pid} at ${formatPercent(topCpuProcess?.cpuPercent)}: ${topCpuProcess?.command}. This helps separate LoopTroop slowness from other local workload.`)
  }

  if ((topReadProcess?.readBytesDelta ?? 0) >= 10 * 1024 * 1024) {
    messages.push(`The top whole-system read I/O consumer during the sample was pid=${topReadProcess?.pid}, reading ${formatBytes(topReadProcess?.readBytesDelta)}: ${topReadProcess?.command}.`)
  }

  if ((topWriteProcess?.writeBytesDelta ?? 0) >= 10 * 1024 * 1024) {
    messages.push(`The top whole-system write I/O consumer during the sample was pid=${topWriteProcess?.pid}, writing ${formatBytes(topWriteProcess?.writeBytesDelta)}: ${topWriteProcess?.command}.`)
  }

  if (
    loginBashStartupMs !== undefined
    && loginBashStartupMs >= 250
    && (minimalBashStartupMs === undefined || minimalBashStartupMs * 3 < loginBashStartupMs)
  ) {
    messages.push(`Login-shell startup is slow (bash -lc true took ${loginBashStartupMs}ms). If older reports show shell command durations around this size while Git Trace2 or direct probes are fast, that latency is shell initialization overhead, not app/file-system work.`)
  }

  if (input.eventLoopLagMs > 200) {
    messages.push(`The diagnostic script itself measured a Node.js event-loop lag of ${input.eventLoopLagMs}ms. That indicates the Node process (or the machine) is overloaded enough that even setTimeout/setImmediate delivery is delayed.`)
  } else if (input.eventLoopLagMs > 50) {
    messages.push(`Moderate event-loop lag (${input.eventLoopLagMs}ms) was observed during the diagnostic run. If this matches symptom timing, Node is competing for CPU or doing heavy synchronous work.`)
  }

  if (!input.dnsProbe.ok) {
    messages.push(`DNS resolution of 'localhost' failed (${input.dnsProbe.error}). That could prevent the backend, frontend, and OpenCode from finding each other on the loopback interface—especially after WSL network resets.`)
  }

  if (input.fdLimits.soft !== null && (input.backendMemory?.fdSize ?? 0) > 0) {
    const ratio = (input.backendMemory?.fdSize ?? 0) / input.fdLimits.soft
    if (ratio >= 0.9) {
      messages.push(`The backend is using ${input.backendMemory?.fdSize} file descriptors against a soft limit of ${input.fdLimits.soft} (${(ratio * 100).toFixed(0)}%). Approaching this limit causes EMFILE errors and can stall all I/O.`)
    } else if (ratio >= 0.7) {
      messages.push(`The backend has ${input.backendMemory?.fdSize} open file descriptors with a soft limit of ${input.fdLimits.soft}. Worth monitoring—it could become a problem if the count grows.`)
    }
  }

  if (input.tcpStats.timeWait > 1000) {
    messages.push(`There were ${input.tcpStats.timeWait} TCP connections in TIME_WAIT state. Extreme TIME_WAIT accumulation can exhaust local port range and block new connections.`)
  }

  if (input.zombieCount > 0) {
    messages.push(`${input.zombieCount} zombie process(es) detected. While zombies consume little, they indicate a parent process is not reaping children—often a sign of an unhealthy process tree around the app.`)
  }

  const swapPercent = input.swap.usePercent ?? 0
  if (swapPercent >= 80) {
    messages.push(`Swap usage is at ${swapPercent}%. Heavy swap activity dramatically increases I/O latency across all subsystems and is a common cause of intermittent stalls.`)
  } else if (swapPercent >= 50) {
    messages.push(`Swap is ${swapPercent}% used. If the app is stalling intermittently, this is worth watching—swap growth under memory pressure can compound into I/O stalls.`)
  }

  if (input.walSizeBytes >= 50 * 1024 * 1024) {
    messages.push(`A project WAL file is ${formatBytes(input.walSizeBytes)} — very large. An uncheckpointed WAL of this size forces SQLite to scan the whole file on each read, multiplying query latency.`)
  } else if (input.walSizeBytes >= 10 * 1024 * 1024) {
    messages.push(`A project WAL file is ${formatBytes(input.walSizeBytes)}. SQLite reads become slower as the WAL grows. A checkpoint may be overdue.`)
  }

  if (input.appDbWalSizeBytes >= 10 * 1024 * 1024) {
    messages.push(`The app DB WAL file is ${formatBytes(input.appDbWalSizeBytes)}. That can slow every attached-project query the backend makes during a refresh.`)
  }

  if (messages.length === 0) {
    messages.push('No single smoking gun was found. The report still captures process, DB, and network state so you can compare it against a healthy run.')
  }

  return messages
}

async function main() {
  const platform = detectPlatform()

  banner('🩺  LoopTroop Runtime Stall Diagnostics')
  kv('Started at', startedAt.toISOString())
  kv('Working directory', process.cwd())
  kv('Node version', process.version)
  kv('Platform', `${platform} (${process.platform} ${process.arch})`)
  kv('WSL distro', process.env.WSL_DISTRO_NAME ?? 'n/a')
  kv('CLI options', cli)

  // Collect advanced diagnostics early (needed for Quick Summary)
  const [eventLoopLagMs, dnsProbe] = await Promise.all([
    measureEventLoopLag(),
    probeDns('localhost'),
  ])
  const fdLimits = readFdLimits()
  const tcpStats = readTcpStats()
  const zombieCount = countZombieProcesses()
  const heap = readDiagnosticProcessHeap()
  const swap = readSwapSnapshot()
  const macosMetrics = collectMacosSystemMetrics()

  const defaultEnv: Record<string, string> = {
    HOME: process.env.HOME ?? homedir(),
    ...(process.env.XDG_CONFIG_HOME ? { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME } : {}),
    ...(process.env.LOOPTROOP_CONFIG_DIR ? { LOOPTROOP_CONFIG_DIR: process.env.LOOPTROOP_CONFIG_DIR } : {}),
    ...(process.env.LOOPTROOP_APP_DB_PATH ? { LOOPTROOP_APP_DB_PATH: process.env.LOOPTROOP_APP_DB_PATH } : {}),
  }

  const backendPort = cli.backendPort
    ?? Number(process.env.LOOPTROOP_BACKEND_PORT || 3000)

  const processRecords = listProcessRecords()
  const backendPid = findListeningPid(backendPort)
  const backendCandidate = findFirstProcessMatch(processRecords, [
    /tsx watch server\/index\.ts/,
    /node .*tsx.*watch server\/index\.ts/,
    /npm run dev:backend/,
    /server\/index\.ts/,
  ])
  const frontendCandidate = findFirstProcessMatch(processRecords, [
    /node .*\/vite\b/,
    /\b vite\b/,
    /npm run dev:frontend/,
  ])
  const opencodeCandidate = findFirstProcessMatch(processRecords, [
    /\bopencode serve\b/,
    /tsx scripts\/dev-opencode\.ts/,
    /npm run dev:opencode/,
  ])
  const backendInspectPid = backendPid ?? backendCandidate?.pid ?? null
  const backendEnv = backendInspectPid ? readProcessEnv(backendInspectPid) : {}
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
  const sampleMs = Number.isFinite(cli.sampleMs) && (cli.sampleMs ?? 0) > 0 ? cli.sampleMs! : 1000
  const trendMs = Number.isFinite(cli.trendMs) ? Math.max(0, Math.floor(cli.trendMs!)) : 5000
  const trendIntervalMs = Number.isFinite(cli.trendIntervalMs) && (cli.trendIntervalMs ?? 0) > 0
    ? Math.floor(cli.trendIntervalMs!)
    : 1000
  const appDbPath = resolveAppDbPath(effectiveEnv)
  const frontendPid = findListeningPid(effectiveFrontendPort)
  const opencodePort = parseLocalPortFromUrl(effectiveOpenCodeUrl)
  const opencodePid = opencodePort ? findListeningPid(opencodePort) : null
  const frontendInspectPid = frontendPid ?? frontendCandidate?.pid ?? null
  const opencodeInspectPid = opencodePid ?? opencodeCandidate?.pid ?? null
  const watchedProcessTargets = [
    { label: 'backend', pid: backendInspectPid },
    { label: 'frontend', pid: frontendInspectPid },
    { label: 'opencode', pid: opencodeInspectPid },
  ]
  const backendCwd = backendInspectPid ? readProcessCwd(backendInspectPid) : null
  const frontendCwd = frontendInspectPid ? readProcessCwd(frontendInspectPid) : null
  const opencodeCwd = opencodeInspectPid ? readProcessCwd(opencodeInspectPid) : null
  const backendMemorySnapshot = backendInspectPid ? readProcessMemorySnapshot(backendInspectPid) : null
  const frontendMemorySnapshot = frontendInspectPid ? readProcessMemorySnapshot(frontendInspectPid) : null
  const opencodeMemorySnapshot = opencodeInspectPid ? readProcessMemorySnapshot(opencodeInspectPid) : null
  const workspaceMount = inspectMount(process.cwd())
  const workspaceDiskUsage = inspectDiskUsage(process.cwd())
  const workspaceInodeUsage = inspectInodeUsage(process.cwd())
  const appDbMount = inspectMount(appDbPath)
  const appDbDiskUsage = inspectDiskUsage(appDbPath)
  const appDbInodeUsage = inspectInodeUsage(appDbPath)
  const shellLatencyBaselines = collectShellLatencyBaselines()
  const appDbLatency = [
    measureFsLatency('stat app db', () => {
      const stats = statSync(appDbPath)
      return `size=${stats.size} mtime=${stats.mtime.toISOString()}`
    }),
    measureFsLatency('read app db header', () => {
      const buffer = readFileSync(appDbPath)
      return `header=${buffer.subarray(0, 16).toString('utf8').replace(/\0/g, '\\0')}`
    }),
    measureDiskWriteLatency(process.cwd()),
  ]
  const diskWriteLatency = appDbLatency[appDbLatency.length - 1] as FsLatencyProbe
  const gitIndexPath = resolve(process.cwd(), '.git', 'index')
  const gitIndexSizeBytes = existsSync(gitIndexPath) ? statSync(gitIndexPath).size : null
  const appDbInspection = inspectAppDatabase(appDbPath)
  const projectSnapshots = appDbInspection.attachedProjects.map(inspectProjectDatabase)

  const ioPressure = inspectPressureFile('/proc/pressure/io')
  const memoryPressure = inspectPressureFile('/proc/pressure/memory')
  const cpuPressure = inspectPressureFile('/proc/pressure/cpu')

  const frontendUrl = `http://localhost:${effectiveFrontendPort}`
  const backendHealthUrl = `http://localhost:${effectiveBackendPort}/api/health`
  const backendStartupUrl = `http://localhost:${effectiveBackendPort}/api/health/startup`
  const projectsUrl = `http://localhost:${effectiveBackendPort}/api/projects`
  const ticketsUrl = `http://localhost:${effectiveBackendPort}/api/tickets`
  const opencodeHealthUrl = `http://localhost:${effectiveBackendPort}/api/health/opencode`
  const trendProbeTimeoutMs = Math.min(timeoutMs, Math.max(500, Math.floor(trendIntervalMs * 0.8)))

  const frontendProbe = await probeHttp('frontend root', frontendUrl, timeoutMs)
  const healthProbe = await probeHttp('backend health', backendHealthUrl, timeoutMs)
  const startupProbe = await probeHttp('backend startup status', backendStartupUrl, timeoutMs)
  const projectsProbe = await probeHttp('projects list', projectsUrl, timeoutMs)
  const ticketsProbe = await probeHttp('tickets list', ticketsUrl, timeoutMs)
  const opencodeProbe = await probeHttp('backend OpenCode health', opencodeHealthUrl, timeoutMs)
  const correlationSamples = await sampleRuntimeCorrelation({
    backendPid: backendInspectPid,
    backendHealthUrl,
    ticketsUrl,
    iterations: 5,
    intervalMs: 700,
    probeTimeoutMs: 900,
  })
  const runtimeTrend = await sampleRuntimeTrend({
    durationMs: trendMs,
    intervalMs: trendIntervalMs,
    backendHealthUrl,
    ticketsUrl,
    probeTimeoutMs: trendProbeTimeoutMs,
    processTargets: watchedProcessTargets,
    fileTargets: buildTrendFileTargets(appDbPath, projectSnapshots),
  })
  const [processActivities, systemActivity] = await Promise.all([
    sampleProcessActivities(watchedProcessTargets, sampleMs),
    sampleSystemProcessActivity(sampleMs),
  ])

  // Quick Summary (shown after all data is collected)
  printQuickSummary({
    backendPid,
    frontendPid,
    opencodePid,
    healthProbe,
    frontendProbe,
    opencodeProbe,
    ioPressure,
    workspaceDiskUsage,
    platform,
    eventLoopLagMs,
  })

  banner('🔍  ENVIRONMENT & CONFIGURATION')
  heading('Resolved Runtime Configuration')
  kv('Backend port', effectiveBackendPort)
  kv('Frontend port', effectiveFrontendPort)
  kv('OpenCode URL', effectiveOpenCodeUrl)
  kv('HTTP probe timeout', timeoutMs)
  kv('Process activity sample window', formatDuration(sampleMs))
  kv('Trend sample window', formatDuration(trendMs))
  kv('Trend sample interval', formatDuration(trendIntervalMs))
  kv('Trend HTTP probe timeout', formatDuration(trendProbeTimeoutMs))
  kv('Detected backend listener PID', backendPid)
  kv('Detected backend candidate PID', backendCandidate?.pid ?? 'n/a')
  kv('Backend inspect PID', backendInspectPid)
  kv('Detected frontend listener PID', frontendPid)
  kv('Detected frontend candidate PID', frontendCandidate?.pid ?? 'n/a')
  kv('Frontend inspect PID', frontendInspectPid)
  kv('Detected OpenCode listener PID', opencodePid)
  kv('Detected OpenCode candidate PID', opencodeCandidate?.pid ?? 'n/a')
  kv('OpenCode inspect PID', opencodeInspectPid)
  kv('Detected backend cwd', backendCwd ?? 'n/a')
  kv('Detected frontend cwd', frontendCwd ?? 'n/a')
  kv('Detected OpenCode cwd', opencodeCwd ?? 'n/a')
  kv('Resolved app DB path', appDbPath)

  printShellLatencyBaselines(shellLatencyBaselines)

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
      'CHOKIDAR_USEPOLLING',
      'NODE_OPTIONS',
      'npm_lifecycle_script',
    ]) {
      kv(key, backendEnv[key] ?? 'n/a')
    }
  }

  banner('🌐  NETWORK & ENDPOINT HEALTH')
  printHttpProbe(frontendProbe)
  printHttpProbe(healthProbe)
  printHttpProbe(startupProbe)
  printHttpProbe(projectsProbe)
  printHttpProbe(ticketsProbe)
  printHttpProbe(opencodeProbe)

  banner('🔁  STALL CORRELATION SAMPLES')
  printCorrelationSamples('Backend Stall Correlation Samples', correlationSamples)
  printRuntimeTrendReport('Short Window Runtime Trend', runtimeTrend)

  banner('⚙️   APPLICATION PROCESS ACTIVITY')
  printProcessCandidate('Backend Candidate Process', backendCandidate)
  printProcessCandidate('Frontend Candidate Process', frontendCandidate)
  printProcessCandidate('OpenCode Candidate Process', opencodeCandidate)
  printProcessMemorySnapshot('Backend Memory Snapshot', backendMemorySnapshot)
  printProcessMemorySnapshot('Frontend Memory Snapshot', frontendMemorySnapshot)
  printProcessMemorySnapshot('OpenCode Memory Snapshot', opencodeMemorySnapshot)
  printProcessActivitySamples('LoopTroop Process Activity Sample', processActivities)
  printSystemProcessActivitySnapshot('System Resource Consumers During Sample', systemActivity)

  if (backendInspectPid) {
    const backendPs = runShell(`ps -p ${backendInspectPid} -o pid,ppid,etime,pcpu,pmem,stat,wchan:32,args`, 5000)
    printCommandResult(`Backend Process ${backendInspectPid}`, backendPs)

    const backendThreads = runShell(`ps -L -p ${backendInspectPid} -o pid,tid,pcpu,stat,wchan:32,comm`, 5000)
    printCommandResult(`Backend Threads ${backendInspectPid}`, backendThreads)
    printProcessIoSnapshot(`Backend /proc/${backendInspectPid}/io`, readProcessIo(backendInspectPid))

    if (commandExists('lsof')) {
      const backendFiles = runShell(
        `lsof -p ${backendInspectPid} | grep -E "app\\.sqlite|db\\.sqlite|sqlite|looptroop|\\.git|wal|shm" || true`,
        5000,
      )
      printCommandResult(`Backend Open Files ${backendInspectPid}`, backendFiles)
    }
  }

  if (frontendInspectPid) {
    printProcessIoSnapshot(`Frontend /proc/${frontendInspectPid}/io`, readProcessIo(frontendInspectPid))
  }

  if (opencodeInspectPid) {
    printProcessIoSnapshot(`OpenCode /proc/${opencodeInspectPid}/io`, readProcessIo(opencodeInspectPid))
  }

  const relevantProcessList = runShell(
    `ps -eo pid,ppid,etime,pcpu,pmem,args --sort=pid | grep -E "vite|server/index.ts|dev-opencode|opencode serve|npm run dev|tsx watch server/index.ts|tsx scripts/dev.ts|tsx scripts/dev-backend.ts" | grep -v grep`,
    5000,
  )
  printCommandResult('Relevant Process List', relevantProcessList)

  if (commandExists('ss')) {
    const listeners = runShell(`ss -ltnp | grep -E ":${effectiveFrontendPort}|:${effectiveBackendPort}|4096|4097" || true`, 5000)
    printCommandResult('Listener Snapshot', listeners)
  }

  banner('💻  SYSTEM RESOURCES')
  printPressureSnapshot('I/O Pressure Snapshot', ioPressure)
  printPressureSnapshot('Memory Pressure Snapshot', memoryPressure)
  printPressureSnapshot('CPU Pressure Snapshot', cpuPressure)
  printCgroupResourceSnapshot()

  const uptimeResult = runShell('uptime', 3000)
  printCommandResult('System Uptime', uptimeResult)

  const loadavgResult = runShell('cat /proc/loadavg', 2000)
  printCommandResult('Load Average Raw', loadavgResult)

  const freeResult = runShell('free -h', 3000)
  printCommandResult('Memory Snapshot', freeResult)

  const topCpuResult = runShell(`ps -eo pid,ppid,etime,pcpu,pmem,rss,args --sort=-pcpu | head -n 20`, 5000)
  printCommandResult('Top CPU Processes Snapshot', topCpuResult)

  const topRssResult = runShell(`ps -eo pid,ppid,etime,pcpu,pmem,rss,args --sort=-rss | head -n 20`, 5000)
  printCommandResult('Top RSS Processes Snapshot', topRssResult)

  const meminfoResult = runShell(`grep -E 'MemTotal|MemAvailable|SwapTotal|SwapFree|Dirty|Writeback|Cached' /proc/meminfo || true`, 2000)
  printCommandResult('Key /proc/meminfo Fields', meminfoResult)

  if (commandExists('dmesg')) {
    const dmesgOomResult = runShell(`dmesg -T 2>/dev/null | grep -Ei 'out of memory|killed process|oom' | tail -n 40 || true`, 5000)
    printCommandResult('Kernel OOM Scan', dmesgOomResult)
  }

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

  banner('💾  STORAGE, MOUNTS & FILESYSTEM')
  printMountSnapshot('Workspace Mount Snapshot', workspaceMount)
  printDiskUsageSnapshot('Workspace Disk Usage', workspaceDiskUsage)
  printInodeUsageSnapshot('Workspace Inode Usage', workspaceInodeUsage)
  printMountSnapshot('App DB Mount Snapshot', appDbMount)
  printDiskUsageSnapshot('App DB Disk Usage', appDbDiskUsage)
  printInodeUsageSnapshot('App DB Inode Usage', appDbInodeUsage)
  printLatencyProbes('App DB Filesystem Latency Probes', appDbLatency)

  banner('🗄️   DATABASE & PROJECT STATE')
  printFileStats('App DB File Stats', appDbPath)
  printFileStats('App DB WAL Stats', `${appDbPath}-wal`)
  printFileStats('App DB SHM Stats', `${appDbPath}-shm`)

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
  }

  banner('🔀  GIT RESPONSIVENESS')
  for (const project of projectSnapshots) {
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

  printAdvancedDiagnostics({ eventLoopLagMs, dnsProbe, fdLimits, tcpStats, zombieCount, heap, swap, macosMetrics })

  const walSizeBytes = projectSnapshots.reduce((max, project) => {
    const walPath = `${project.projectDbPath}-wal`
    try { return Math.max(max, existsSync(walPath) ? statSync(walPath).size : 0) } catch { return max }
  }, 0)
  const appDbWalPath = `${appDbPath}-wal`
  const appDbWalSizeBytes = (() => {
    try { return existsSync(appDbWalPath) ? statSync(appDbWalPath).size : 0 } catch { return 0 }
  })()

  const uvThreadpoolSize = backendEnv.UV_THREADPOOL_SIZE ? Number(backendEnv.UV_THREADPOOL_SIZE) : null

  const heuristics = buildHeuristics({
    backendPid,
    backendInspectPid,
    backendCandidate,
    backendMemory: backendMemorySnapshot,
    backendCwd,
    backendEnv,
    backendThreadDump: backendInspectPid ? runShell(`ps -L -p ${backendInspectPid} -o pid,tid,pcpu,stat,wchan:32,comm`, 5000).stdout : '',
    frontendProbe,
    healthProbe,
    ticketsProbe,
    opencodeProbe,
    attachedProjects: appDbInspection.attachedProjects,
    projectSnapshots,
    ioPressure,
    backendIo: backendInspectPid ? readProcessIo(backendInspectPid) : null,
    correlationSamples,
    workspaceMount,
    shellLatencyBaselines,
    processActivities,
    systemActivity,
    runtimeTrend,
    eventLoopLagMs,
    fdLimits,
    tcpStats,
    zombieCount,
    swap,
    dnsProbe,
    walSizeBytes,
    appDbWalSizeBytes,
    diskWriteLatency,
    uvThreadpoolSize,
    gitIndexSizeBytes,
  })

  printRiskAssessment(heuristics)

  heading('Report Saved')
  kv('Path', reportPath)
  kv('Finished at', new Date().toISOString())
  print()
  print('Run this again during the next outage and compare the "Likely Causes" plus the backend candidate/memory/thread sections.')

  mkdirSync(reportDir, { recursive: true })
  writeFileSync(reportPath, `${reportLines.join('\n')}\n`, 'utf8')
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

await main()
