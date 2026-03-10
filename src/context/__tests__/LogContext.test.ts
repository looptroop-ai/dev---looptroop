import { describe, expect, it } from 'vitest'
import { formatLogLine } from '@/context/LogContext'

describe('formatLogLine', () => {
  it('keeps reasoning content unprefixed so the UI can render THINKING tags', () => {
    expect(formatLogLine({
      type: 'model_output',
      kind: 'reasoning',
      content: '**Planning phased question strategy**',
      source: 'model:openai/gpt-5.1-codex',
      audience: 'ai',
    }).line).toBe('**Planning phased question strategy**')
  })

  it('continues to prefix non-reasoning model output with MODEL tags', () => {
    expect(formatLogLine({
      type: 'model_output',
      kind: 'text',
      content: 'phase: discovery',
      source: 'model:openai/gpt-5.1-codex',
      audience: 'ai',
    }).line).toBe('[MODEL] phase: discovery')
  })
})
