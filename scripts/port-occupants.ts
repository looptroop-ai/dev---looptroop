import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { basename } from 'node:path'

const MAX_DISPLAY_OCCUPANTS = 2
const MAX_COMMAND_LENGTH = 88

export type PortOccupantInfo = {
  pid: number | null
  ppid: number | null
  program: string | null
  command: string | null
  cwd: string | null
  source: 'lsof' | 'ss'
}

export type PortOccupantInspection = {
  port: number
  occupants: PortOccupantInfo[]
  rawSocketSnapshot: string | null
}

type PortInspectorDeps = {
  readCwd: (pid: number) => string | null
  runCommand: (file: string, args: string[]) => string | null
}

function createDefaultDeps(): PortInspectorDeps {
  return {
    readCwd: (pid) => {
      try {
        return realpathSync(`/proc/${pid}/cwd`)
      } catch {
        return null
      }
    },
    runCommand: (file, args) => {
      try {
        return execFileSync(file, args, { encoding: 'utf8' }).trimEnd()
      } catch {
        return null
      }
    },
  }
}

function parseInteger(value: string | undefined) {
  if (!value) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function normalizeCommand(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, ' ') || null
}

function normalizeSocketSnapshot(output: string | null) {
  if (!output) return null

  const lines = output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)

  return lines.length > 1 ? lines.join('\n') : null
}

function parseLsofOccupants(output: string | null): PortOccupantInfo[] {
  if (!output) return []

  const occupants: PortOccupantInfo[] = []

  for (const line of output.split('\n').slice(1)) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const match = trimmed.match(/^(\S+)\s+(\d+)\s+/)
    if (!match) continue

    occupants.push({
      pid: parseInteger(match[2]),
      ppid: null,
      program: match[1] ?? null,
      command: match[1] ?? null,
      cwd: null,
      source: 'lsof',
    })
  }

  return occupants
}

function parseSsOccupants(output: string | null): PortOccupantInfo[] {
  if (!output) return []

  const occupants: PortOccupantInfo[] = []

  for (const line of output.split('\n')) {
    for (const match of line.matchAll(/\("([^"]+)",pid=(\d+)/g)) {
      occupants.push({
        pid: parseInteger(match[2]),
        ppid: null,
        program: match[1] ?? null,
        command: match[1] ?? null,
        cwd: null,
        source: 'ss',
      })
    }
  }

  return occupants
}

function dedupeByPid(occupants: PortOccupantInfo[]) {
  const unique = new Map<number, PortOccupantInfo>()

  for (const occupant of occupants) {
    if (!occupant.pid) continue
    if (!unique.has(occupant.pid)) {
      unique.set(occupant.pid, occupant)
    }
  }

  return [...unique.values()]
}

function enrichOccupant(occupant: PortOccupantInfo, deps: PortInspectorDeps): PortOccupantInfo {
  if (!occupant.pid) {
    return occupant
  }

  const psOutput = deps.runCommand('ps', ['-p', String(occupant.pid), '-o', 'pid=,ppid=,comm=,args='])
  const psLine = psOutput
    ?.split('\n')
    .map((line) => line.trim())
    .find(Boolean)

  const match = psLine?.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/)

  return {
    pid: occupant.pid,
    ppid: parseInteger(match?.[2]) ?? occupant.ppid,
    program: match?.[3] ?? occupant.program,
    command: normalizeCommand(match?.[4]) ?? occupant.command,
    cwd: deps.readCwd(occupant.pid),
    source: occupant.source,
  }
}

function shortenMiddle(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value
  }

  const segmentLength = Math.max(8, Math.floor((maxLength - 3) / 2))
  return `${value.slice(0, segmentLength)}...${value.slice(-segmentLength)}`
}

function compactCommand(command: string | null) {
  const normalized = normalizeCommand(command)
  if (!normalized) return null

  const match = normalized.match(/^(\S+)(.*)$/)
  if (!match) {
    return shortenMiddle(normalized, MAX_COMMAND_LENGTH)
  }

  const firstToken = match[1] ?? ''
  const rest = match[2] ?? ''
  const compactFirstToken = firstToken.includes('/') ? basename(firstToken) : firstToken

  return shortenMiddle(`${compactFirstToken}${rest}`, MAX_COMMAND_LENGTH)
}

