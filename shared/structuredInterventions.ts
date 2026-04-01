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
  return dedupeStructuredInterventions(value.flatMap((entry) => {
    const normalized = normalizeIntervention(entry)
    return normalized ? [normalized] : []
  }))
}

export function mergeStructuredInterventions(
  ...lists: Array<StructuredIntervention[] | undefined | null>
): StructuredIntervention[] {
  return dedupeStructuredInterventions(lists.flatMap((list) => (Array.isArray(list) ? list : [])))
}

export function dedupeStructuredInterventions(interventions: StructuredIntervention[]): StructuredIntervention[] {
  const unique: StructuredIntervention[] = []
  const seen = new Set<string>()

  for (const intervention of interventions) {
    const serialized = JSON.stringify(intervention)
    if (seen.has(serialized)) continue
    seen.add(serialized)
    unique.push(intervention)
  }

  return unique
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

  // ── Dropped category ──────────────────────────────────────────────────

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

  // ── Attribution category ──────────────────────────────────────────────

  if (/cleared out-of-range .* inspiration|inspiration .* out of bounds/i.test(warning)) {
    return buildIntervention(warning, {
      code: 'attribution_out_of_range',
      stage: 'semantic_validation',
      category: 'attribution',
      title: 'Cleared an out-of-range inspiration source',
      summary: 'An inspiration reference pointed to a draft that does not exist, so the reference was removed.',
      why: 'The model cited an alternative draft index that exceeds the number of available drafts, making the attribution invalid.',
      how: 'LoopTroop cleared the out-of-range inspiration reference and set the field to null to prevent broken cross-references.',
    })
  }

  if (/attribution|source label|source labels|source information|source info|inspiration/i.test(normalized)) {
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

  // ── Synthesized category ──────────────────────────────────────────────

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

  if (/synthesized omitted .* refinement/i.test(warning)) {
    return buildIntervention(warning, {
      code: 'synthesized_omitted_refinement',
      stage: 'semantic_validation',
      category: 'synthesized',
      title: 'Synthesized an omitted refinement change',
      summary: 'The model did not declare a change that is evident from comparing the winning and final drafts, so LoopTroop synthesized it.',
      why: 'The winning and final drafts differ for this item, but the model omitted a corresponding refinement change entry.',
      how: 'LoopTroop matched items by identity across the winning and final drafts, detected the undeclared modification, and synthesized a change record.',
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

  // ── Parser fix category (specific sub-patterns) ───────────────────────

  if (/terminal noise/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'parser_terminal_noise',
      stage: 'parse',
      category: 'parser_fix',
      title: 'Stripped trailing terminal noise',
      summary: 'Trailing terminal control characters or shell prompt artifacts were appended after the YAML/JSON payload.',
      why: 'The model echoed terminal noise (control characters, prompt strings, or escape sequences) after the structured data, which would break parsing.',
      how: 'LoopTroop detected and stripped the trailing terminal noise, then reparsed the clean payload successfully.',
    })
  }

  if (/closing code fence/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'parser_closing_fence',
      stage: 'parse',
      category: 'parser_fix',
      title: 'Removed a stray closing code fence',
      summary: 'A closing Markdown code fence (```) was appended after the structured payload.',
      why: 'The model terminated its output with a ``` fence marker that is not part of the structured data, which would cause a parse error.',
      how: 'LoopTroop stripped the trailing ``` fence marker and reparsed the cleaned payload.',
    })
  }

  if (/markdown code fence/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'parser_markdown_fence',
      stage: 'parse',
      category: 'parser_fix',
      title: 'Unwrapped payload from Markdown code fences',
      summary: 'The structured payload was enclosed inside Markdown code fences (```yaml … ```).',
      why: 'The model wrapped the YAML/JSON payload in Markdown code fences instead of returning raw structured data, preventing direct parsing.',
      how: 'LoopTroop extracted the content between the fence markers, discarded the fences, and reparsed the unwrapped payload.',
    })
  }

  if (/wrapper key/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'parser_wrapper_key',
      stage: 'parse',
      category: 'parser_fix',
      title: 'Removed an unexpected top-level wrapper key',
      summary: 'The model nested the expected payload under an extra top-level YAML key that is not part of the schema.',
      why: 'The extra wrapper key changes the document structure, making the payload inaccessible at the expected path.',
      how: 'LoopTroop unwrapped the nested content from under the extra key and reparsed the flattened payload.',
    })
  }

  if (/xml-style tags/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'parser_xml_tags',
      stage: 'parse',
      category: 'parser_fix',
      title: 'Stripped XML-style tags from the payload',
      summary: 'The structured payload was enclosed in XML-like tags (e.g. <output>…</output>).',
      why: 'The model wrapped the YAML/JSON data in XML-style tags that are not part of the expected format, preventing direct parsing.',
      how: 'LoopTroop removed the XML-style tags, extracted the inner content, and reparsed the clean payload.',
    })
  }

  if (/inline yaml/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'parser_inline_yaml',
      stage: 'parse',
      category: 'parser_fix',
      title: 'Converted inline YAML flow syntax to block format',
      summary: 'The model used JSON-like inline YAML flow syntax ({…} or […]) instead of standard block format.',
      why: 'Inline flow syntax can cause ambiguity in strict YAML parsing and is harder to validate against the expected schema.',
      how: 'LoopTroop converted the inline flow constructs to standard block YAML and reparsed the normalized payload.',
    })
  }

  if (/unbalanced yaml quote/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'parser_unbalanced_quote',
      stage: 'parse',
      category: 'parser_fix',
      title: 'Fixed an unbalanced YAML quote',
      summary: 'A quote in the YAML payload was opened but never closed (or vice versa).',
      why: 'An unbalanced quote causes the YAML parser to consume subsequent lines as part of the quoted string, corrupting the document structure.',
      how: 'LoopTroop balanced the mismatched quote, restoring the correct field boundaries, and reparsed the payload.',
    })
  }

  if (/quoted .*scalar/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'parser_quoted_scalar',
      stage: 'parse',
      category: 'parser_fix',
      title: 'Repaired an improperly quoted YAML scalar',
      summary: 'A YAML scalar value had mismatched or malformed quoting that would cause a parse error.',
      why: 'The model produced a value with incorrect quote delimiters (e.g. mixed single/double quotes, or unescaped inner quotes).',
      how: 'LoopTroop fixed the quoting on the affected scalar value and reparsed the corrected payload.',
    })
  }

  if (/indentation/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'parser_indentation',
      stage: 'parse',
      category: 'parser_fix',
      title: 'Repaired inconsistent YAML indentation',
      summary: 'The YAML payload had misaligned or mixed indentation levels that broke strict parsing.',
      why: 'YAML is indentation-sensitive; inconsistent indentation causes keys to be assigned to the wrong parent or triggers parse errors.',
      how: 'LoopTroop corrected the indentation to produce valid, consistently-indented YAML and reparsed the payload.',
    })
  }

  if (/yaml list dash/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'parser_list_dash',
      stage: 'parse',
      category: 'parser_fix',
      title: 'Corrected a malformed YAML list-item dash',
      summary: 'A YAML list entry had an incorrect or missing dash prefix ("- ").',
      why: 'YAML list items must start with "- " followed by the value; a missing or malformed dash breaks the list structure.',
      how: 'LoopTroop repaired the list-item syntax to use the correct "- " prefix and reparsed the payload.',
    })
  }

  if (/wrapper text|transcript/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'parser_transcript_recovery',
      stage: 'parse',
      category: 'parser_fix',
      title: 'Extracted payload from surrounding prose or transcript',
      summary: 'The structured payload was embedded inside conversational text, preamble, or transcript output.',
      why: 'The model included explanatory prose or transcript text alongside the structured data instead of returning only the raw YAML/JSON payload.',
      how: 'LoopTroop isolated the structured data block from the surrounding text, discarded the prose, and reparsed the extracted payload.',
    })
  }

  if (/truncated incomplete|recover from malformed yaml|malformed yaml/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'parser_malformed_yaml',
      stage: 'parse',
      category: 'parser_fix',
      title: 'Recovered data from malformed YAML',
      summary: 'The YAML payload had structural errors too severe for simple quote or indentation repairs (e.g. truncated entries, broken nesting).',
      why: 'The model produced YAML with deep structural problems that would cause complete parse failure if not handled with recovery logic.',
      how: 'LoopTroop applied best-effort recovery rules to extract the valid portions, discarded the unrecoverable fragments, and reparsed the salvaged payload.',
    })
  }

  // parser_fix fallback for unrecognized parser-level issues
  if (/code fence|parse error|yaml error|json error/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'parser_repair',
      stage: 'parse',
      category: 'parser_fix',
      title: 'Recovered malformed structured output',
      summary: 'LoopTroop repaired a parser-level formatting issue so the structured artifact could be read safely.',
      why: 'The model wrapped or formatted the output in a way that broke strict machine parsing.',
      how: 'LoopTroop cleaned the parser-level formatting issue, reparsed the payload, and kept the validated result.',
    })
  }

  // ── Cleanup category (specific sub-patterns) ─────────────────────────

  if (/collapsed duplicate.*refinement/i.test(warning)) {
    return buildIntervention(warning, {
      code: 'cleanup_collapsed_duplicate',
      stage: 'semantic_validation',
      category: 'cleanup',
      title: 'Collapsed a duplicate refinement change',
      summary: 'A refinement change entry was identical to another change already recorded for the same item.',
      why: 'The model declared the same modification twice, which would double-count the change in the validated diff.',
      how: 'LoopTroop detected the duplicate change entry, kept the first occurrence, and removed the redundant copy.',
    })
  }

  if (/renumbered|duplicate .* id|duplicate option ids/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'cleanup_duplicate_ids',
      stage: 'normalize',
      category: 'cleanup',
      title: 'Renumbered duplicate identifiers',
      summary: 'One or more items shared the same identifier, so LoopTroop assigned unique IDs to eliminate conflicts.',
      why: 'Duplicate identifiers cause ambiguity in cross-referencing and break data integrity when items are looked up by ID.',
      how: 'LoopTroop detected the duplicates, assigned unique sequential identifiers (preserving the original content), and updated all internal references.',
    })
  }

  if (/filled missing|missing .*\bfilled\b/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'cleanup_filled_missing',
      stage: 'normalize',
      category: 'cleanup',
      title: 'Filled a missing required field',
      summary: 'A required field was empty or omitted by the model and was populated with the correct value.',
      why: 'The model left out a required field that downstream processing depends on, but the correct value could be determined from context.',
      how: 'LoopTroop inferred the correct value from the runtime context or used a safe default, then populated the missing field before saving.',
    })
  }

  if (/recomputed total_score/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'cleanup_recomputed_score',
      stage: 'normalize',
      category: 'cleanup',
      title: 'Recomputed total_score from dimension scores',
      summary: 'The reported total_score did not match the arithmetic result of its component dimension scores.',
      why: 'The model produced a total_score that is inconsistent with the individual dimension scores, which would make vote rankings unreliable.',
      how: 'LoopTroop recalculated total_score from the individual dimension scores to ensure arithmetic consistency.',
    })
  }

  if (/trimmed empty/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'cleanup_trimmed_empty',
      stage: 'normalize',
      category: 'cleanup',
      title: 'Trimmed empty entries',
      summary: 'Empty or whitespace-only entries were removed from the artifact.',
      why: 'Blank entries carry no meaningful content and would clutter the persisted artifact with noise.',
      how: 'LoopTroop filtered out the empty entries and kept only entries with substantive content.',
    })
  }

  if (/phase reordering|reorder|reordered|sorting|question order/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'cleanup_reordering',
      stage: 'normalize',
      category: 'cleanup',
      title: 'Re-sorted items into canonical phase order',
      summary: 'Items were returned in a non-canonical order and were re-sorted (foundation → structure → assembly).',
      why: 'The workflow requires a stable, deterministic ordering so that items appear consistently across all views and downstream phases.',
      how: 'LoopTroop applied the canonical phase sort order, preserving all item content while correcting their sequence.',
    })
  }

  if (/resolved interview status/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'cleanup_interview_status',
      stage: 'normalize',
      category: 'cleanup',
      title: 'Resolved interview status to the expected value',
      summary: 'The interview status field was set to an unexpected value and was corrected.',
      why: 'The model set the interview status to a value that conflicts with the current workflow stage.',
      how: 'LoopTroop overrode the status to the canonical value required at this point in the interview workflow.',
    })
  }

  if (/normalized.*status|status to draft/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'cleanup_status_normalized',
      stage: 'normalize',
      category: 'cleanup',
      title: 'Normalized artifact status to "draft"',
      summary: 'The artifact status was set to an unsupported or premature value and was corrected to "draft".',
      why: 'At this stage of the workflow, the artifact must start as a draft — the model set it to a different status prematurely.',
      how: 'LoopTroop overrode the status field to "draft", the required value for newly generated artifacts at this workflow stage.',
    })
  }

  if (/approval fields/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'cleanup_approval_fields',
      stage: 'normalize',
      category: 'cleanup',
      title: 'Cleared pre-filled approval fields',
      summary: 'Approval metadata (timestamps, approver info) was pre-populated by the model and had to be cleared.',
      why: 'Approval fields should only be set by explicit user action — pre-filling them would bypass the approval workflow.',
      how: 'LoopTroop cleared the pre-filled approval metadata so the artifact starts in a proper unapproved state.',
    })
  }

  if (/generated_by\.winner_model/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'cleanup_winner_model',
      stage: 'normalize',
      category: 'cleanup',
      title: 'Corrected the generated_by.winner_model field',
      summary: 'The model identified itself incorrectly in the generated_by.winner_model field.',
      why: 'The winner_model field must match the canonical model identifier of the council member that produced this draft for accurate attribution.',
      how: 'LoopTroop set generated_by.winner_model to the correct canonical model identifier for the drafting council member.',
    })
  }

  if (/ticket_id/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'cleanup_ticket_id',
      stage: 'normalize',
      category: 'cleanup',
      title: 'Corrected the ticket_id field',
      summary: 'The ticket_id did not match the current ticket and was corrected to the canonical identifier.',
      why: 'The model produced a ticket_id that does not match the ticket this artifact belongs to, which would break ticket-artifact linking.',
      how: 'LoopTroop replaced the ticket_id with the authoritative value from the runtime context.',
    })
  }

  if (/content_sha256/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'cleanup_content_hash',
      stage: 'normalize',
      category: 'cleanup',
      title: 'Recalculated the source content hash',
      summary: 'The content_sha256 hash was incorrect or stale and was recomputed from the authoritative source artifact.',
      why: 'A mismatched content hash would break change-detection logic that relies on hash comparison to determine if the source has been modified.',
      how: 'LoopTroop recomputed content_sha256 from the approved source artifact and stored the correct hash.',
    })
  }

  if (/schema_version/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'cleanup_schema_version',
      stage: 'normalize',
      category: 'cleanup',
      title: 'Corrected the schema_version field',
      summary: 'The schema_version was set to an invalid or unexpected value and was corrected.',
      why: 'An incorrect schema_version could cause downstream readers to misinterpret the artifact structure.',
      how: 'LoopTroop set schema_version to the correct value for the current artifact format.',
    })
  }

  if (/mapped free_text/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'cleanup_mapped_free_text',
      stage: 'normalize',
      category: 'cleanup',
      title: 'Mapped free-text answers to canonical option IDs',
      summary: 'The model provided free-text answers instead of selecting from the defined option set for a multiple-choice question.',
      why: 'Downstream processing requires canonical option identifiers, not free-form text, for structured question responses.',
      how: 'LoopTroop matched the free-text content to the closest canonical option identifiers and recorded the mapping.',
    })
  }

  if (/restored answered/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'cleanup_restored_answered',
      stage: 'normalize',
      category: 'cleanup',
      title: 'Restored an answered question from the approved artifact',
      summary: 'A previously answered and approved interview question was omitted or altered by the model and was restored.',
      why: 'Approved answers are authoritative — the model should not modify or omit them in subsequent drafts.',
      how: 'LoopTroop copied the authoritative answered record from the approved Interview Results artifact.',
    })
  }

  if (/answered_by.*ai_skip/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'cleanup_answered_by',
      stage: 'normalize',
      category: 'cleanup',
      title: 'Canonicalized answered_by to "ai_skip"',
      summary: 'The answered_by field for an AI-filled question was set incorrectly and was corrected to "ai_skip".',
      why: 'AI-filled questions must be tagged as "ai_skip" so the system knows they were not answered by the user.',
      how: 'LoopTroop set the answered_by field to "ai_skip" for the AI-filled question.',
    })
  }

  if (/follow_up_rounds/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'cleanup_follow_up_rounds',
      stage: 'normalize',
      category: 'cleanup',
      title: 'Canonicalized follow_up_rounds from approved artifact',
      summary: 'The follow_up_rounds data was altered or omitted by the model and was restored from the approved artifact.',
      why: 'Follow-up round data was already approved — the model should preserve it exactly as-is in subsequent drafts.',
      how: 'LoopTroop restored follow_up_rounds from the authoritative approved Interview Results artifact.',
    })
  }

  if (/summary to match/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'cleanup_summary_match',
      stage: 'normalize',
      category: 'cleanup',
      title: 'Canonicalized the document summary',
      summary: 'The document summary was altered by the model and was restored to match the approved artifact.',
      why: 'The approved summary is authoritative — rewording it could misrepresent the approved interview content.',
      how: 'LoopTroop restored the summary text from the authoritative approved artifact.',
    })
  }

  if (/no prd references/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'cleanup_no_prd_refs',
      stage: 'semantic_validation',
      category: 'cleanup',
      title: 'Flagged a bead with no PRD references',
      summary: 'A bead has an empty prdRefs list, meaning it does not trace to any PRD user story or epic.',
      why: 'Every bead should reference at least one PRD item for traceability — an empty prdRefs may indicate the bead was fabricated or the references were lost.',
      how: 'LoopTroop recorded the missing-reference warning; the bead was kept but flagged for review.',
    })
  }

  if (/context guidance/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'cleanup_context_guidance',
      stage: 'normalize',
      category: 'cleanup',
      title: 'Canonicalized context guidance into structured format',
      summary: 'Inline string context guidance was converted into the structured patterns/anti_patterns object format.',
      why: 'The model provided context guidance as a plain string instead of the expected structured object with patterns and anti_patterns fields.',
      how: 'LoopTroop parsed the inline string, mapped it into the canonical patterns/anti_patterns structure, and persisted the normalized result.',
    })
  }

  if (/affected_items label/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'cleanup_affected_label',
      stage: 'normalize',
      category: 'cleanup',
      title: 'Canonicalized an affected_items label',
      summary: 'An affected_items label did not match the authoritative source and was corrected.',
      why: 'The label must exactly match the canonical label from the source artifact to maintain consistent cross-referencing.',
      how: 'LoopTroop looked up the canonical label from the source artifact and replaced the model-provided label.',
    })
  }

  if (/preserved.*narrative fields/i.test(normalized)) {
    return buildIntervention(warning, {
      code: 'cleanup_preserved_narrative',
      stage: 'normalize',
      category: 'cleanup',
      title: 'Restored preserved narrative fields after drift',
      summary: 'Part 1 narrative fields drifted during expansion (punctuation or whitespace changes only) and were restored.',
      why: 'Narrative fields from Part 1 of the blueprint are preserved verbatim — even minor punctuation or whitespace changes are considered drift.',
      how: 'LoopTroop detected the cosmetic drift, restored the original Part 1 narrative field values, and kept the expanded content.',
    })
  }

  if (/converted.*(?:added|replaced|modified)|updated.*refined.*question|removed stale.*refined/i.test(warning)) {
    return buildIntervention(warning, {
      code: 'cleanup_change_type_correction',
      stage: 'semantic_validation',
      category: 'cleanup',
      title: 'Corrected a refinement change type or applied it to the question list',
      summary: 'A refinement change was reclassified or applied to synchronize the top-level question list with the declared changes.',
      why: 'The declared change type did not match the actual modification, or the top-level list was out of sync with the change entries.',
      how: 'LoopTroop reclassified the change to the correct type and/or updated the question list to reflect the declared changes.',
    })
  }

  // cleanup fallback for remaining canonical/normalized patterns
  if (/canonical|normalized/i.test(normalized)) {
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

  // ── Generic cleanup fallback ──────────────────────────────────────────

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
