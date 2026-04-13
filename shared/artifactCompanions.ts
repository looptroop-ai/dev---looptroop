import { isRecord } from './typeGuards'

export interface UiArtifactCompanionArtifact<T = Record<string, unknown>> {
  baseArtifactType: string
  generatedAt: string
  payload: T
}

export function buildUiArtifactCompanionArtifactType(baseArtifactType: string): string {
  return `ui_artifact_companion:${baseArtifactType}`
}

export function buildUiArtifactCompanionArtifact<T = Record<string, unknown>>(
  baseArtifactType: string,
  payload: T,
): UiArtifactCompanionArtifact<T> {
  return {
    baseArtifactType,
    generatedAt: new Date().toISOString(),
    payload,
  }
}

export function parseUiArtifactCompanionArtifact(
  content: string,
): UiArtifactCompanionArtifact<Record<string, unknown>> | null {
  try {
    const parsed = JSON.parse(content) as unknown
    if (!isRecord(parsed)) return null

    const baseArtifactType = typeof parsed.baseArtifactType === 'string'
      ? parsed.baseArtifactType.trim()
      : ''
    if (!baseArtifactType) return null

    const generatedAt = typeof parsed.generatedAt === 'string' && parsed.generatedAt.trim()
      ? parsed.generatedAt
      : ''
    const payload = isRecord(parsed.payload) ? parsed.payload : null
    if (!generatedAt || !payload) return null

    return {
      baseArtifactType,
      generatedAt,
      payload,
    }
  } catch {
    return null
  }
}
