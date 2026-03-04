import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Search, Zap, Eye, Wrench, Brain, AlertCircle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useOpenCodeModels, useAllOpenCodeModels } from '@/hooks/useOpenCodeModels'
import type { OpenCodeModel } from '@/hooks/useOpenCodeModels'

interface ModelPickerProps {
  value: string
  onChange: (modelFullId: string) => void
  placeholder?: string
  disabledValues?: string[]
}

function costLabel(input: number): { label: string; color: string } {
  if (input === 0) return { label: 'Free', color: 'text-emerald-600 bg-emerald-50' }
  if (input < 0.5) return { label: 'Cheap', color: 'text-green-700 bg-green-50' }
  if (input < 2) return { label: '$', color: 'text-yellow-700 bg-yellow-50' }
  if (input < 8) return { label: '$$', color: 'text-orange-700 bg-orange-50' }
  return { label: '$$$', color: 'text-red-700 bg-red-50' }
}

function ctxLabel(ctx: number): string {
  if (!ctx) return ''
  if (ctx >= 1_000_000) return `${(ctx / 1_000_000).toFixed(0)}M`
  if (ctx >= 1_000) return `${(ctx / 1_000).toFixed(0)}K`
  return String(ctx)
}

function ModelRow({ model, selected, disabled, onSelect }: {
  model: OpenCodeModel
  selected: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  const cost = costLabel(model.costInput)
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        'w-full text-left px-3 py-2.5 flex items-start gap-3 transition-colors',
        'hover:bg-accent focus:bg-accent outline-none',
        selected && 'bg-primary/8',
        disabled && 'opacity-40 cursor-not-allowed hover:bg-transparent focus:bg-transparent',
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={cn('text-sm font-medium truncate', selected && 'text-primary')}>
            {model.name}
          </span>
          {selected && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground font-medium shrink-0">
              selected
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded-full', cost.color)}>
            {cost.label}
          </span>
          {model.contextWindow > 0 && (
            <span className="text-[10px] text-muted-foreground font-mono">
              {ctxLabel(model.contextWindow)} ctx
            </span>
          )}
          {model.canReason && (
            <span className="flex items-center gap-0.5 text-[10px] text-purple-600">
              <Brain className="h-2.5 w-2.5" aria-hidden="true" />reasoning
            </span>
          )}
          {model.canSeeImages && (
            <span className="flex items-center gap-0.5 text-[10px] text-blue-600">
              <Eye className="h-2.5 w-2.5" aria-hidden="true" />vision
            </span>
          )}
          {model.canUseTools && (
            <span className="flex items-center gap-0.5 text-[10px] text-slate-500">
              <Wrench className="h-2.5 w-2.5" aria-hidden="true" />tools
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

export function ModelPicker({ value, onChange, placeholder = 'Search models…', disabledValues = [] }: ModelPickerProps) {
  const [showAll, setShowAll] = useState(false)
  const { data: connectedModels, isLoading: loadingConnected, isError: errorConnected } = useOpenCodeModels()
  const { data: allModels, isLoading: loadingAll, isError: errorAll } = useAllOpenCodeModels()
  const models = showAll ? allModels : connectedModels
  const isLoading = showAll ? loadingAll : loadingConnected
  const isError = showAll ? errorAll : errorConnected
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownNodeRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const applyPosition = useCallback((node: HTMLDivElement) => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    const maxH = 420
    node.style.position = 'fixed'
    node.style.left = `${rect.left}px`
    node.style.width = `${rect.width}px`
    node.style.zIndex = '9999'
    if (spaceAbove > spaceBelow) {
      node.style.bottom = `${window.innerHeight - rect.top + 4}px`
      node.style.top = ''
      node.style.maxHeight = `${Math.min(maxH, spaceAbove - 12)}px`
    } else {
      node.style.top = `${rect.bottom + 4}px`
      node.style.bottom = ''
      node.style.maxHeight = `${Math.min(maxH, spaceBelow - 12)}px`
    }
  }, [])

  const dropdownRef = useCallback((node: HTMLDivElement | null) => {
    dropdownNodeRef.current = node
    if (node) {
      applyPosition(node)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [applyPosition])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (
        !containerRef.current?.contains(e.target as Node) &&
        !(e.target as Element)?.closest('[data-model-dropdown]')
      ) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Reposition on scroll/resize
  useEffect(() => {
    if (!open) return
    const handler = () => { if (dropdownNodeRef.current) applyPosition(dropdownNodeRef.current) }
    window.addEventListener('scroll', handler, true)
    window.addEventListener('resize', handler)
    return () => {
      window.removeEventListener('scroll', handler, true)
      window.removeEventListener('resize', handler)
    }
  }, [open, applyPosition])

  const selected = models?.find(m => m.fullId === value) ?? allModels?.find(m => m.fullId === value) ?? connectedModels?.find(m => m.fullId === value)

  const filtered = useMemo(() => {
    if (!models) return []
    const q = query.trim().toLowerCase()
    if (!q) return models.slice(0, 200) // show top 200 unfiltered
    return models.filter(m =>
      m.name.toLowerCase().includes(q) ||
      m.providerName.toLowerCase().includes(q) ||
      m.providerID.toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q) ||
      m.family.toLowerCase().includes(q)
    )
  }, [models, query])

  // Group by provider
  const grouped = useMemo(() => {
    const groups = new Map<string, { providerName: string; models: OpenCodeModel[] }>()
    for (const m of filtered) {
      if (!groups.has(m.providerID)) {
        groups.set(m.providerID, { providerName: m.providerName, models: [] })
      }
      groups.get(m.providerID)!.models.push(m)
    }
    return Array.from(groups.entries())
  }, [filtered])

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Pick a model"
        onClick={() => setOpen(v => !v)}
        className={cn(
          'w-full flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-2.5',
          'text-sm text-left transition-colors',
          'hover:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          open && 'border-ring ring-2 ring-ring',
        )}
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" aria-hidden="true" />
        ) : (
          <Zap className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
        )}
        <span className="flex-1 truncate">
          {isError ? (
            <span className="text-destructive text-xs">OpenCode not reachable</span>
          ) : selected ? (
            <>
              <span className="font-medium">{selected.name}</span>
              <span className="text-muted-foreground ml-1.5 text-xs">{selected.providerName}</span>
            </>
          ) : value ? (
            <span className="font-mono text-xs">{value}</span>
          ) : (
            <span className="text-muted-foreground">{isLoading ? 'Loading models…' : placeholder}</span>
          )}
        </span>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground shrink-0 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>

      {/* Dropdown — portaled to body to escape modal overflow */}
      {open && createPortal(
        <div
          ref={dropdownRef}
          data-model-dropdown
          role="listbox"
          aria-label="Available models"
          className={cn(
            'rounded-lg border border-border bg-popover shadow-xl',
            'flex flex-col overflow-hidden',
          )}
        >
          {/* Search */}
          <div className="flex items-center gap-2 border-b border-border px-3 py-2 shrink-0">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by name, provider, family…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              aria-label="Search models"
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery('')}
                className="text-muted-foreground hover:text-foreground text-xs"
              >
                ✕
              </button>
            )}
          </div>

          {/* Results */}
          <div className="overflow-y-auto flex-1">
            {isError && (
              <div className="flex items-center gap-2 px-4 py-6 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                Could not connect to OpenCode at 127.0.0.1:4096.
                Make sure <code className="font-mono text-xs">opencode serve</code> is running.
              </div>
            )}

            {isLoading && (
              <div className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading models from OpenCode…
              </div>
            )}

            {!isLoading && !isError && grouped.length === 0 && (
              <div className="px-4 py-6 text-sm text-muted-foreground text-center">
                No models match "{query}"
              </div>
            )}

            {grouped.map(([providerID, { providerName, models: pModels }]) => (
              <div key={providerID}>
                <div className="sticky top-0 bg-popover/95 backdrop-blur-sm px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/40">
                  {providerName}
                  <span className="ml-1.5 font-normal normal-case opacity-60">
                    {pModels.length} {pModels.length === 1 ? 'model' : 'models'}
                  </span>
                </div>
                {pModels.map(m => (
                  <ModelRow
                    key={m.fullId}
                    model={m}
                    selected={m.fullId === value}
                    disabled={m.fullId !== value && disabledValues.includes(m.fullId)}
                    onSelect={() => {
                      onChange(m.fullId)
                      setOpen(false)
                      setQuery('')
                    }}
                  />
                ))}
              </div>
            ))}

            {!query && filtered.length >= 200 && (
              <div className="text-center text-xs text-muted-foreground py-3 border-t border-border/40">
                Showing first 200 of {models?.length ?? 0} — type to search all
              </div>
            )}
          </div>

          {/* Show all providers toggle */}
          <label className="flex items-center gap-2 px-3 py-2 border-t border-border/40 cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={showAll}
              onChange={e => setShowAll(e.target.checked)}
              className="rounded border-input"
            />
            <span className="text-xs text-muted-foreground">
              Show all providers {allModels ? `(${allModels.length} models)` : ''} — currently showing {connectedModels?.length ?? 0} connected
            </span>
          </label>
        </div>,
        document.body
      )}
    </div>
  )
}
