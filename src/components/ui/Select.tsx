import { useId, type ReactNode, type SelectHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export type SelectOption = {
  value: string
  label: string
}

export type SelectProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'size' | 'children'
> & {
  label?: ReactNode
  hint?: ReactNode
  error?: string
  options: readonly SelectOption[]
  selectSize?: 'sm' | 'md'
}

const sizes = {
  sm: 'h-8 text-xs',
  md: 'h-9 text-sm',
} as const

/**
 * A native <select>. Deliberately not a custom listbox: the native control gets
 * keyboard support, screen-reader semantics, and correct overlay behaviour in a
 * narrow side panel for free, and it cannot be clipped by the panel's edge.
 */
export function Select({
  label,
  hint,
  error,
  options,
  selectSize = 'md',
  className,
  id,
  ...rest
}: SelectProps) {
  const generatedId = useId()
  const selectId = id ?? generatedId
  const messageId = `${selectId}-message`
  const message = error ?? hint

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {label ? (
        <label htmlFor={selectId} className="text-xs font-medium text-secondary">
          {label}
        </label>
      ) : null}

      <select
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={message ? messageId : undefined}
        className={cn(
          'w-full min-w-0 appearance-none rounded-md border bg-surface-raised',
          'px-3 pr-8 text-primary transition-colors duration-150 ease-tp',
          'focus:outline-2 focus:outline-offset-0 focus:outline-accent',
          'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-muted',
          // Chevron drawn as a background image so no extra element is needed.
          "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%221.5%22%3E%3Cpath%20d%3D%22M4%206.5L8%2010.5L12%206.5%22%2F%3E%3C%2Fsvg%3E')]",
          'bg-[length:16px_16px] bg-[position:right_0.5rem_center] bg-no-repeat',
          error ? 'border-critical' : 'border-border hover:border-border-strong',
          sizes[selectSize],
          className,
        )}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {message ? (
        <p
          id={messageId}
          className={cn('text-2xs', error ? 'text-critical' : 'text-muted')}
        >
          {message}
        </p>
      ) : null}
    </div>
  )
}
