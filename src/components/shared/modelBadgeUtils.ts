import type { LucideIcon } from 'lucide-react'
import {
    Atom,
    Blocks,
    Bot,
    BrainCircuit,
    Code2,
    Command,
    Cpu,
    Gem,
    MoonStar,
    Network,
    Orbit,
    SearchCheck,
    Sparkles,
    Terminal,
    Wind,
} from 'lucide-react'

const OPENAI_MODEL_PATTERN = /(^|[/:\s._-])(gpt|chatgpt|o[1345])([/:\s._-]|$)/

export function getModelIcon(id: string): LucideIcon {
    const name = id.toLowerCase()

    if (name.includes('codex')) return Code2
    if (name.includes('opencode')) return Terminal
    if (name.includes('claude') || name.includes('anthropic')) return Sparkles
    if (name.includes('gemini') || name.includes('google')) return Gem
    if (name.includes('deepseek')) return SearchCheck
    if (name.includes('llama') || name.includes('meta')) return Network
    if (name.includes('mistral') || name.includes('mixtral')) return Wind
    if (name.includes('grok') || name.includes('xai')) return Orbit
    if (name.includes('qwen') || name.includes('dashscope') || name.includes('alibaba')) return Blocks
    if (name.includes('cohere') || name.includes('command-r') || name.includes('command_')) return Command
    if (name.includes('perplexity') || name.includes('sonar')) return SearchCheck
    if (name.includes('kimi') || name.includes('moonshot')) return MoonStar
    if (name.includes('phi') || name.includes('microsoft')) return Cpu
    if (name.includes('reka')) return Atom
    if (name.includes('openai') || OPENAI_MODEL_PATTERN.test(name)) return BrainCircuit

    return Bot
}

export function getModelDisplayName(id: string): string {
    if (!id) return ''
    const cleanId = id.startsWith('model:') ? id.slice(6) : id
    return cleanId.split('/').pop() ?? cleanId
}
