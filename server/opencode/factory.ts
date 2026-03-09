import { MockOpenCodeAdapter, OpenCodeSDKAdapter, type OpenCodeAdapter } from './adapter'

let singleton: OpenCodeAdapter | null = null

export function isMockOpenCodeMode(): boolean {
  return process.env.LOOPTROOP_OPENCODE_MODE === 'mock'
}

export function getOpenCodeAdapter(): OpenCodeAdapter {
  if (singleton) return singleton
  singleton = isMockOpenCodeMode() ? new MockOpenCodeAdapter() : new OpenCodeSDKAdapter()
  return singleton
}

export function resetOpenCodeAdapter() {
  singleton = null
}
