import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type ChoiceProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** The accessible state. Also styles the chip. */
  selected: boolean
  icon?: ReactNode
}

/**
 * A selectable chip — the one implementation behind every "pick one of a
 * few" control (focus presets, theme, day toggles read the same way).
 *
 * Carries its state in `aria-pressed`; groups that are semantically radios
 * (like the theme picker) keep `role="radio"`/`aria-checked` on their own
 * wrapper buttons and use this only through shared styling.
 */
export function Choice({
  selected,
  icon,
  className,
  type = 'button',
  children,
  ...rest
}: ChoiceProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cn(
        'inline-flex min-w-0 items-center justify-center gap-1.5 rounded-md px-3',
        'h-9 text-sm font-medium transition-colors duration-150 ease-tp',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'disabled:pointer-events-none disabled:opacity-45',
        selected
          ? 'border border-accent bg-accent text-on-accent shadow-xs'
          : 'border border-border-subtle bg-surface-raised text-secondary shadow-xs hover:border-border hover:bg-surface-hover hover:text-primary',
        className,
      )}
      {...rest}
    >
      {icon ? (
        <span aria-hidden="true" className="shrink-0">
          {icon}
        </span>
      ) : null}
      <span className="truncate">{children}</span>
    </button>
  )
}
