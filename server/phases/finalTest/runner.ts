import { spawn } from 'node:child_process'
import { FORCE_KILL_DELAY_MS } from '../../lib/constants'

export interface FinalTestCommandResult {
  command: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  durationMs: number
  timedOut: boolean
}

export interface FinalTestExecutionReport {
  status: 'passed' | 'failed'
  passed: boolean
  checkedAt: string
  plannedBy: string
  summary?: string
  modelOutput: string
  commands: FinalTestCommandResult[]
  errors: string[]
}

async function runCommand(
  command: string,
  cwd: string,
  timeoutMs?: number,
): Promise<FinalTestCommandResult> {
  const startedAt = Date.now()
  return await new Promise<FinalTestCommandResult>((resolve) => {
    const child = spawn('/bin/bash', ['-lc', command], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return
      settled = true
      if (timeoutHandle) clearTimeout(timeoutHandle)
      resolve({
        command,
        exitCode,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
      })
    }

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      stderr += error.message
      finish(null, null)
    })
    child.on('close', (exitCode, signal) => {
      finish(exitCode, signal)
    })

    if (timeoutMs && timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), FORCE_KILL_DELAY_MS).unref()
      }, timeoutMs)
    }
  })
}

export async function executeFinalTestCommands(input: {
  commands: string[]
  cwd: string
  timeoutMs?: number
  plannedBy: string
  summary?: string
  modelOutput: string
}): Promise<FinalTestExecutionReport> {
  const commandResults: FinalTestCommandResult[] = []
  const errors: string[] = []

  for (const command of input.commands) {
    const result = await runCommand(command, input.cwd, input.timeoutMs)
    commandResults.push(result)
    if (result.exitCode !== 0 || result.timedOut) {
      errors.push(result.timedOut
        ? `Command timed out: ${command}`
        : `Command failed (${result.exitCode ?? 'no exit code'}): ${command}`)
      break
    }
  }

  const passed = errors.length === 0 && input.commands.length > 0
  return {
    status: passed ? 'passed' : 'failed',
    passed,
    checkedAt: new Date().toISOString(),
    plannedBy: input.plannedBy,
    summary: input.summary,
    modelOutput: input.modelOutput,
    commands: commandResults,
    errors,
  }
}
