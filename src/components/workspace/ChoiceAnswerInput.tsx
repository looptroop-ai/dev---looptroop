import { useId } from 'react'
import type { InterviewQuestionOption, InterviewQuestionAnswerType } from '@shared/interviewSession'

interface ChoiceAnswerInputProps {
  questionId: string
  answerType: InterviewQuestionAnswerType
  options: InterviewQuestionOption[]
  selectedIds: string[]
  freeText: string
  isBusy: boolean
  onToggle: (optionId: string) => void
  onTextChange: (value: string) => void
}

export function ChoiceAnswerInput({
  questionId,
  answerType,
  options,
  selectedIds,
  freeText,
  isBusy,
  onToggle,
  onTextChange,
}: ChoiceAnswerInputProps) {
  const baseId = useId()
  const isSingle = answerType === 'single_choice'

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5" role={isSingle ? 'radiogroup' : 'group'} aria-label="Answer options">
        {options.map((option) => {
          const inputId = `${baseId}-${option.id}`
          const isChecked = selectedIds.includes(option.id)
          return (
            <label
              key={option.id}
              htmlFor={inputId}
              className={[
                'flex items-center gap-2.5 px-3 py-2 rounded-md border cursor-pointer select-none transition-colors',
                'text-sm',
                isBusy
                  ? 'opacity-50 cursor-not-allowed border-border'
                  : isChecked
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border hover:border-primary/50 hover:bg-muted/50 text-foreground',
              ].join(' ')}
            >
              <input
                id={inputId}
                type={isSingle ? 'radio' : 'checkbox'}
                name={isSingle ? `choice-${questionId}` : undefined}
                checked={isChecked}
                disabled={isBusy}
                onChange={() => onToggle(option.id)}
                className="accent-primary"
              />
              <span>{option.label}</span>
            </label>
          )
        })}
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor={`${baseId}-freetext`}
          className="text-xs text-muted-foreground font-medium"
        >
          {selectedIds.length > 0 ? 'Additional notes (optional)' : 'Or write your own answer'}
        </label>
        <textarea
          id={`${baseId}-freetext`}
          value={freeText}
          onChange={(e) => onTextChange(e.target.value)}
          disabled={isBusy}
          placeholder={selectedIds.length > 0 ? 'Add any extra context...' : 'Type your answer here...'}
          rows={2}
          className={[
            'w-full resize-none rounded-md border bg-background px-3 py-2 text-sm',
            'placeholder:text-muted-foreground/60',
            'focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary',
            isBusy ? 'opacity-50 cursor-not-allowed border-border' : 'border-border',
          ].join(' ')}
        />
      </div>
    </div>
  )
}
