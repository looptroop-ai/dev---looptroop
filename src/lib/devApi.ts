const DEV_BACKEND_HEALTH_PATH = '/api/health'
const DEV_BACKEND_POLL_MS = 250
const DEV_BACKEND_TIMEOUT_MS = 30_000

const nativeFetch = (() => {
  if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
    return window.fetch.bind(window)
  }

  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis)
  }

  throw new Error('Global fetch is not available')
})()

let devApiGuardInstalled = false
let pendingBackendReadyCheck: Promise<void> | null = null

function isDevelopmentRuntime() {
  return typeof window !== 'undefined' && import.meta.env.MODE === 'development'
}

function getAbortError() {
  return typeof DOMException === 'function'
    ? new DOMException('The operation was aborted.', 'AbortError')
    : new Error('The operation was aborted.')
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : getAbortError()
  }
}

function sleep(ms: number) {
  return new Promise<void>(resolve => {
    window.setTimeout(resolve, ms)
  })
}

function resolveUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return new URL(input, window.location.origin)
  if (input instanceof URL) return input
  if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url, window.location.origin)
  return null
}

function isFrontendApiUrl(url: URL) {
  return url.origin === window.location.origin && (url.pathname === '/api' || url.pathname.startsWith('/api/'))
}

function getDirectDevApiUrl(path: string) {
  return new URL(path, __LOOPTROOP_DEV_BACKEND_ORIGIN__).toString()
}

async function pingDevBackend() {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), 1000)

  try {
    const response = await nativeFetch(getDirectDevApiUrl(DEV_BACKEND_HEALTH_PATH), {
      cache: 'no-store',
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    window.clearTimeout(timeoutId)
  }
}

async function pollDevBackendUntilReady() {
  const startedAt = Date.now()

  while (Date.now() - startedAt < DEV_BACKEND_TIMEOUT_MS) {
    if (await pingDevBackend()) return
    await sleep(DEV_BACKEND_POLL_MS)
  }

  throw new Error(`LoopTroop backend did not become ready within ${DEV_BACKEND_TIMEOUT_MS / 1000}s`)
}

function waitForSignal(signal?: AbortSignal) {
  if (!signal) return null

  let dispose: () => void = () => {}

  const promise = new Promise<never>((_, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason instanceof Error ? signal.reason : getAbortError())
    }

    dispose = () => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
  })

  return { promise, dispose }
}

export async function waitForDevBackend(signal?: AbortSignal) {
  if (!isDevelopmentRuntime()) return

  throwIfAborted(signal)

  if (!pendingBackendReadyCheck) {
    pendingBackendReadyCheck = pollDevBackendUntilReady().finally(() => {
      pendingBackendReadyCheck = null
    })
  }

  const abortState = waitForSignal(signal)
  if (!abortState) {
    await pendingBackendReadyCheck
    return
  }

  try {
    await Promise.race([pendingBackendReadyCheck, abortState.promise])
  } finally {
    abortState.dispose()
  }
}

export function getApiUrl(path: string, options?: { directInDevelopment?: boolean }) {
  if (typeof window === 'undefined') return path

  if (isDevelopmentRuntime() && options?.directInDevelopment) {
    return getDirectDevApiUrl(path)
  }

  return new URL(path, window.location.origin).toString()
}

export const __devApiForTests = {
  getDirectDevApiUrl,
}

export function installDevApiGuard() {
  if (!isDevelopmentRuntime() || devApiGuardInstalled) return

  const originalFetch = nativeFetch

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const resolvedUrl = resolveUrl(input)
    if (!resolvedUrl || !isFrontendApiUrl(resolvedUrl)) {
      return originalFetch(input, init)
    }

    await waitForDevBackend(init?.signal ?? undefined)

    return originalFetch(input, init)
  }

  devApiGuardInstalled = true
}
