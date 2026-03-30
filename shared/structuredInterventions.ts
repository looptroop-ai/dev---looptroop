export type StructuredInterventionStage = 'parse' | 'normalize' | 'semantic_validation' | 'retry'
export type StructuredInterventionCategory = 'parser_fix' | 'cleanup' | 'synthesized' | 'dropped' | 'attribution' | 'retry'

export interface StructuredIntervention {
  code: string
  stage: StructuredInterventionStage
  category: StructuredInterventionCategory
  title: string
  summary: string
  why: string
  how: string
  technicalDetail?: string
  target?: string
}

export const STRUCTURED_INTERVENTION_CATEGORY_ORDER: StructuredInterventionCategory[] = [
  'parser_fix',
  'cleanup',
  'synthesized',
  'dropped',
  'attribution',
  'retry',
]

const STAGES = new Set<StructuredInterventionStage>(['parse', 'normalize', 'semantic_validation', 'retry'])
const CATEGORIES = new Set<StructuredInterventionCategory>(STRUCTURED_INTERVENTION_CATEGORY_ORDER)

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function normalizeIntervention(value: unknown): StructuredIntervention | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const record = value as Record<string, unknown>
  const code = normalizeString(record.code)
  const stage = normalizeString(record.stage)
  const category = normalizeString(record.category)
  const title = normalizeString(record.title)
  const summary = normalizeString(record.summary)
  const why = normalizeString(record.why)
  const how = normalizeString(record.how)
  const technicalDetail = normalizeString(record.technicalDetail)
  const target = normalizeString(record.target)

  if (!code || !stage || !category || !title || !summary || !why || !how) {
    return null
  }
  if (!STAGES.has(stage as StructuredInterventionStage) || !CATEGORIES.has(category as StructuredInterventionCategory)) {
    return null
  }

  return {
    code,
    stage: stage as StructuredInterventionStage,
    category: category as StructuredInterventionCategory,
    title,
    summary,
    why,
    how,
    ...(technicalDetail ? { technicalDetail } : {}),
    ...(target ? { target } : {}),
  }
}

export function normalizeStructuredInterventions(value: unknown): StructuredIntervention[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const normalized = normalizeIntervention(entry)
    return normalized ? [normalized] : []
  })
}

export function mergeStructuredInterventions(
  ...lists: Array<StructuredIntervention[] | undefined | null>
): StructuredIntervention[] {
  return lists.flatMap((list) => (Array.isArray(list) ? list : []))
}

function extractTargetFromWarning(warning: string): string | undefined {
  const matches = [
    warning.match(/\b(Q\d{1,3})\b/),
    warning.match(/\b(FU\d{1,3})\b/),
    warning.match(/\b(EPIC-[A-Za-z0-9-]+)\b/i),
    warning.match(/\b(US-[A-Za-z0-9-]+)\b/i),
    warning.match(/\b(Draft \d+)\b/i),
  ]
  for (const match of matches) {
    if (match?.[1]) return match[1]
  }
  return undefined
}

function buildIntervention(
  warning: string,
  intervention: Omit<StructuredIntervention, 'technicalDetail' | 'target'>,
): StructuredIntervention {
  const target = extractTargetFromWarning(warning)
  return {
    ...intervention,
    technicalDetail: warning,
    ...(target ? { target } : {}),
  }
}

