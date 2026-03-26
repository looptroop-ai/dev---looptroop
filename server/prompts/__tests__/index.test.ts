import { describe, expect, it } from 'vitest'
import { PROM1, PROM3, PROM4, PROM5, PROM09D, PROM10, PROM12, PROM13, PROM20, PROM22, PROM24, PROM52, buildPromptFromTemplate } from '../index'

describe('structured prompt hardening', () => {
  it('keeps the interview refinement prompt explicit about phase order and self-checks', () => {
    const prompt = buildPromptFromTemplate(PROM3, [])
    expect(prompt).toContain('Phase Order Is Mandatory')
    expect(prompt).toContain('Final Self-Check')
    expect(prompt).toContain('Preserve the winning draft\'s existing `id`')
    expect(prompt).toContain('YAML with top-level `questions` list')
    expect(prompt).not.toContain('top-level `changes` list')
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

  it('defines an explicit shared PRD schema contract for draft and refine prompts', () => {
    expect(PROM12.outputFormat).toContain(PROM10.outputFormat)
    expect(PROM12.outputFormat).not.toContain('top-level `changes` list')
    expect(PROM12.outputFormat).not.toContain('inspiration')
    expect(PROM10.outputFormat).toContain('schema_version')
    expect(PROM10.outputFormat).toContain('technical_requirements')
    expect(PROM10.outputFormat).toContain('required_commands')
    expect(PROM10.outputFormat).not.toContain('PROM13.output_file')

    const draftPrompt = buildPromptFromTemplate(PROM10, [])
    expect(draftPrompt).toContain('Schema Contract')
    expect(draftPrompt).toContain('Complete Interview Input')
    expect(draftPrompt).toContain('artifact: "prd"')
    expect(draftPrompt).toContain('acceptance_criteria')
  })

  it('keeps PROM09d strict about preserving user answers and outputting only a full interview artifact', () => {
    const gapPrompt = buildPromptFromTemplate(PROM09D, [])
    expect(gapPrompt).toContain('Preserve every existing non-skipped answer exactly as-is')
    expect(gapPrompt).toContain('answered_by: ai_skip')
    expect(gapPrompt).toContain('status: draft')
    expect(gapPrompt).toContain('Return exactly one complete interview artifact and nothing else')
  })

  it('keeps PRD coverage output envelope-only without PRD rewrite instructions', () => {
    const coveragePrompt = buildPromptFromTemplate(PROM13, [])
    expect(coveragePrompt).toContain('return only YAML with top-level `status`, `gaps`, and `follow_up_questions`')
    expect(coveragePrompt).toContain('max_coverage_passes')
    expect(coveragePrompt).toContain('Every item in `gaps` must be a double-quoted YAML string')
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
    expect(PROM22.outputFormat).not.toContain('top-level `changes` list')
    expect(PROM22.outputFormat).not.toContain('inspiration')
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
    expect(interviewPrompt).toContain('Output Discipline')
    expect(interviewPrompt).toContain('Formatting Discipline')
    expect(interviewPrompt).toContain('schema_version: 1')
    expect(interviewPrompt).toContain('follow_up_rounds:')
    expect(interviewPrompt).not.toContain('PROM5.output_file schema')
    expect(finalTestPrompt).toContain('Output Discipline')
    expect(finalTestPrompt).toContain('Final Self-Check')
  })
})
