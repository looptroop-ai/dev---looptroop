import { spawn } from 'node:child_process'
import { FORCE_KILL_DELAY_MS } from '../../lib/constants'
import type { StructuredOutputMetadata } from '../../structuredOutput/types'

// Lazy-load commandLogger to avoid vitest mock-resolution deadlock.
function logCmd(bin: string, args: string[], result: { ok: true; stdout?: string } | { ok: false; error: string }) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { logCommand } = require('../../log/commandLogger') as typeof import('../../log/commandLogger')
    logCommand(bin, args, result)
  } catch {
    // Silently ignore if commandLogger can't be loaded.
  }
}

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
  planStructuredOutput?: StructuredOutputMetadata
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
  planStructuredOutput?: StructuredOutputMetadata
}): Promise<FinalTestExecutionReport> {
  const commandResults: FinalTestCommandResult[] = []
  const errors: string[] = []

  for (const command of input.commands) {
    const result = await runCommand(command, input.cwd, input.timeoutMs)
    commandResults.push(result)

    // Log the command execution to SYS
    const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    if (result.exitCode === 0 && !result.timedOut) {
      logCmd('/bin/bash', ['-lc', command], { ok: true, stdout: combinedOutput || undefined })
    } else {
      const errDetail = result.timedOut
        ? `timed out after ${result.durationMs}ms`
        : `exit code ${result.exitCode ?? 'unknown'}`
      logCmd('/bin/bash', ['-lc', command], { ok: false, error: combinedOutput ? `${errDetail}\n${combinedOutput}` : errDetail })
    }

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
    ...(input.planStructuredOutput ? { planStructuredOutput: input.planStructuredOutput } : {}),
  }
}
