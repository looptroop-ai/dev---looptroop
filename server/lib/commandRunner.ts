import { exec } from 'node:child_process'

export interface CommandExecutionResult {
  command: string
  exitCode: number | null
  stdout: string
  stderr: string
  durationMs: number
  timedOut: boolean
  signal: NodeJS.Signals | null
  error?: string
}

export async function runShellCommand(
  command: string,
  options: {
    cwd: string
    signal?: AbortSignal
    timeoutMs?: number
  },
): Promise<CommandExecutionResult> {
  const startedAt = Date.now()

  return await new Promise<CommandExecutionResult>((resolve, reject) => {
    const child = exec(command, {
      cwd: options.cwd,
      env: process.env,
      shell: '/bin/bash',
      timeout: options.timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      ...(options.signal ? { signal: options.signal } : {}),
    }, (error, stdout, stderr) => {
      const durationMs = Date.now() - startedAt

      if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        reject(error)
        return
      }

      if (!error) {
        resolve({
          command,
          exitCode: 0,
          stdout,
          stderr,
          durationMs,
          timedOut: false,
          signal: null,
        })
        return
      }

      const processError = error as Error & {
        code?: number | string | null
        signal?: NodeJS.Signals | null
        killed?: boolean
      }
      const timedOut = Boolean(processError.killed) && processError.message.toLowerCase().includes('timed out')
      resolve({
        command,
        exitCode: typeof processError.code === 'number' ? processError.code : null,
        stdout,
        stderr,
        durationMs,
        timedOut,
        signal: processError.signal ?? null,
        error: processError.message,
      })
    })

    options.signal?.addEventListener('abort', () => {
      child.kill('SIGTERM')
    }, { once: true })
  })
}

