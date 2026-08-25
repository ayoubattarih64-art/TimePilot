import { Bell, Timer } from 'lucide-react'
import { cn } from '../../lib/cn'
import type { ActivityType } from '../../models'

export type ActivityTypeBadgeProps = {
  type: ActivityType
  /** `icon` drops the text — only for rows where the label appears alongside. */
  variant?: 'full' | 'icon'
  className?: string
}

const meta = {
  reminder: { label: 'Reminder', Icon: Bell },
  timer: { label: 'Timer', Icon: Timer },
} as const satisfies Record<
  ActivityType,
  { label: string; Icon: typeof Bell }
>

/**
 * Names an activity's type. Type is carried by icon *and* text, never colour —
 * colour is reserved for category, so the two encodings stay separable.
 */
export function ActivityTypeBadge({
  type,
  variant = 'full',
  className,
}: ActivityTypeBadgeProps) {
  const { label, Icon } = meta[type]

  if (variant === 'icon') {
    return (
      <Icon
        size={13}
        strokeWidth={2}
        className={cn('shrink-0 text-muted', className)}
        aria-label={label}
        role="img"
      />
    )
  }

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-sm',
        'border border-border-subtle bg-surface-sunken px-1.5 py-0.5',
        'text-2xs font-medium text-secondary',
        className,
      )}
    >
      <Icon size={11} strokeWidth={2.25} aria-hidden="true" />
      {label}
    </span>
  )
}
