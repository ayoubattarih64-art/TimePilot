import { useId } from 'react'
import { WEEKDAY_ORDER, weekdayInitial, weekdayName, type Weekday } from '../../models'
import { cn } from '../../lib/cn'

export type DayPickerProps = {
  value: readonly Weekday[]
  onChange: (next: Weekday[]) => void
  /** Rendered as the group's accessible name. */
  label?: string
  hint?: string
}

/**
 * The `M T W T F S S` row.
 *
 * A group of toggle buttons rather than checkboxes, because at panel width the
 * seven labels have to be single letters — and a single letter is not an
 * accessible name, so each button carries the day's full name in `aria-label`
 * and its state in `aria-pressed`. Monday-first display order; the values
 * themselves stay `Date.getDay()` numbers.
 */
export function DayPicker({
  value,
  onChange,
  label = 'Days',
  hint,
}: DayPickerProps) {
  // Generated rather than fixed: two pickers on one page (a routine step and
  // the row above it) would otherwise share one id and label each other.
  const labelId = useId()

  const toggle = (day: Weekday) => {
    onChange(
      value.includes(day)
        ? value.filter((entry) => entry !== day)
        : [...value, day].sort((a, b) => a - b),
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-secondary" id={labelId}>
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex items-stretch gap-1"
      >
        {WEEKDAY_ORDER.map((day) => {
          const on = value.includes(day)
          return (
            <button
              key={day}
              type="button"
              aria-pressed={on}
              aria-label={weekdayName(day)}
              onClick={() => toggle(day)}
              className={cn(
                'h-8 min-w-0 flex-1 rounded-md border text-xs font-medium',
                'transition-colors duration-150',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                on
                  ? 'border-accent bg-accent text-on-accent'
                  : 'border-border bg-surface-raised text-secondary hover:bg-surface-hover hover:text-primary',
              )}
            >
              <span aria-hidden="true">{weekdayInitial(day)}</span>
            </button>
          )
        })}
      </div>
      {hint ? <p className="text-2xs text-muted">{hint}</p> : null}
    </div>
  )
}
