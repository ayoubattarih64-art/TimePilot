import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  /**
   * `flat` is the default: a border and no shadow. Shadows are reserved for
   * surfaces that genuinely float (menus, dialogs), so cards stay calm.
   */
  elevation?: 'flat' | 'raised'
  /** Turns the card into a hover/press target. Pair with a real button or link inside. */
  interactive?: boolean
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

const paddings = {
  none: '',
  sm: 'p-3.5',
  md: 'p-4',
  lg: 'p-5',
} as const

export function Card({
  elevation = 'flat',
  interactive = false,
  padding = 'md',
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border-subtle bg-surface-raised',
        elevation === 'raised' && 'shadow-sm',
        interactive &&
          'transition-colors duration-150 ease-tp hover:border-border hover:bg-surface-hover',
        paddings[padding],
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}
