import { describe, expect, it } from 'vitest'
import { buildStructuredRetryPrompt } from '../yamlUtils'

describe.concurrent('buildStructuredRetryPrompt', () => {
  it('adds the no-tool rule only when explicitly requested', () => {
    const withRule = buildStructuredRetryPrompt([], {
      validationError: 'missing schema_version',
      rawResponse: 'draft: nope',
      doNotUseTools: true,
    })
    const withoutRule = buildStructuredRetryPrompt([], {
      validationError: 'missing schema_version',
      rawResponse: 'draft: nope',
    })

    expect(withRule[0]?.content).toContain('Do not use tools.')
    expect(withoutRule[0]?.content).not.toContain('Do not use tools.')
  })
})