function compactPath(cwd: string | null) {
  if (!cwd) return null

  const normalized = cwd.trim()
  return normalized || null
}

function inferProgramName(program: string | null | undefined, command: string | null | undefined) {
  if (program?.trim()) {
    return program.trim()
  }

  const normalizedCommand = normalizeCommand(command)
  if (!normalizedCommand) return null

  const firstToken = normalizedCommand.match(/^(\S+)/)?.[1]
  if (!firstToken) return null

  return firstToken.includes('/') ? basename(firstToken) : firstToken
}

export function inspectPortOccupants(
  port: number,
  providedDeps?: Partial<PortInspectorDeps>,
): PortOccupantInspection {
  const deps = {
    ...createDefaultDeps(),
    ...providedDeps,
  }

  const lsofOutput = deps.runCommand('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'])
  const rawSocketSnapshot = normalizeSocketSnapshot(
    deps.runCommand('ss', ['-ltnp', `( sport = :${port} )`]),
  )

  const discoveredOccupants = parseLsofOccupants(lsofOutput)
  const occupants = dedupeByPid(
    discoveredOccupants.length > 0 ? discoveredOccupants : parseSsOccupants(rawSocketSnapshot),
  ).map((occupant) => enrichOccupant(occupant, deps))

  return {
    port,
    occupants,
    rawSocketSnapshot,
  }
}

export function listPortOccupantPids(
  port: number,
  providedDeps?: Partial<PortInspectorDeps>,
) {
  return inspectPortOccupants(port, providedDeps)
    .occupants
    .map((occupant) => occupant.pid)
    .filter((pid): pid is number => Number.isInteger(pid) && pid > 0)
}

type PortOccupantSummaryInput = {
  pid?: number | null
  program?: string | null
  command?: string | null
  cwd?: string | null
}

export function formatPortOccupantSummary(input: PortOccupantSummaryInput) {
  const pid = parseInteger(String(input.pid ?? ''))
  const program = inferProgramName(input.program ?? null, input.command ?? null)
  const compactedCommand = compactCommand(input.command ?? null)
  const compactedCwd = compactPath(input.cwd ?? null)
  const details: string[] = []

  if (pid) {
    details.push(`pid ${pid}`)
  }

  if (compactedCommand && compactedCommand !== program) {
    details.push(`cmd: ${compactedCommand}`)
  }

  if (compactedCwd) {
    details.push(`cwd: ${compactedCwd}`)
  }

  if (!program && pid) {
    return details.join(', ')
  }

  if (!program) {
    return null
  }

  if (details.length === 0) {
    return program
  }

  return `${program} (${details.join(', ')})`
}

export function formatPortOccupantLabel(occupants: readonly PortOccupantSummaryInput[]) {
  const formatted = occupants
    .map((occupant) => formatPortOccupantSummary(occupant))
    .filter((summary): summary is string => Boolean(summary))

  if (formatted.length === 0) {
    return null
  }

  const visible = formatted.slice(0, MAX_DISPLAY_OCCUPANTS)
  const remainder = formatted.length - visible.length
  const noun = formatted.length === 1 ? 'Occupant' : 'Occupants'
  const moreSuffix = remainder > 0 ? ` (+${remainder} more)` : ''

  return `${noun}: ${visible.join('; ')}${moreSuffix}.`
}

export function appendPortOccupantDetails(
  message: string,
  occupants: readonly PortOccupantSummaryInput[],
) {
  const label = formatPortOccupantLabel(occupants)
  return label ? `${message} ${label}` : message
}

export function describePortOccupants(
  port: number,
  inspection = inspectPortOccupants(port),
) {
  return appendPortOccupantDetails(
    `Port ${port} is in use by another process.`,
    inspection.occupants,
  )
}
