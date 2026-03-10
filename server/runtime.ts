import { isMainThread, threadId } from 'node:worker_threads'

export const isTestRuntime = process.env.NODE_ENV === 'test'
  || process.env.VITEST === 'true'
  || process.env.VITEST === '1'

export function getTestWorkerKey(): string {
  return `${process.pid}-${isMainThread ? 0 : threadId}`
}

export function isTestLogSilenced(): boolean {
  return isTestRuntime && process.env.LOOPTROOP_TEST_SILENT === '1'
}

export function logIfVerbose(...args: Parameters<typeof console.log>) {
  if (!isTestLogSilenced()) {
    console.log(...args)
  }
}

export function warnIfVerbose(...args: Parameters<typeof console.warn>) {
  if (!isTestLogSilenced()) {
    console.warn(...args)
  }
}
