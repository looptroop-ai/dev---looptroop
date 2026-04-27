import { defineConfig } from 'vitepress'

const githubRepo = 'https://github.com/looptroop-ai/LoopTroop'

const sidebar = [
  {
    text: 'Start Here',
    collapsed: false,
    items: [
      { text: 'Home', link: '/' },
      { text: 'Getting Started', link: '/getting-started' },
      { text: 'Core Philosophy', link: '/core-philosophy' },
      { text: 'FAQ', link: '/faq' },
    ],
  },
  {
    text: 'Workflow',
    collapsed: false,
    items: [
      { text: 'Ticket Flow', link: '/ticket-flow' },
      { text: 'State Machine', link: '/state-machine' },
      { text: 'LLM Council', link: '/llm-council' },
      { text: 'Beads', link: '/beads' },
      { text: 'Execution Loop', link: '/execution-loop' },
    ],
  },
  {
    text: 'Architecture',
    collapsed: false,
    items: [
      { text: 'System Architecture', link: '/system-architecture' },
      { text: 'Context Isolation', link: '/context-isolation' },
      { text: 'OpenCode Integration', link: '/opencode-integration' },
      { text: 'Frontend', link: '/frontend' },
      { text: 'Database Schema', link: '/database-schema' },
    ],
  },
  {
    text: 'Reference',
    collapsed: false,
    items: [
      { text: 'API Reference', link: '/api-reference' },
    ],
  },
  {
    text: 'Direction',
    collapsed: false,
    items: [
      { text: 'Roadmap', link: '/roadmap' },
    ],
  },
]

export default defineConfig({
  title: 'LoopTroop',
  description: 'Durable repo-scale AI delivery through council planning, isolated worktrees, and explicit approvals.',
  cleanUrls: true,
  lastUpdated: true,
  markdown: {
    config(md) {
      md.set({ html: false })

      const defaultFence = md.renderer.rules.fence?.bind(md.renderer.rules)

      md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const token = tokens[idx]
        if (token.info.trim() === 'mermaid') {
          const encoded = encodeURIComponent(token.content)
          return `<MermaidBlock encoded="${encoded}" />`
        }

        if (defaultFence) {
          return defaultFence(tokens, idx, options, env, self)
        }

        return self.renderToken(tokens, idx, options)
      }
    },
  },
  themeConfig: {
    siteTitle: 'LoopTroop Docs',
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Workflow', link: '/ticket-flow' },
      { text: 'Architecture', link: '/system-architecture' },
      { text: 'Roadmap', link: '/roadmap' },
      { text: 'GitHub', link: githubRepo },
    ],
    sidebar,
    search: {
      provider: 'local',
    },
    outline: {
      level: [2, 3],
      label: 'On this page',
    },
    editLink: {
      pattern: `${githubRepo}/edit/main/docs/:path`,
      text: 'Edit this page on GitHub',
    },
    socialLinks: [
      { icon: 'github', link: githubRepo },
    ],
    docFooter: {
      prev: 'Previous',
      next: 'Next',
    },
    footer: {
      message: 'LoopTroop documentation for the current runtime.',
      copyright: 'Built for durable repository-scale AI delivery.',
    },
  },
})
