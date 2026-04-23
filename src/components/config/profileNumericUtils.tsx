import { CircleHelp } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { numericFields, getFieldError, type NumericFieldKey } from './numericFieldConfig'
import { ConfigurationDocsLink } from './ConfigurationDocsLink'

export interface NumericFieldProps {
  fieldKey: NumericFieldKey
  rawNumeric: Record<string, string>
  onChange: (key: string, value: string) => void
  hint: string
  tooltip?: string
}

export function NumericField({ fieldKey, rawNumeric, onChange, hint, tooltip }: NumericFieldProps) {
  const cfg = numericFields[fieldKey]
  const error = getFieldError(fieldKey, rawNumeric)
  const unitSuffix = fieldKey === 'councilResponseTimeout' || fieldKey === 'perIterationTimeout' || fieldKey === 'executionSetupTimeout'
    ? ' (s)'
    : fieldKey === 'coverageFollowUpBudgetPercent'
      ? ' (%)'
      : ''

  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-sm font-medium">
        <span>{cfg.label}{unitSuffix}</span>
        {tooltip ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                aria-label={`${cfg.label} help`}
              >
                <CircleHelp className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs leading-relaxed">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <input
        type="number"
        aria-label={cfg.label}
        value={rawNumeric[fieldKey]}
        onChange={e => onChange(fieldKey, e.target.value)}
        className={cn("w-full rounded-md border bg-background px-3 py-2 text-sm", error ? 'border-red-500' : 'border-input')}
      />
      {error ? (
        <p className="text-xs text-red-500 mt-1">{error}</p>
      ) : (
        <div className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
          <p className="min-w-0 flex-1">{hint}</p>
          <ConfigurationDocsLink docsPath={cfg.docsPath} label={cfg.label} />
        </div>
      )}
    </div>
  )
}
