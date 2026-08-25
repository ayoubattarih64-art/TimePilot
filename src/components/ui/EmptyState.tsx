import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type EmptyStateProps = {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
  /** `compact` suits an empty section inside a populated page. */
  size?: 'compact' | 'full'
}

/** Neutral empty state: an explanation and, where useful, the way out of it. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  size = 'full',
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg text-center',
        size === 'full' ? 'px-6 py-10' : 'px-4 py-7',
        className,
      )}
    >
      {icon ? (
        <span
          className={cn(
            'mb-3 grid place-items-center rounded-full bg-surface-sunken text-muted',
            size === 'full' ? 'h-11 w-11' : 'h-9 w-9',
          )}
          aria-hidden="true"
        >
          {icon}
        </span>
      ) : null}
      <p className="text-sm font-medium text-primary">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-[24rem] text-xs leading-relaxed text-secondary">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
