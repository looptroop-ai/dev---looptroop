import { useCallback, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type {
  ExecutionSetupPlan,
  ExecutionSetupPlanReadiness,
  ExecutionSetupPlanStep,
} from '@/lib/executionSetupPlan'

function StringListEditor({
  items,
  onChange,
  placeholder,
  disabled,
}: {
  items: string[]
  onChange: (items: string[]) => void
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <div className="space-y-1">
      {items.map((item, index) => (
        <div key={index} className="flex items-start gap-1">
          <textarea
            value={item}
            onChange={(event) => {
              const next = [...items]
              next[index] = event.target.value
              onChange(next)
            }}
            disabled={disabled}
            rows={1}
            className="flex-1 min-h-[28px] rounded-md border border-input bg-background px-2 py-1 text-xs resize-y"
            placeholder={placeholder}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
            disabled={disabled}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
          >
            ×
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...items, ''])}
        disabled={disabled}
        className="text-xs h-7"
      >
        + Add
      </Button>
    </div>
  )
}

function SectionLabel({ children }: { children: string }) {
  return <label className="text-[10px] font-semibold uppercase tracking-widest text-foreground/60 block mb-1">{children}</label>
}

function PolicyField({
  label,
  value,
  description,
  placeholder,
  disabled,
  onChange,
}: {
  label: string
  value: string
  description: string
  placeholder: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-muted/20 p-2">
      <div>
        <div className="text-[11px] font-semibold text-foreground">{label}</div>
        <div className="text-[10px] leading-4 text-muted-foreground">{description}</div>
      </div>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
        placeholder={placeholder}
      />
    </div>
  )
}

function createEmptySetupStep(index: number): ExecutionSetupPlanStep {
  const stepNumber = index + 1
  return {
    id: `setup-step-${stepNumber}`,
    title: `Setup Step ${stepNumber}`,
    purpose: '',
    commands: [],
    required: true,
    rationale: '',
    cautions: [],
  }
}

function applyReadinessStatus(
  readiness: ExecutionSetupPlanReadiness,
  status: ExecutionSetupPlanReadiness['status'],
): ExecutionSetupPlanReadiness {
  return {
    ...readiness,
    status,
    actionsRequired: status !== 'ready',
    gaps: status === 'ready' ? [] : readiness.gaps,
  }
}

interface ExecutionSetupPlanEditorProps {
  plan: ExecutionSetupPlan
  disabled?: boolean
  onChange: (plan: ExecutionSetupPlan) => void
}

export function ExecutionSetupPlanEditor({ plan, disabled, onChange }: ExecutionSetupPlanEditorProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(plan.steps.length > 0 ? 0 : null)

  const updatePlan = useCallback((update: Partial<ExecutionSetupPlan>) => {
    onChange({
      ...plan,
      ...update,
    })
  }, [onChange, plan])

  const updateStep = useCallback((index: number, update: Partial<ExecutionSetupPlanStep>) => {
    const nextSteps = plan.steps.map((step, stepIndex) => (
      stepIndex === index ? { ...step, ...update } : step
    ))
    updatePlan({ steps: nextSteps })
  }, [plan.steps, updatePlan])

  const updateReadiness = useCallback((update: Partial<ExecutionSetupPlanReadiness>) => {
    const nextStatus = update.status ?? plan.readiness.status
    const nextReadiness = applyReadinessStatus({
      ...plan.readiness,
      ...update,
    }, nextStatus)
    updatePlan({ readiness: nextReadiness })
  }, [plan.readiness, updatePlan])

  const addStep = useCallback(() => {
    const nextIndex = plan.steps.length
    const nextStatus = plan.readiness.status === 'ready' ? 'partial' : plan.readiness.status
    updatePlan({
      readiness: applyReadinessStatus(plan.readiness, nextStatus),
      steps: [...plan.steps, createEmptySetupStep(nextIndex)],
    })
    setExpandedIndex(nextIndex)
  }, [plan.readiness, plan.steps, updatePlan])

  const removeStep = useCallback((index: number) => {
    const nextSteps = plan.steps.filter((_, stepIndex) => stepIndex !== index)
    const nextReadiness = nextSteps.length === 0
      ? applyReadinessStatus(plan.readiness, 'ready')
      : applyReadinessStatus(plan.readiness, plan.readiness.status === 'ready' ? 'partial' : plan.readiness.status)
    updatePlan({
      readiness: nextReadiness,
      steps: nextSteps,
    })
    setExpandedIndex((current) => {
      if (current == null) return null
      if (nextSteps.length === 0) return null
      if (current === index) return Math.min(index, nextSteps.length - 1)
      if (current > index) return current - 1
      return current
    })
  }, [plan.readiness, plan.steps, updatePlan])

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
        <div className="font-semibold">Structured setup-plan editor</div>
        <p className="mt-1 text-xs leading-5 text-amber-900/80 dark:text-amber-200/90">
          Review the readiness assessment first, then adjust only the temporary setup steps that should run later.
          Use the raw tab for full-power editing.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <SectionLabel>Summary</SectionLabel>
          <textarea
            value={plan.summary}
            onChange={(event) => updatePlan({ summary: event.target.value })}
            disabled={disabled}
            rows={3}
            className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs resize-y"
          />
        </div>
        <div>
          <SectionLabel>Temp Roots</SectionLabel>
          <StringListEditor
            items={plan.tempRoots}
            onChange={(tempRoots) => updatePlan({ tempRoots })}
            disabled={disabled}
            placeholder=".ticket/runtime/execution-setup"
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-3 rounded-lg border border-border bg-background p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <SectionLabel>Readiness Status</SectionLabel>
              <select
                value={plan.readiness.status}
                onChange={(event) => updateReadiness({
                  status: event.target.value as ExecutionSetupPlanReadiness['status'],
                })}
                disabled={disabled}
                className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
              >
                <option value="ready">Ready</option>
                <option value="partial">Partial</option>
                <option value="missing">Missing</option>
              </select>
              {plan.readiness.status === 'ready' && plan.steps.length > 0 ? (
                <div className="mt-1 text-[10px] leading-4 text-amber-700 dark:text-amber-300">
                  Ready status requires removing all setup steps before saving.
                </div>
              ) : null}
            </div>
            <Badge variant={plan.readiness.actionsRequired ? 'default' : 'outline'} className="h-5 text-[10px] shrink-0">
              {plan.readiness.actionsRequired ? 'actions required' : 'no actions required'}
            </Badge>
          </div>
          <div>
            <SectionLabel>Observed Evidence</SectionLabel>
            <StringListEditor
              items={plan.readiness.evidence}
              onChange={(evidence) => updateReadiness({ evidence })}
              disabled={disabled}
              placeholder="Observed repository or runtime evidence..."
            />
          </div>
          <div>
            <SectionLabel>Open Gaps</SectionLabel>
            <StringListEditor
              items={plan.readiness.gaps}
              onChange={(gaps) => updateReadiness({ gaps })}
              disabled={disabled || plan.readiness.status === 'ready'}
              placeholder="Missing prerequisite or unresolved setup gap..."
            />
          </div>
        </div>

        <div>
          <SectionLabel>Plan Cautions</SectionLabel>
          <StringListEditor
            items={plan.cautions}
            onChange={(cautions) => updatePlan({ cautions })}
            disabled={disabled}
            placeholder="Potential risk or caveat..."
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <SectionLabel>Prepare / Bootstrap Commands</SectionLabel>
          <StringListEditor
            items={plan.projectCommands.prepare}
            onChange={(prepare) => updatePlan({ projectCommands: { ...plan.projectCommands, prepare } })}
            disabled={disabled}
            placeholder="Repository-native prepare or bootstrap command"
          />
        </div>
        <div>
          <SectionLabel>Full Test Commands</SectionLabel>
          <StringListEditor
            items={plan.projectCommands.testFull}
            onChange={(testFull) => updatePlan({ projectCommands: { ...plan.projectCommands, testFull } })}
            disabled={disabled}
            placeholder="Repository-native full test command"
          />
        </div>
        <div>
          <SectionLabel>Full Lint Commands</SectionLabel>
          <StringListEditor
            items={plan.projectCommands.lintFull}
            onChange={(lintFull) => updatePlan({ projectCommands: { ...plan.projectCommands, lintFull } })}
            disabled={disabled}
            placeholder="Repository-native full lint command"
          />
        </div>
        <div>
          <SectionLabel>Full Typecheck Commands</SectionLabel>
          <StringListEditor
            items={plan.projectCommands.typecheckFull}
            onChange={(typecheckFull) => updatePlan({ projectCommands: { ...plan.projectCommands, typecheckFull } })}
            disabled={disabled}
            placeholder="Repository-native full typecheck command"
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <SectionLabel>Quality Gate Policy</SectionLabel>
          <div className="space-y-2 rounded-lg border border-border bg-background p-3">
            <PolicyField
              label="Tests"
              value={plan.qualityGatePolicy.tests}
              description="Default testing strategy for later coding beads."
              placeholder="bead-test-commands-first"
              disabled={disabled}
              onChange={(tests) => updatePlan({ qualityGatePolicy: { ...plan.qualityGatePolicy, tests } })}
            />
            <PolicyField
              label="Lint"
              value={plan.qualityGatePolicy.lint}
              description="How broadly lint should run before escalating to repo-wide commands."
              placeholder="impacted-or-package"
              disabled={disabled}
              onChange={(lint) => updatePlan({ qualityGatePolicy: { ...plan.qualityGatePolicy, lint } })}
            />
            <PolicyField
              label="Typecheck"
              value={plan.qualityGatePolicy.typecheck}
              description="How broadly typecheck should run before escalating to repo-wide commands."
              placeholder="impacted-or-package"
              disabled={disabled}
              onChange={(typecheck) => updatePlan({ qualityGatePolicy: { ...plan.qualityGatePolicy, typecheck } })}
            />
            <PolicyField
              label="Fallback"
              value={plan.qualityGatePolicy.fullProjectFallback}
              description="What later phases should do if broad repo-wide gates fail because of unrelated baseline debt."
              placeholder="never-block-on-unrelated-baseline"
              disabled={disabled}
              onChange={(fullProjectFallback) => updatePlan({ qualityGatePolicy: { ...plan.qualityGatePolicy, fullProjectFallback } })}
            />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Setup Steps</div>
            <Badge variant="outline" className="h-5 text-[10px]">{plan.steps.length}</Badge>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addStep}
            disabled={disabled}
            className="text-xs"
          >
            Add Step
          </Button>
        </div>

        {plan.steps.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-4 text-xs text-muted-foreground">
            {plan.readiness.actionsRequired
              ? 'No setup steps are recorded yet. Add the missing temporary steps before saving.'
              : 'No setup steps are recorded because the current readiness assessment says no actions are required. Add a step if you want LoopTroop to run extra temporary preparation.'}
          </div>
        ) : null}

        {plan.steps.map((step, index) => {
          const expanded = expandedIndex === index
          return (
            <div key={step.id || index} id={`execution-setup-step-${index}`} className="rounded-lg border border-border bg-background">
              <button
                type="button"
                onClick={() => setExpandedIndex(expanded ? null : index)}
                className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-accent/30 rounded-t-lg"
              >
                <span className="bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded text-[10px] font-mono shrink-0">
                  #{index + 1}
                </span>
                <span className="text-xs font-medium truncate flex-1">{step.title || `Step ${index + 1}`}</span>
                <Badge variant={step.required ? 'default' : 'outline'} className="h-4 text-[10px]">
                  {step.required ? 'required' : 'optional'}
                </Badge>
                <span className="text-muted-foreground text-[10px]">{expanded ? '▼' : '▶'}</span>
              </button>
              {expanded ? (
                <div className="px-3 pb-3 pt-3 border-t border-border space-y-3">
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeStep(index)}
                      disabled={disabled}
                      className="text-xs text-muted-foreground hover:text-destructive"
                    >
                      Remove Step
                    </Button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <SectionLabel>Step Id</SectionLabel>
                      <input
                        value={step.id}
                        onChange={(event) => updateStep(index, { id: event.target.value })}
                        disabled={disabled}
                        className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                      />
                    </div>
                    <div>
                      <SectionLabel>Title</SectionLabel>
                      <input
                        value={step.title}
                        onChange={(event) => updateStep(index, { title: event.target.value })}
                        disabled={disabled}
                        className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                      />
                    </div>
                  </div>
                  <div>
                    <SectionLabel>Purpose</SectionLabel>
                    <textarea
                      value={step.purpose}
                      onChange={(event) => updateStep(index, { purpose: event.target.value })}
                      disabled={disabled}
                      rows={2}
                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs resize-y"
                    />
                  </div>
                  <div>
                    <SectionLabel>Commands</SectionLabel>
                    <StringListEditor
                      items={step.commands}
                      onChange={(commands) => updateStep(index, { commands })}
                      disabled={disabled}
                      placeholder="Repository-native temporary setup command"
                    />
                  </div>
                  <div>
                    <SectionLabel>Rationale</SectionLabel>
                    <textarea
                      value={step.rationale}
                      onChange={(event) => updateStep(index, { rationale: event.target.value })}
                      disabled={disabled}
                      rows={3}
                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs resize-y"
                    />
                  </div>
                  <div>
                    <SectionLabel>Step Cautions</SectionLabel>
                    <StringListEditor
                      items={step.cautions}
                      onChange={(cautions) => updateStep(index, { cautions })}
                      disabled={disabled}
                      placeholder="Optional caution..."
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={step.required}
                      disabled={disabled}
                      onChange={(event) => updateStep(index, { required: event.target.checked })}
                    />
                    Required step
                  </label>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
