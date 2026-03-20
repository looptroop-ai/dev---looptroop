import type { VoteScorecard, StructuredOutputResult } from './types'
import {
  isRecord,
  normalizeKey,
  collectStructuredCandidates,
  unwrapExplicitWrapperRecord,
  parseYamlOrJsonCandidate,
  getValueByAliases,
  buildYamlDocument,
} from './yamlUtils'

function normalizeVoteDraftLabel(label: string): string | null {
  const match = label.trim().match(/draft\s*(\d+)/i)
  if (!match?.[1]) return null
  return `Draft ${Number(match[1])}`
}

export function normalizeVoteScorecardOutput(
  rawContent: string,
  draftLabels: string[],
  rubricCategories: string[],
): StructuredOutputResult<VoteScorecard> {
  const repairWarnings: string[] = []
  const candidates = collectStructuredCandidates(rawContent, {
    topLevelHints: ['draft_scores'],
  })
  let lastError = 'No vote scorecard content found'

  for (const candidate of candidates) {
    try {
      const parsed = unwrapExplicitWrapperRecord(parseYamlOrJsonCandidate(candidate), [
        'draftscores',
        'draft_scores',
        'scores',
        'scorecard',
      ])

      const root = isRecord(parsed) ? parsed : null
      const draftScoresRecord = root
        ? isRecord(getValueByAliases(root, ['draftscores', 'draft_scores']))
          ? getValueByAliases(root, ['draftscores', 'draft_scores']) as Record<string, unknown>
          : root
        : null

      if (!draftScoresRecord) throw new Error('Vote scorecard is not a YAML/JSON mapping')
      const expectedDraftLabels = new Set(draftLabels)
      const normalizedDraftEntries = new Map<string, Record<string, unknown>>()

      for (const [key, value] of Object.entries(draftScoresRecord)) {
        const normalizedLabel = normalizeVoteDraftLabel(key)
        if (!normalizedLabel || !expectedDraftLabels.has(normalizedLabel)) {
          throw new Error(`Unknown scorecard for ${key}`)
        }
        if (!isRecord(value)) {
          throw new Error(`Scorecard for ${normalizedLabel} is not a YAML/JSON mapping`)
        }
        if (normalizedDraftEntries.has(normalizedLabel)) {
          throw new Error(`Duplicate scorecard for ${normalizedLabel}`)
        }
        normalizedDraftEntries.set(normalizedLabel, value)
      }

      const normalized: VoteScorecard['draftScores'] = {}

      for (const draftLabel of draftLabels) {
        const draftRecord = normalizedDraftEntries.get(draftLabel)
        if (!draftRecord) {
          throw new Error(`Missing scorecard for ${draftLabel}`)
        }
        const scores: Record<string, number> = {}
        let total = 0

        for (const category of rubricCategories) {
          const rawValue = getValueByAliases(draftRecord, [normalizeKey(category)])
          if (typeof rawValue !== 'number' || !Number.isInteger(rawValue) || rawValue < 0 || rawValue > 20) {
            throw new Error(`Invalid score for ${draftLabel} / ${category}`)
          }
          scores[category] = rawValue
          total += rawValue
        }

        const totalScore = getValueByAliases(draftRecord, ['totalscore', 'total_score'])
        if (totalScore === undefined) {
          repairWarnings.push(`Filled missing total_score for ${draftLabel} from rubric category totals.`)
        } else if (typeof totalScore !== 'number' || !Number.isInteger(totalScore)) {
          throw new Error(`Invalid total_score for ${draftLabel}`)
        } else if (totalScore !== total) {
          repairWarnings.push(`Recomputed total_score for ${draftLabel}: expected ${total}, received ${totalScore}.`)
        }
        scores.total_score = total
        normalized[draftLabel] = scores
      }

      return {
        ok: true,
        value: { draftScores: normalized },
        normalizedContent: buildYamlDocument({ draft_scores: normalized }),
        repairApplied: candidate !== rawContent.trim() || repairWarnings.length > 0,
        repairWarnings,
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    ok: false,
    error: lastError,
    repairApplied: false,
    repairWarnings,
  }
}