function deriveInterventionFromWarning(warning: string): StructuredIntervention {
  const normalized = warning.trim().toLowerCase()

  if (/^dropped no-op .* refinement .* (?:identical|unchanged)/i.test(warning)) {
    return buildIntervention(warning, {
      code: 'dropped_no_op_change',
      stage: 'semantic_validation',
      category: 'dropped',
      title: 'Dropped a no-op change',
      summary: 'The AI reported a change that did not alter the validated artifact.',
      why: 'The winning and final records were identical, so keeping the change note would have been misleading.',
      how: 'LoopTroop removed the no-op change entry from the saved validated diff.',
    })
  }

  if (/^skipped non-object refinement change/i.test(warning) || /^skipped refinement change .* invalid type/i.test(warning)) {
    return buildIntervention(warning, {
      code: 'dropped_invalid_change',
      stage: 'semantic_validation',
      category: 'dropped',
      title: 'Dropped an invalid change entry',
      summary: 'A refinement change entry was malformed and could not be trusted.',
      why: 'The entry did not match the required machine-readable change schema.',
      how: 'LoopTroop ignored the invalid entry and kept only validated change records.',
    })
  }

  if (/ignored because|^dropped partial /i.test(warning)) {
    return buildIntervention(warning, {
      code: 'dropped_unsupported_or_partial_data',
      stage: 'semantic_validation',
      category: 'dropped',
      title: 'Dropped unsupported or partial data',
      summary: 'Some generated fields were unusable and were not carried into the validated artifact.',
      why: 'Those fields conflicted with the artifact contract or were too incomplete to preserve safely.',
      how: 'LoopTroop removed the unsupported detail and kept the rest of the validated output.',
    })
  }

  if (/cleared out-of-range .* inspiration|attribution|source label|source labels|source information|source info|inspiration/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'attribution_repaired',
      stage: 'semantic_validation',
      category: 'attribution',
      title: 'Repaired change attribution',
      summary: 'Source attribution on a saved change note was corrected or cleared.',
      why: 'The original attribution did not line up with the validated artifacts or referenced an invalid source.',
      how: 'LoopTroop repaired the attribution fields and preserved the validated change history.',
    })
  }

  if (/synthesi|rebuilt|reconstructed/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'synthesized_missing_detail',
      stage: 'normalize',
      category: 'synthesized',
      title: 'Synthesized missing machine-readable detail',
      summary: 'LoopTroop reconstructed a missing structured detail from validated records.',
      why: 'The model omitted a required machine-readable detail even though enough validated context existed to recover it.',
      how: 'LoopTroop synthesized the missing detail and persisted the validated result.',
    })
  }

  if (/^inferred missing /i.test(warning)) {
    return buildIntervention(warning, {
      code: 'synthesized_inferred_detail',
      stage: 'semantic_validation',
      category: 'synthesized',
      title: 'Inferred a missing structured field',
      summary: 'A required structured field was missing and had to be inferred.',
      why: 'The model left out a required field, but the surrounding validated records uniquely identified the correct value.',
      how: 'LoopTroop inferred the missing field and saved the normalized validated artifact.',
    })
  }

  if (
    /terminal noise|closing code fence|markdown code fence|wrapper text|wrapper key|inline yaml|indentation|quoted .*scalar|unbalanced yaml quote|yaml list dash|xml-style tags|malformed yaml|recover from malformed yaml|transcript/i.test(normalized)
  ) {
    return buildIntervention(warning, {
      code: 'parser_repair',
      stage: 'parse',
      category: 'parser_fix',
      title: 'Recovered malformed structured output',
      summary: 'LoopTroop repaired parser-level formatting so the structured artifact could be read safely.',
      why: 'The model wrapped or formatted the output in a way that broke strict machine parsing.',
      how: 'LoopTroop cleaned the parser-level formatting issue, reparsed the payload, and kept the validated result.',
    })
  }

  if (
    /canonical|normalized|filled missing|renumbered|duplicate .* id|duplicate option ids|recomputed total_score|trimmed empty|reorder|reordered|sorting|phase reordering|question order|resolved interview status|approval fields|generated_by\.winner_model|ticket_id|content_sha256|schema_version|mapped free_text|restored answered|follow_up_rounds|summary to match|status to draft|no prd references/i.test(normalized)
  ) {
    return buildIntervention(warning, {
      code: 'cleanup_canonicalization',
      stage: 'normalize',
      category: 'cleanup',
      title: 'Canonicalized saved artifact details',
      summary: 'Saved artifact metadata or content was normalized to the canonical validated shape.',
      why: 'The generated output did not exactly match the persisted schema or canonical project state.',
      how: 'LoopTroop rewrote the affected fields to the canonical validated values before saving the artifact.',
    })
  }

  return buildIntervention(warning, {
    code: 'cleanup_generic',
    stage: 'normalize',
    category: 'cleanup',
    title: 'Normalized saved artifact details',
    summary: 'LoopTroop adjusted a saved artifact detail during validation.',
    why: 'The generated output did not fully match the expected machine-readable shape.',
    how: 'LoopTroop normalized the detail before persisting the validated artifact.',
  })
}

export function deriveStructuredInterventions(options: {
  repairWarnings?: string[]
  autoRetryCount?: number
  validationError?: string
}): StructuredIntervention[] {
  const interventions = (options.repairWarnings ?? [])
    .filter((warning): warning is string => typeof warning === 'string' && warning.trim().length > 0)
    .map((warning) => deriveInterventionFromWarning(warning))

  const retryCount = options.autoRetryCount ?? 0
  const validationError = normalizeString(options.validationError)
  if (retryCount > 0 || validationError) {
    interventions.push({
      code: retryCount > 0 ? 'retry_after_validation_failure' : 'validation_failure_recorded',
      stage: retryCount > 0 ? 'retry' : 'semantic_validation',
      category: 'retry',
      title: retryCount > 0 ? 'Retried after validation failure' : 'Recorded a validation failure',
      summary: retryCount > 0
        ? `LoopTroop used ${Math.max(retryCount, 1)} extra validation pass(es) after an earlier response failed validation.`
        : 'A validator rejected an earlier response shape.',
      why: retryCount > 0
        ? 'The first response did not match the required machine-readable shape or semantic contract.'
        : 'The saved output did not satisfy strict validation.',
      how: retryCount > 0
        ? 'LoopTroop issued a structured retry and kept the validated result from the successful pass.'
        : 'LoopTroop kept the validator message for debugging and surfaced the saved result with that context.',
      ...(validationError ? { technicalDetail: validationError } : {}),
    })
  }

  return interventions
}
