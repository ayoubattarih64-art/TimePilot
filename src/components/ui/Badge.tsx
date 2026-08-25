import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type BadgeTone =
  | 'neutral'
  | 'accent'
  | 'good'
  | 'warning'
  | 'critical'
  | 'info'

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone
  /**
   * Status tones must not rely on color alone, so pass an icon (or keep the
   * label explicit) whenever the badge carries good/warning/critical meaning.
   */
  icon?: ReactNode
  /** Small colored disc — for legend rows where the label carries the meaning. */
  dot?: boolean
}

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-surface-sunken text-secondary border-border-subtle',
  accent: 'bg-accent-subtle text-accent border-accent-border',
  good: 'bg-good-subtle text-good border-good/30',
  warning: 'bg-warning-subtle text-warning border-warning/30',
  critical: 'bg-critical-subtle text-critical border-critical/30',
  info: 'bg-info-subtle text-info border-info/30',
}

export function Badge({
  tone = 'neutral',
  icon,
  dot = false,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5',
        'text-2xs font-medium',
        tones[tone],
        className,
      )}
      {...rest}
    >
      {dot ? (
        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      ) : null}
      {icon}
      {children}
    </span>
  )
}
