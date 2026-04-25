import { describe, expect, it } from 'vitest'
import { Bot } from 'lucide-react'
import { getModelIcon } from '../modelBadgeUtils'

const LM_ARENA_TEXT_TOP_30_MODELS = [
    'Anthropic claude-opus-4-7-thinking',
    'Anthropic claude-opus-4-6-thinking',
    'Anthropic claude-opus-4-6',
    'Anthropic claude-opus-4-7',
    'gemini-3.1-pro-preview',
    'Meta muse-spark',
    'gemini-3-pro',
    'grok-4.20-beta1',
    'gpt-5.4-high',
    'grok-4.20-beta-0309-reasoning',
    'gpt-5.2-chat-latest-20260210',
    'grok-4.20-multi-agent-beta-0309',
    'gemini-3-flash',
    'Anthropic claude-opus-4-5-20251101-thinking-32k',
    'glm-5.1',
    'grok-4.1-thinking',
    'Anthropic claude-opus-4-5-20251101',
    'gpt-5.4',
    'qwen3.5-max-preview',
    'deepseek-v4-pro',
    'Anthropic claude-sonnet-4-6',
    'gemini-3-flash (thinking-minimal)',
    'deepseek-v4-pro-thinking',
    'grok-4.1',
    'Bytedance dola-seed-2.0-pro',
    'kimi-k2.6',
    'gpt-5.4-mini-high',
    'glm-5',
    'gpt-5.1-high',
    'Anthropic claude-sonnet-4-5-20250929-thinking-32k',
]

describe('getModelIcon', () => {
    it('has non-fallback icons for the current LM Arena Text top 30', () => {
        for (const modelId of LM_ARENA_TEXT_TOP_30_MODELS) {
            expect(getModelIcon(modelId), modelId).not.toBe(Bot)
        }
    })
})
