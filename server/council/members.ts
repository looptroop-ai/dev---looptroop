export const DEFAULT_MAIN_IMPLEMENTER = 'openai/codex-mini-latest'

export const DEFAULT_COUNCIL_MEMBERS = [
  DEFAULT_MAIN_IMPLEMENTER,
  'openai/gpt-5.3-codex',
] as const

function normalizeCouncilMembers(modelIds: Array<string | null | undefined>): string[] {
  const unique = new Set<string>()
  const normalized: string[] = []

  for (const modelId of modelIds) {
    const trimmed = typeof modelId === 'string' ? modelId.trim() : ''
    if (!trimmed || unique.has(trimmed)) continue
    unique.add(trimmed)
    normalized.push(trimmed)
  }

  return normalized
}

export function parseCouncilMembers(raw: string | null | undefined): string[] {
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? normalizeCouncilMembers(parsed.filter((value): value is string => typeof value === 'string'))
      : []
  } catch {
    return []
  }
}

export function ensureMinimumCouncilMembers(
  modelIds: Array<string | null | undefined>,
  minCouncilMembers: number = 2,
): string[] {
  const members = normalizeCouncilMembers(modelIds)
  if (members.length >= minCouncilMembers) return members

  for (const fallback of DEFAULT_COUNCIL_MEMBERS) {
    if (members.length >= minCouncilMembers) break
    if (!members.includes(fallback)) members.push(fallback)
  }

  return members
}
