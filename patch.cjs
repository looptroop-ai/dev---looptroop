const fs = require('fs');
const path = 'shared/structuredInterventions.ts';
let code = fs.readFileSync(path, 'utf8');

const startStr = 'function buildExactInterventionDetails(\n  code: string,\n  technicalDetail?: string,\n): {\n  exactCorrection?: string\n  examples?: StructuredInterventionExample[]\n} {';
const endStr = 'function enrichIntervention(intervention: StructuredIntervention): StructuredIntervention {';

const startIndex = code.indexOf(startStr);
const endIndex = code.indexOf(endStr);

if (startIndex === -1 || endIndex === -1) {
  console.error('Could not find start or end index');
  process.exit(1);
}

const replacement = `function buildExactInterventionDetails(
  code: string,
  technicalDetail?: string,
): {
  exactCorrection?: string
  examples?: StructuredInterventionExample[]
} {
  if (!technicalDetail) return {}

  const warning = technicalDetail.trim()
  if (!warning) return {}

  const fromToMatch = warning.match(/^(?:Canonicalized|Normalized)\\s+(.+?)\\s+from\\s+(.+?)\\s+to\\s+(.+?)\\.$/i)
  if (fromToMatch) {
    const subject = normalizeString(fromToMatch[1])
    const before = fromToMatch[2]!
    const after = fromToMatch[3]!
    const example = buildBeforeAfterExample(subject, before, after)
    return {
      exactCorrection: subject
        ? \`Changed \${subject} from \${formatQuotedValue(before)} to \${formatQuotedValue(after)}.\`
        : \`Changed \${formatQuotedValue(before)} to \${formatQuotedValue(after)}.\`,
      ...(example ? { examples: [example] } : {}),
    }
  }

  if (code === 'cleanup_status_normalized') {
    const statusMatch = warning.match(/^Normalized unsupported PRD status\\s+(.+?)\\s+to\\s+(.+?)\\.$/i)
    if (statusMatch) {
      const example = buildBeforeAfterExample('PRD status', statusMatch[1], statusMatch[2])
      return {
        exactCorrection: \`Changed the PRD status from \${formatQuotedValue(statusMatch[1]!)} to \${formatQuotedValue(statusMatch[2]!)}.\`,
        ...(example ? { examples: [example] } : {}),
      }
    }
  }

  if (code === 'cleanup_duplicate_ids') {
    const renumberMatch = warning.match(/^Renumbered duplicate (.+?) id\\s+("?[^"]+"?|[^\\s.]+)(?: at index \\d+)?\\s+to\\s+("?[^"]+"?|.+?)\\.$/i)
    if (renumberMatch) {
      const subject = \`\${renumberMatch[1]} ID\`
      const before = renumberMatch[2]!
      const after = renumberMatch[3]!
      const example = buildBeforeAfterExample(subject, before, after)
      return {
        exactCorrection: \`Renumbered the duplicate \${subject.toLowerCase()} from \${formatQuotedValue(before)} to \${formatQuotedValue(after)}.\`,
        ...(example ? { examples: [example] } : {}),
      }
    }

    const duplicateOptionsMatch = warning.match(/^([^:]+): removed duplicate option ids (.+?) and kept the first occurrence\\.$/i)
    if (duplicateOptionsMatch) {
      return {
        exactCorrection: \`Removed duplicate option IDs for \${duplicateOptionsMatch[1]!.trim()} and kept the first occurrence of each ID.\`,
      }
    }
  }

  if (code === 'cleanup_filled_missing') {
    const filledMatch = warning.match(/^(.*?) was missing (.+?)\\. Filled with (.+)\\.$/i)
    if (filledMatch) {
      const scope = normalizeString(filledMatch[1])
      const field = stripOuterQuotes(filledMatch[2]!)
      const value = filledMatch[3]!
      const example = buildBeforeAfterExample(scope ?? field, '[missing]', value, scope ? \`Filled \${field}.\` : undefined)
      return {
        exactCorrection: \`Filled the missing \${field} with \${formatQuotedValue(value)}.\`,
        ...(example ? { examples: [example] } : {}),
      }
    }

    const runtimeFillMatch = warning.match(/^Filled missing (.+?) from runtime context\\.$/i)
    if (runtimeFillMatch) {
      return {
        exactCorrection: \`Filled the missing \${stripOuterQuotes(runtimeFillMatch[1]!)} from the runtime context.\`,
      }
    }
  }

  if (code === 'synthesized_inferred_detail') {
    const inferredMatch = warning.match(/^Inferred missing (.+?)(?: at index \\d+)? as (.+)\\.$/i)
    if (inferredMatch) {
      const field = inferredMatch[1]
      const value = inferredMatch[2]!
      const example = buildBeforeAfterExample(field, '[missing]', value)
      return {
        exactCorrection: \`Filled the missing \${field} with \${formatQuotedValue(value)} using the validated surrounding context.\`,
        ...(example ? { examples: [example] } : {}),
      }
    }
  }

  if (code === 'synthesized_omitted_refinement') {
    const synthMatch = warning.match(/Synthesized omitted (.+?) refinement/i)
    if (synthMatch) {
      return { exactCorrection: \`Synthesized an omitted \${synthMatch[1]} refinement change.\` }
    }
    return { exactCorrection: 'Synthesized an omitted refinement change.' }
  }

  if (code === 'synthesized_missing_detail') {
    return { exactCorrection: 'Synthesized missing machine-readable detail from validated records.' }
  }

  if (code === 'dropped_no_op_change') {
    const droppedMatch = warning.match(/^Dropped no-op .* refinement (.+?)(?: change)? at index (\\d+)/i)
    if (droppedMatch) {
      return {
        exactCorrection: \`Removed the no-op \${droppedMatch[1]} change entry at index \${droppedMatch[2]} from the saved diff.\`,
      }
    }
    return { exactCorrection: 'Removed a no-op change entry from the saved diff.' }
  }

  if (code === 'dropped_invalid_change') {
    const skippedMatch = warning.match(/^Skipped .*refinement change.* at index (\\d+)/i)
    if (skippedMatch) {
      return { exactCorrection: \`Removed the invalid refinement change entry at index \${skippedMatch[1]}.\` }
    }
    return { exactCorrection: 'Removed an invalid refinement change entry.' }
  }

  if (code === 'dropped_unsupported_or_partial_data') {
    return { exactCorrection: 'Removed unsupported or partial data that conflicted with the expected artifact contract.' }
  }

  if (code === 'attribution_out_of_range') {
    const outOfRangeMatch = warning.match(/index (\\d+).*draft (\\d+)/i)
    if (outOfRangeMatch) {
      return { exactCorrection: \`Cleared the out-of-range inspiration reference at index \${outOfRangeMatch[1]} pointing to non-existent draft \${outOfRangeMatch[2]}.\` }
    }
    return { exactCorrection: 'Cleared an out-of-range inspiration reference.' }
  }

  if (code === 'attribution_repaired') {
    return { exactCorrection: 'Repaired change attribution fields to align with validated artifacts.' }
  }

  if (code === 'parser_wrapper_key') {
    const wrapperSubject = extractWrapperSubject(warning)
    return {
      exactCorrection: wrapperSubject
        ? \`Removed the unexpected top-level wrapper \${wrapperSubject.includes('->') ? 'key chain' : 'key'} \${formatQuotedValue(wrapperSubject)} and kept its nested payload.\`
        : 'Removed an unexpected top-level wrapper key and kept its nested payload.',
    }
  }

  if (code === 'parser_markdown_fence') {
    return {
      exactCorrection: 'Removed the outer Markdown code fence wrapper so only the structured payload remained.',
    }
  }

  if (code === 'parser_closing_fence') {
    return {
      exactCorrection: 'Removed the stray trailing closing code fence after the structured payload.',
    }
  }

  if (code === 'parser_xml_tags') {
    const tagsMatch = warning.match(/^Stripped XML-style tags?\\s+(.+?)\\s+from the payload before parsing\\.$/i)
    if (tagsMatch) {
      return {
        exactCorrection: \`Removed the XML-style wrapper tags \${tagsMatch[1]} around the payload before reparsing.\`,
      }
    }

    return {
      exactCorrection: 'Removed XML-style wrapper tags around the payload before reparsing.',
    }
  }

  if (code === 'parser_terminal_noise') {
    return {
      exactCorrection: 'Trimmed the trailing terminal control noise after the structured payload.',
    }
  }

  if (code === 'parser_transcript_recovery') {
    return {
      exactCorrection: 'Extracted just the structured artifact and ignored the surrounding transcript or wrapper text.',
    }
  }

  if (code === 'parser_indentation') {
    const lineMatch = warning.match(/line\\s+(\\d+)/i)
    return {
      exactCorrection: lineMatch
        ? \`Repaired YAML indentation at line \${lineMatch[1]} so the structure parsed correctly.\`
        : 'Repaired the YAML indentation so the structure parsed correctly.',
    }
  }

  if (code === 'parser_list_dash') {
    const lineMatch = warning.match(/line\\s+(\\d+)/i)
    return {
      exactCorrection: lineMatch
        ? \`Fixed the malformed YAML list dash at line \${lineMatch[1]}.\`
        : 'Fixed a malformed YAML list-item dash.',
    }
  }

  if (code === 'parser_unbalanced_quote') {
    return {
      exactCorrection: 'Balanced the malformed YAML quote before reparsing the payload.',
    }
  }

  if (code === 'parser_quoted_scalar') {
    return {
      exactCorrection: 'Repaired the malformed quoted YAML scalar before reparsing the payload.',
    }
  }

  if (code === 'parser_inline_yaml') {
    return {
      exactCorrection: 'Converted inline YAML flow syntax into standard block YAML before validation.',
    }
  }

  if (code === 'parser_malformed_yaml') {
    return {
      exactCorrection: 'Recovered the valid portion of the malformed YAML and discarded the unrecoverable fragment.',
    }
  }

  if (code === 'parser_repair') {
    return { exactCorrection: 'Cleaned a parser-level formatting issue to safely read the structured payload.' }
  }

  if (code === 'cleanup_schema_version') {
    const example = buildBeforeAfterExample('schema_version', '[invalid]', '1')
    return {
      exactCorrection: 'Set schema_version to "1".',
      ...(example ? { examples: [example] } : {}),
    }
  }

  if (code === 'cleanup_approval_fields') {
    return {
      exactCorrection: 'Cleared the pre-filled approval fields so the artifact remained unapproved.',
    }
  }

  if (code === 'cleanup_content_hash') {
    return {
      exactCorrection: 'Recomputed source_interview.content_sha256 from the authoritative approved source artifact.',
    }
  }

  if (code === 'cleanup_follow_up_rounds') {
    return {
      exactCorrection: 'Restored follow_up_rounds from the approved interview artifact.',
    }
  }

  if (code === 'cleanup_summary_match') {
    return {
      exactCorrection: 'Restored the summary from the approved interview artifact.',
    }
  }

  if (code === 'cleanup_restored_answered') {
    const questionMatch = warning.match(/canonical question (Q\\d+|FU\\d+)/i)
    return { exactCorrection: questionMatch ? \`Restored the approved answered record for question \${questionMatch[1]}.\` : 'Restored the approved answered question record from the canonical interview artifact.' }
  }

  if (code === 'cleanup_answered_by') {
    const targetMatch = warning.match(/question\\s+(Q\\d+|FU\\d+)/i)
    const example = buildBeforeAfterExample(targetMatch?.[1], undefined, 'ai_skip')
    return {
      exactCorrection: targetMatch ? \`Set answered_by to "ai_skip" for question \${targetMatch[1]}.\` : 'Set answered_by to "ai_skip" for the AI-filled question.',
      ...(example ? { examples: [example] } : {}),
    }
  }

  if (code === 'cleanup_mapped_free_text') {
    const targetMatch = warning.match(/question\\s+(Q\\d+|FU\\d+)/i)
    return { exactCorrection: targetMatch ? \`Mapped the free-text answer to canonical option IDs for question \${targetMatch[1]}.\` : 'Mapped the generated free-text answer to the closest canonical option IDs.' }
  }

  if (code === 'cleanup_context_guidance') {
    return { exactCorrection: 'Converted inline context guidance text into the canonical patterns / anti_patterns object.' }
  }

  if (code === 'cleanup_change_type_correction') {
    return { exactCorrection: 'Reclassified or reapplied the refinement change so the declared change list matched the validated content.' }
  }

  if (code === 'cleanup_collapsed_duplicate') {
    return { exactCorrection: 'Collapsed the duplicate refinement change entry.' }
  }

  if (code === 'cleanup_recomputed_score') {
    return { exactCorrection: 'Recomputed the total score from individual dimension scores.' }
  }

  if (code === 'cleanup_trimmed_empty') {
    return { exactCorrection: 'Trimmed empty entries before saving.' }
  }

  if (code === 'cleanup_reordering') {
    return { exactCorrection: 'Re-sorted the items into their correct canonical sequence.' }
  }

  if (code === 'cleanup_interview_status') {
    return { exactCorrection: 'Resolved the interview status field to the expected workflow value.' }
  }

  if (code === 'cleanup_no_prd_refs') {
    const beadMatch = warning.match(/Bead "([^"]+)"/i)
    return { exactCorrection: beadMatch ? \`Flagged bead "\${beadMatch[1]}" for having no PRD references.\` : 'Flagged a bead for having no PRD references.' }
  }

  if (code === 'cleanup_preserved_narrative_substantive') {
    return { exactCorrection: 'Replaced a substantive narrative rewrite with the canonical preserved field content.' }
  }

  if (code === 'cleanup_preserved_narrative') {
    return { exactCorrection: 'Restored the exact canonical preserved field content after detecting cosmetic drift.' }
  }

  if (code === 'cleanup_affected_label') {
    return { exactCorrection: 'Canonicalized the affected_items label to match the authoritative source.' }
  }

  if (code === 'cleanup_canonicalization') {
    return { exactCorrection: 'Normalized the saved artifact detail to the canonical validated value.' }
  }

  if (code === 'retry_after_validation_failure') {
    return {
      exactCorrection: 'Retried after validation failed and kept the first successful validated result.',
    }
  }

  if (code === 'validation_failure_recorded') {
    return {
      exactCorrection: 'Recorded the validation failure message alongside the saved result for debugging.',
    }
  }

  return {}
}
\n`;

code = code.substring(0, startIndex) + replacement + code.substring(endIndex);
fs.writeFileSync(path, code);
console.log('Successfully patched ' + path);
