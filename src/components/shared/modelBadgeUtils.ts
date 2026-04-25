import type { LucideIcon } from 'lucide-react'
import {
    Atom,
    Blocks,
    Bot,
    BotMessageSquare,
    BrainCircuit,
    BrainCog,
    Code2,
    Command,
    CircuitBoard,
    CloudLightning,
    Cpu,
    Flame,
    Gem,
    MoonStar,
    Network,
    Orbit,
    Radar,
    ScanSearch,
    SearchCheck,
    Sparkle,
    Sparkles,
    Sprout,
    Terminal,
    Wind,
    Workflow,
} from 'lucide-react'

const OPENAI_MODEL_PATTERN = /(^|[/:\s._-])(gpt|chatgpt|o[1345])([/:\s._-]|$)/

type ModelIconRule = readonly [patterns: readonly string[], icon: LucideIcon]

const LM_ARENA_TEXT_TOP_30_ICON_RULES: readonly ModelIconRule[] = [
    [['claude-opus-4-7-thinking'], BrainCog],
    [['claude-opus-4-6-thinking'], BrainCog],
    [['claude-opus-4-6'], Sparkles],
    [['claude-opus-4-7'], Sparkle],
    [['gemini-3.1-pro-preview'], Gem],
    [['muse-spark'], Flame],
    [['gemini-3-pro'], Gem],
    [['grok-4.20-beta-0309-reasoning'], Radar],
    [['grok-4.20-multi-agent-beta-0309'], Workflow],
    [['grok-4.20-beta1'], Orbit],
    [['gpt-5.4-mini-high'], Cpu],
    [['gpt-5.4-high'], BrainCircuit],
    [['gpt-5.2-chat-latest-20260210'], BotMessageSquare],
    [['gemini-3-flash (thinking-minimal)', 'gemini-3-flash-thinking-minimal'], BrainCog],
    [['gemini-3-flash'], CloudLightning],
    [['claude-opus-4-5-20251101-thinking-32k'], BrainCog],
    [['glm-5.1'], CircuitBoard],
    [['grok-4.1-thinking'], Radar],
    [['claude-opus-4-5-20251101'], Sparkles],
    [['gpt-5.4'], BrainCircuit],
    [['qwen3.5-max-preview'], Blocks],
    [['deepseek-v4-pro-thinking'], ScanSearch],
    [['deepseek-v4-pro'], SearchCheck],
    [['claude-sonnet-4-6'], Sparkle],
    [['grok-4.1'], Orbit],
    [['dola-seed-2.0-pro'], Sprout],
    [['kimi-k2.6'], MoonStar],
    [['glm-5'], CircuitBoard],
    [['gpt-5.1-high'], BrainCircuit],
    [['claude-sonnet-4-5-20250929-thinking-32k'], BrainCog],
]

export function getModelIcon(id: string): LucideIcon {
    const name = id.toLowerCase()
    const arenaTopModelIcon = LM_ARENA_TEXT_TOP_30_ICON_RULES.find(([patterns]) =>
        patterns.some(pattern => name.includes(pattern))
    )?.[1]

    if (arenaTopModelIcon) return arenaTopModelIcon

    if (name.includes('codex')) return Code2
    if (name.includes('opencode')) return Terminal
    if (name.includes('claude') || name.includes('anthropic')) return Sparkles
    if (name.includes('gemini') || name.includes('gemma') || name.includes('google')) return Gem
    if (name.includes('deepseek')) return SearchCheck
    if (name.includes('llama') || name.includes('meta')) return Network
    if (name.includes('mistral') || name.includes('mixtral')) return Wind
    if (name.includes('grok') || name.includes('xai')) return Orbit
    if (name.includes('qwen') || name.includes('dashscope') || name.includes('alibaba')) return Blocks
    if (name.includes('cohere') || name.includes('command-r') || name.includes('command_')) return Command
    if (name.includes('perplexity') || name.includes('sonar')) return SearchCheck
    if (name.includes('kimi') || name.includes('moonshot')) return MoonStar
    if (name.includes('phi') || name.includes('microsoft')) return Cpu
    if (name.includes('glm') || name.includes('zhipu')) return CircuitBoard
    if (name.includes('seed') || name.includes('bytedance')) return Sprout
    if (name.includes('muse')) return Flame
    if (name.includes('reka')) return Atom
    if (name.includes('openai') || OPENAI_MODEL_PATTERN.test(name)) return BrainCircuit

    return Bot
}

export function getModelDisplayName(id: string): string {
    if (!id) return ''
    const cleanId = id.startsWith('model:') ? id.slice(6) : id
    return cleanId.split('/').pop() ?? cleanId
}
