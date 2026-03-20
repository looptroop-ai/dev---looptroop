export function getModelIcon(name: string): string {
    const n = name.toLowerCase()
    if (n.includes('claude')) return '🟣'
    if (n.includes('gpt')) return '🟢'
    if (n.includes('gemini')) return '🔵'
    if (n.includes('codex')) return '🟢'
    if (n.includes('opencode')) return '🟠'
    if (n.includes('pickle')) return '🟠'
    if (n.includes('deepseek')) return '🔴'
    if (n.includes('llama') || n.includes('meta')) return '🟤'
    return '⚪'
}

export function getModelDisplayName(id: string): string {
    if (!id) return ''
    const cleanId = id.startsWith('model:') ? id.slice(6) : id
    return cleanId.split('/').pop() ?? cleanId
}
