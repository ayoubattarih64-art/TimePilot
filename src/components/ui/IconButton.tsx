import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Required: the button has no visible text, so this is its only name. */
  label: string
  icon: ReactNode
  variant?: 'ghost' | 'secondary'
  size?: 'sm' | 'md'
}

const variants = {
  ghost:
    'text-secondary hover:bg-surface-hover hover:text-primary active:bg-surface-active',
  secondary:
    'border border-border-subtle bg-surface-raised text-primary hover:bg-surface-hover',
} as const

const sizes = {
  sm: 'h-7 w-7',
  md: 'h-8 w-8',
} as const

/**
 * A square, label-less control. Separate from Button so the accessible name
 * cannot be forgotten — `label` is required and becomes `aria-label`.
 */
export function IconButton({
  label,
  icon,
  variant = 'ghost',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md',
        'transition-colors duration-150 ease-tp',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'disabled:pointer-events-none disabled:opacity-45',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      <span aria-hidden="true" className="contents">
        {icon}
      </span>
    </button>
  )
}
