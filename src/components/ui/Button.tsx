import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'subtle'
  | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Leading icon. Sized by the caller; 16px suits sm/md. */
  iconLeft?: ReactNode
  iconRight?: ReactNode
  /** Square button with no label — `aria-label` becomes required in practice. */
  iconOnly?: boolean
  fullWidth?: boolean
}

const base =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium ' +
  'whitespace-nowrap transition-colors duration-150 ease-tp select-none ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ' +
  'disabled:pointer-events-none disabled:opacity-45'

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-on-accent shadow-xs hover:bg-accent-hover active:bg-accent-active',
  secondary:
    'bg-surface-raised text-primary border border-border-subtle shadow-xs ' +
    'hover:border-border hover:bg-surface-hover active:bg-surface-active',
  ghost: 'text-secondary hover:bg-surface-hover hover:text-primary active:bg-surface-active',
  subtle: 'bg-accent-subtle text-accent hover:bg-accent-subtle/70',
  danger: 'bg-critical text-white shadow-xs hover:brightness-110 active:brightness-95',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-3.5 text-sm',
  lg: 'h-10 px-5 text-sm',
}

const iconSizes: Record<ButtonSize, string> = {
  sm: 'h-8 w-8',
  md: 'h-9 w-9',
  lg: 'h-10 w-10',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  iconLeft,
  iconRight,
  iconOnly = false,
  fullWidth = false,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        base,
        variants[variant],
        iconOnly ? iconSizes[size] : sizes[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  )
}
