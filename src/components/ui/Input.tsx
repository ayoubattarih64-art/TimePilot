import { useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  label?: ReactNode
  /** Helper text below the field. Replaced by `error` when that is set. */
  hint?: ReactNode
  error?: string
  iconLeft?: ReactNode
  inputSize?: 'sm' | 'md'
}

const sizes = {
  sm: 'h-8 text-xs',
  md: 'h-9 text-sm',
} as const

export function Input({
  label,
  hint,
  error,
  iconLeft,
  inputSize = 'md',
  className,
  id,
  ...rest
}: InputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const messageId = `${inputId}-message`
  const message = error ?? hint

  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label htmlFor={inputId} className="text-xs font-medium text-secondary">
          {label}
        </label>
      ) : null}

      <div className="relative">
        {iconLeft ? (
          <span
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
            aria-hidden="true"
          >
            {iconLeft}
          </span>
        ) : null}
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          className={cn(
            'w-full rounded-md border bg-surface-raised text-primary',
            'placeholder:text-muted',
            'transition-colors duration-150 ease-tp',
            'focus:outline-2 focus:outline-offset-0 focus:outline-accent',
            'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-muted',
            error ? 'border-critical' : 'border-border hover:border-border-strong',
            sizes[inputSize],
            iconLeft ? 'pl-9' : 'pl-3',
            'pr-3',
            className,
          )}
          {...rest}
        />
      </div>

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
