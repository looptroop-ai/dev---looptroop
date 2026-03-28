import { describe, expect, it } from 'vitest'
import {
  PROM0,
  PROM1,
  PROM2,
  PROM3,
  PROM4,
  PROM5,
  PROM10a,
  PROM10b,
  PROM11,
  PROM12,
  PROM13,
  PROM20,
  PROM21,
  PROM22,
  PROM23,
  PROM24,
  PROM51,
  PROM52,
  buildPromptFromTemplate,
} from '../index'

describe('structured prompt hardening', () => {
  it('keeps the interview refinement prompt explicit about phase order and self-checks', () => {
    const prompt = buildPromptFromTemplate(PROM3, [])
    expect(prompt).toContain('Phase Order Is Mandatory')
    expect(prompt).toContain('Final Self-Check')
    expect(prompt).toContain('Preserve the winning draft\'s existing `id`')
    expect(prompt).toContain('YAML with top-level `questions` list and top-level `changes` list')
    expect(prompt).toContain('Return one YAML artifact')
    expect(prompt).toContain('Do not split the refined questions and change metadata')
  })

  it('treats interview question limits as a ceiling rather than a target', () => {
    const draftPrompt = buildPromptFromTemplate(PROM1, [])
    const refinePrompt = buildPromptFromTemplate(PROM3, [])

    expect(draftPrompt).toContain('hard upper bound, never a target')
    expect(draftPrompt).toContain('Return one complete final `questions` list in this single response')
    expect(draftPrompt).toContain('do not emit a partial subset or phased draft')
    expect(refinePrompt).toContain('hard upper bound, never a target')
    expect(draftPrompt).not.toContain('endeavor to approach that limit')
  })

  it('uses the shared coverage envelope for interview, PRD, and beads coverage prompts', () => {
    for (const prompt of [PROM5, PROM13, PROM24]) {
      expect(prompt.outputFormat).toContain('status')
      expect(prompt.outputFormat).toContain('gaps')
      expect(prompt.outputFormat).toContain('follow_up_questions')
      expect(prompt.outputFormat).toContain('double-quoted strings')
    }
  })

  it('adds the no-tool rule only to in-scope non-execution prompts', () => {
    for (const prompt of [
      PROM1,
      PROM2,
      PROM3,
      PROM4,
      PROM5,
      PROM10a,
      PROM10b,
      PROM11,
      PROM12,
      PROM13,
      PROM20,
      PROM21,
      PROM22,
      PROM24,
    ]) {
      expect(buildPromptFromTemplate(prompt, [])).toContain('Do not use tools.')
    }

    for (const prompt of [PROM0, PROM23, PROM51, PROM52]) {
      expect(buildPromptFromTemplate(prompt, [])).not.toContain('Do not use tools.')
    }
  })

  it('defines an explicit shared PRD schema contract for draft and refine prompts', () => {
    expect(PROM12.outputFormat).toContain(PROM10b.outputFormat)
    expect(PROM12.outputFormat).toContain('top-level `changes` list')
    expect(PROM12.outputFormat).toContain('inspiration')
    expect(PROM10b.outputFormat).toContain('schema_version')
    expect(PROM10b.outputFormat).toContain('technical_requirements')
    expect(PROM10b.outputFormat).toContain('required_commands')
    expect(PROM10b.outputFormat).not.toContain('PROM13.output_file')

    const draftPrompt = buildPromptFromTemplate(PROM10b, [])
    expect(draftPrompt).toContain('Schema Contract')
    expect(draftPrompt).toContain('Complete Interview Input')
    expect(draftPrompt).toContain('artifact: "prd"')
    expect(draftPrompt).toContain('acceptance_criteria')
    expect(draftPrompt).toContain('Begin the artifact at `schema_version` and end at `approval.approved_at`')
    expect(draftPrompt).toContain('shorten field text instead of truncating later epics')
    expect(draftPrompt).toContain('Never output implementation plans, diffs, next steps, acknowledgements, commentary')

    const refinePrompt = buildPromptFromTemplate(PROM12, [])
    expect(refinePrompt).toContain('Return one YAML artifact')
    expect(refinePrompt).toContain('Do not split the refined PRD and change metadata')
  })

  it('keeps PROM10a strict about preserving user answers and outputting only a full interview artifact', () => {
    const gapPrompt = buildPromptFromTemplate(PROM10a, [])
    expect(gapPrompt).toContain('The approved Interview Results artifact is already included in the prompt')
    expect(gapPrompt).toContain('Preserve every existing non-skipped answer exactly as-is')
    expect(gapPrompt).toContain('The only fields you may change are `questions[*].answer`')
    expect(gapPrompt).toContain('provide a concrete `free_text` and/or `selected_option_ids`')
    expect(gapPrompt).toContain('set a non-empty ISO-8601 `answered_at` timestamp')
    expect(gapPrompt).toContain('no question may remain with `answer.skipped: true`')
    expect(gapPrompt).toContain('populate canonical `selected_option_ids` using the provided option IDs')
    expect(gapPrompt).toContain('shorten answer text instead of omitting later question blocks')
    expect(gapPrompt).toContain('Do not read files, search for more context, propose an implementation plan')
    expect(gapPrompt).toContain('Stop immediately after the final `approval` block')
    expect(gapPrompt).toContain('answered_by: ai_skip')
    expect(gapPrompt).toContain('status: draft')
    expect(gapPrompt).toContain('Return the entire interview artifact from `schema_version` through the final `approval` block')
    expect(gapPrompt).toContain('Return exactly one complete interview artifact and nothing else')
  })

  it('keeps PRD coverage output envelope-only without PRD rewrite instructions', () => {
    const coveragePrompt = buildPromptFromTemplate(PROM13, [])
    expect(coveragePrompt).toContain('return only YAML with top-level `status`, `gaps`, and `follow_up_questions`')
    expect(coveragePrompt).toContain('max_coverage_passes')
    expect(coveragePrompt).toContain('Every item in `gaps` must be a double-quoted YAML string')
    expect(coveragePrompt).toContain('`follow_up_questions` is always `[]` for PRD coverage')
    expect(coveragePrompt).toContain('`follow_up_questions` must always be `[]`')
    expect(coveragePrompt).toContain('Do not output a rewritten PRD')
    expect(coveragePrompt).not.toContain('Provide the necessary additions or modifications to the PRD')
  })

  it('keeps interview coverage explicit about structured follow-up question objects', () => {
    const coveragePrompt = buildPromptFromTemplate(PROM5, [])
    expect(coveragePrompt).toContain('return only YAML with top-level `status`, `gaps`, and `follow_up_questions`')
    expect(coveragePrompt).toContain('follow_up_budget_remaining')
    expect(coveragePrompt).toContain('max_coverage_passes')
    expect(coveragePrompt).toContain('Every item in `gaps` must be a double-quoted YAML string')
    expect(coveragePrompt).toContain('`id`, `question`, `phase`, `priority`, `rationale`')
    expect(coveragePrompt).toContain('Do not return plain strings in `follow_up_questions`')
    expect(coveragePrompt).toContain('Do not output rewritten interview results')
    expect(coveragePrompt).toContain('ready for interview approval')
    expect(coveragePrompt).toContain('PRD generation begins only after that approval step')
  })

  it('keeps beads coverage explicit about quoted gap strings', () => {
    const coveragePrompt = buildPromptFromTemplate(PROM24, [])
    expect(coveragePrompt).toContain('Every item in `gaps` must be a double-quoted YAML string')
    expect(coveragePrompt).toContain('backticks, or punctuation')
  })

  it('requires the bead subset schema consistently in draft and refine prompts', () => {
    expect(PROM20.outputFormat).toContain('top-level `beads` list')
    expect(PROM20.outputFormat).toContain('`id`')
    expect(PROM22.outputFormat).toContain(PROM20.outputFormat)
    expect(PROM22.outputFormat).toContain('top-level `changes` list')
    expect(PROM22.outputFormat).toContain('inspiration')

    const refinePrompt = buildPromptFromTemplate(PROM22, [])
    expect(refinePrompt).toContain('Return one YAML artifact')
    expect(refinePrompt).toContain('Do not split the refined beads and change metadata')
  })

  it('keeps PROM4 and PROM52 explicit about marker-only structured output', () => {
    const interviewPrompt = buildPromptFromTemplate(PROM4, [])
    const finalTestPrompt = buildPromptFromTemplate(PROM52, [])

    expect(interviewPrompt).toContain('primary interview checklist')
    expect(interviewPrompt).toContain('work through the compiled question set faithfully')
    expect(interviewPrompt).toContain('fully resolves one or more future compiled questions')
    expect(interviewPrompt).toContain('preserve its original compiled question ID whenever possible')
    expect(interviewPrompt).toContain('when a prior answer fully resolves that question')
    expect(interviewPrompt).toContain('Do not move to the final free-form question just because coverage feels good enough')
    expect(interviewPrompt).toContain("Keep the question anchored to 'Anything else to add before PRD generation?'")
    expect(interviewPrompt).toContain('coverage check may still create targeted follow-up questions')
    expect(interviewPrompt).toContain('interview approval step before PRD drafting begins')
    expect(interviewPrompt).toContain('Output Discipline')
    expect(interviewPrompt).toContain('Formatting Discipline')
    expect(interviewPrompt).toContain('schema_version: 1')
    expect(interviewPrompt).toContain('follow_up_rounds:')
    expect(interviewPrompt).not.toContain('PROM5.output_file schema')
    expect(finalTestPrompt).toContain('Output Discipline')
    expect(finalTestPrompt).toContain('Final Self-Check')
  })
})
