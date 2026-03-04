import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface StructuredViewerProps {
  content: string
  className?: string
}

interface Section {
  key: string
  value: string
  depth: number
  children: Section[]
}

function parseYamlToSections(content: string): Section[] {
  const sections: Section[] = []
  const lines = content.split('\n')

  for (const line of lines) {
    const trimmed = line.trimStart()
    if (!trimmed || trimmed.startsWith('#')) continue

    const depth = line.length - trimmed.length
    const colonIndex = trimmed.indexOf(':')

    if (colonIndex > 0) {
      const key = trimmed.slice(0, colonIndex).trim()
      const value = trimmed.slice(colonIndex + 1).trim()
      sections.push({ key, value, depth, children: [] })
    }
  }

  return sections
}

function SectionItem({ section }: { section: Section }) {
  const [expanded, setExpanded] = useState(true)
  const hasChildren = section.children.length > 0

  return (
    <div className="ml-2" style={{ marginLeft: section.depth * 8 }}>
      <button
        className="flex items-center gap-1 text-sm hover:bg-accent rounded px-1 py-0.5 w-full text-left"
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        {hasChildren ? (
          expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />
        ) : (
          <span className="w-3" />
        )}
        <span className="font-medium text-blue-600 dark:text-blue-400">{section.key}</span>
        {section.value && (
          <span className="text-muted-foreground ml-1">: {section.value}</span>
        )}
      </button>
      {expanded && hasChildren && section.children.map((child, i) => (
        <SectionItem key={i} section={child} />
      ))}
    </div>
  )
}

export function StructuredViewer({ content, className }: StructuredViewerProps) {
  const sections = parseYamlToSections(content)

  if (sections.length === 0) {
    return (
      <div className={cn('text-sm text-muted-foreground italic p-4', className)}>
        No content to display
      </div>
    )
  }

  return (
    <div className={cn('bg-muted rounded-md p-3 font-mono text-xs', className)}>
      {sections.map((section, i) => (
        <SectionItem key={i} section={section} />
      ))}
    </div>
  )
}
