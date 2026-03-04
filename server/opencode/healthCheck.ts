import type { OpenCodeAdapter } from './adapter'
import type { HealthStatus } from './types'

export async function checkOpenCodeHealth(adapter: OpenCodeAdapter): Promise<HealthStatus> {
  return adapter.checkHealth()
}
