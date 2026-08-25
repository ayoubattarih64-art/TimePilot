import { cn } from '../../lib/cn'

export type SwitchProps = {
  /** Accessible name — the control has no visible text of its own. */
  label: string
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  className?: string
}

/**
 * A toggle for binary, reversible state ("this routine may schedule").
 *
 * `role="switch"` on a real <button>: Space and Enter come free, and the
 * state lives in `aria-checked` where assistive tech expects it. The knob
 * slides on the shared easing curve; the reduced-motion rule collapses the
 * movement to an instant swap.
 */
export function Switch({
  label,
  checked,
  onChange,
  disabled = false,
  className,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full',
        'transition-colors duration-150 ease-tp',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'disabled:pointer-events-none disabled:opacity-45',
        checked ? 'bg-accent' : 'bg-border-strong',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-0.5 h-4 w-4 rounded-full bg-white shadow-xs',
          'transition-transform duration-150 ease-tp',
          checked ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </button>
  )
}
