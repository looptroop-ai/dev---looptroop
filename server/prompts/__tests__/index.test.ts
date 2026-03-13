import { describe, expect, it } from 'vitest'
import { PROM3, PROM4, PROM5, PROM13, PROM20, PROM22, PROM24, PROM52, buildPromptFromTemplate } from '../index'

describe('structured prompt hardening', () => {
  it('keeps the interview refinement prompt explicit about phase order and self-checks', () => {
    const prompt = buildPromptFromTemplate(PROM3, [])
    expect(prompt).toContain('Phase Order Is Mandatory')
    expect(prompt).toContain('Final Self-Check')
  })

  it('uses the shared coverage envelope for interview, PRD, and beads coverage prompts', () => {
    for (const prompt of [PROM5, PROM13, PROM24]) {
      expect(prompt.outputFormat).toContain('status')
      expect(prompt.outputFormat).toContain('gaps')
      expect(prompt.outputFormat).toContain('follow_up_questions')
    }
  })

  it('requires the bead subset schema consistently in draft and refine prompts', () => {
    expect(PROM20.outputFormat).toContain('top-level `beads` list')
    expect(PROM20.outputFormat).toContain('`id`')
    expect(PROM22.outputFormat).toBe(PROM20.outputFormat)
  })

  it('keeps PROM4 and PROM52 explicit about marker-only structured output', () => {
    const interviewPrompt = buildPromptFromTemplate(PROM4, [])
    const finalTestPrompt = buildPromptFromTemplate(PROM52, [])

    expect(interviewPrompt).toContain('Output Discipline')
    expect(interviewPrompt).toContain('Formatting Discipline')
    expect(finalTestPrompt).toContain('Output Discipline')
    expect(finalTestPrompt).toContain('Final Self-Check')
  })
})
