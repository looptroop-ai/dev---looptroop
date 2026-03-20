import { cn } from '@/lib/utils'
import { numericFields, getFieldError, type NumericFieldKey } from './numericFieldConfig'

export interface NumericFieldProps {
  fieldKey: NumericFieldKey
  rawNumeric: Record<string, string>
  onChange: (key: string, value: string) => void
  hint: string
}

export function NumericField({ fieldKey, rawNumeric, onChange, hint }: NumericFieldProps) {
  const cfg = numericFields[fieldKey]
  const error = getFieldError(fieldKey, rawNumeric)

  return (
    <div>
      <label className="text-sm font-medium block mb-1">{cfg.label}{fieldKey === 'councilResponseTimeout' || fieldKey === 'perIterationTimeout' ? ' (s)' : fieldKey === 'coverageFollowUpBudgetPercent' ? ' (%)' : ''}</label>
      <input
        type="number"
        value={rawNumeric[fieldKey]}
        onChange={e => onChange(fieldKey, e.target.value)}
        className={cn("w-full rounded-md border bg-background px-3 py-2 text-sm", error ? 'border-red-500' : 'border-input')}
      />
      {error ? (
        <p className="text-xs text-red-500 mt-1">{error}</p>
      ) : (
        <p className="text-xs text-muted-foreground mt-1">{hint}</p>
      )}
    </div>
  )
}
