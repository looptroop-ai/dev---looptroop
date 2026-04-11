import { spawn } from 'node:child_process'
import { FORCE_KILL_DELAY_MS } from '../../lib/constants'
import type { StructuredOutputMetadata } from '../../structuredOutput/types'

import { createRequire } from 'node:module'
const _require = createRequire(import.meta.url)

// Lazy-load commandLogger to avoid vitest mock-resolution deadlock.
function logCmd(bin: string, args: string[], result: { ok: true; stdout?: string; stderr?: string } | { ok: false; error: string }) {
  try {
    const { logCommand } = _require('../../log/commandLogger') as typeof import('../../log/commandLogger')
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

export interface FinalTestAttemptHistoryEntry {
  attempt: number
  status: 'passed' | 'failed'
  checkedAt: string
  summary?: string
  commands: string[]
  testFiles: string[]
  modifiedFiles: string[]
  errors: string[]
  failureReason?: string
  noteAppended?: string
}

export interface FinalTestExecutionReport {
  status: 'passed' | 'failed'
  passed: boolean
  checkedAt: string
  plannedBy: string
  summary?: string
  testFiles: string[]
  modifiedFiles: string[]
  testsCount: number | null
  modelOutput: string
  commands: FinalTestCommandResult[]
  errors: string[]
  planStructuredOutput?: StructuredOutputMetadata
  attempt?: number
  maxIterations?: number | null
  attemptHistory?: FinalTestAttemptHistoryEntry[]
  retryNotes?: string[]
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
  testFiles?: string[]
  modifiedFiles?: string[]
  testsCount?: number | null
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
    testFiles: input.testFiles ?? [],
    modifiedFiles: input.modifiedFiles ?? input.testFiles ?? [],
    testsCount: input.testsCount ?? null,
    modelOutput: input.modelOutput,
    commands: commandResults,
    errors,
    ...(input.planStructuredOutput ? { planStructuredOutput: input.planStructuredOutput } : {}),
  }
}
