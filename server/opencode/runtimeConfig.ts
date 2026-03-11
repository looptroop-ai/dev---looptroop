import { DEFAULT_OPENCODE_BASE_URL } from '../../shared/appConfig'

export function getOpenCodeBaseUrl(): string {
  return process.env.LOOPTROOP_OPENCODE_BASE_URL?.trim() || DEFAULT_OPENCODE_BASE_URL
}

