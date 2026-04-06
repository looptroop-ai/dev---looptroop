import { describe, expect, it } from 'vitest'
import { buildInterviewDiffEntries } from '../phaseArtifactTypes'

describe('phaseArtifactTypes', () => {
  it('drops persisted interview ui diff entries when before and after text are trim-identical', () => {
    const interviewDocument = JSON.stringify({
      questions: [
        {
          id: 'Q01',
          phase: 'Foundation',
          question: 'Should the theme switcher keep the same layout?',
        },
      ],
    })

    const entries = buildInterviewDiffEntries(JSON.stringify({
      originalContent: interviewDocument,
      refinedContent: interviewDocument,
      uiRefinementDiff: {
        domain: 'interview',
        winnerId: 'openai/gpt-5.4',
        generatedAt: '2026-04-06T11:38:37.016Z',
        entries: [
          {
            key: 'Q01:modified:0',
            changeType: 'modified',
            itemKind: 'question',
            label: 'Q01',
            beforeId: 'Q01',
            afterId: 'Q01',
            beforeText: 'Should the theme switcher keep the same layout?',
            afterText: '  Should the theme switcher keep the same layout?  ',
            attributionStatus: 'model_unattributed',
          },
        ],
      },
    }))

    expect(entries).toEqual([])
  })
})
