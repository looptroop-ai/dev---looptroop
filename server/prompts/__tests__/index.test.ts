import { describe, expect, it } from 'vitest'
import type { PromptPart } from '../../opencode/types'
import { buildConversationalPrompt, buildPromptFromTemplate, PROM1, PROM2, PROM3, PROM4, PROM5, PROM11, PROM21 } from '../index'

const contextParts: PromptPart[] = [
  {
    type: 'text',
    source: 'ticket_details',
    content: [
      '## Primary User Requirement For This Ticket',
      'This is the exact requirement provided by the user for this ticket. Treat it as the primary source of truth for scope and intent.',
      '',
      '# Ticket: Improve and optimise',
      'Change kubernete version',
    ].join('\n'),
  },
  {
    type: 'text',
    source: 'codebase_map',
    content: [
      'ticket_id: "KRPI4-2"',
      'artifact: "codebase_map"',
      'manifests:',
      '  - "package.json"',
      'files:',
      '  - "src/main.ts"',
    ].join('\n'),
  },
]

describe('prompt builders', () => {
  function expectStrictVotePrompt(prompt: string) {
    expect(prompt).toContain('The top-level key MUST be `draft_scores`')
    expect(prompt).toContain('using the exact provided draft label as the key')
    expect(prompt).toContain('Do not output prose, explanations, markdown fences, comments, rankings, winners, averages, extra keys, or omitted drafts.')
    expect(prompt).toContain('`total_score`')
  }

  it('renders source labels instead of generic text headings', () => {
    const prompt = buildPromptFromTemplate(PROM1, contextParts)

    expect(prompt).toContain('### ticket_details')
    expect(prompt).toContain('### codebase_map')
    expect(prompt).not.toContain('### text')
    expect(prompt.indexOf('### ticket_details')).toBeLessThan(prompt.indexOf('### codebase_map'))
  })

  it('keeps conversational prompts aligned with the same context labels', () => {
    const prompt = buildConversationalPrompt(PROM1, contextParts)

    expect(prompt).toContain('### ticket_details')
    expect(prompt).toContain('### codebase_map')
    expect(prompt).not.toContain('### text')
  })

  it('frames interview prompts as caps rather than quotas', () => {
    const draftPrompt = buildPromptFromTemplate(PROM1, contextParts)
    const interviewVotePrompt = buildPromptFromTemplate(PROM2, contextParts)
    const prdVotePrompt = buildPromptFromTemplate(PROM11, contextParts)
    const beadsVotePrompt = buildPromptFromTemplate(PROM21, contextParts)
    const refinePrompt = buildPromptFromTemplate(PROM3, contextParts)
    const qaPrompt = buildPromptFromTemplate(PROM4, contextParts)
    const coveragePrompt = buildPromptFromTemplate(PROM5, contextParts)

    expect(draftPrompt).toContain('Treat `max_initial_questions` as a hard upper bound, but endeavor to approach that limit')
    expect(draftPrompt).not.toContain('Aim to use nearly all available question slots')

    expectStrictVotePrompt(interviewVotePrompt)
    expect(interviewVotePrompt).toContain('MUST contain exactly 6 integer fields on single lines')

    expectStrictVotePrompt(prdVotePrompt)
    expect(prdVotePrompt).toContain('Coverage of requirements')
    expect(prdVotePrompt).toContain('Risks / edge cases addressed')

    expectStrictVotePrompt(beadsVotePrompt)
    expect(beadsVotePrompt).toContain('Coverage of PRD requirements')
    expect(beadsVotePrompt).toContain('Quality and isolation of bead-scoped tests')

    expect(refinePrompt).toContain('do not pad the list just because space remains')
    expect(refinePrompt).not.toContain('the final output must not exceed the `max_initial_questions` limit')

    expect(qaPrompt).toContain('where the total may change')
    expect(qaPrompt).toContain('Do not use the follow-up budget unless it materially improves coverage.')
    expect(qaPrompt).not.toContain('question 12/50')

    expect(coveragePrompt).toContain('Do not generate follow-up questions merely because budget remains.')
    expect(coveragePrompt).not.toContain('generate targeted follow-up questions to resolve them')
  })
})
