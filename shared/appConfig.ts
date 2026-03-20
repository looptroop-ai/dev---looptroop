const DEFAULT_FRONTEND_PORT = 5173
const DEFAULT_BACKEND_PORT = 3000
export const DEFAULT_OPENCODE_BASE_URL = 'http://127.0.0.1:4096'

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function getFrontendPort(): number {
  return parsePort(process.env.LOOPTROOP_FRONTEND_PORT, DEFAULT_FRONTEND_PORT)
}

export function getBackendPort(): number {
  return parsePort(process.env.LOOPTROOP_BACKEND_PORT, DEFAULT_BACKEND_PORT)
}

export function getFrontendOrigin(): string {
  return process.env.LOOPTROOP_FRONTEND_ORIGIN
    ?? `http://localhost:${getFrontendPort()}`
}

export function getBackendOrigin(): string {
  return `http://localhost:${getBackendPort()}`
}

