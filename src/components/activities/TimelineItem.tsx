import { cn } from '../../lib/cn'
import { CATEGORY_BG } from '../../lib/categoryColors'
import { formatTimeOfDay } from '../../lib/activityFormat'
import { categoryOf, type ScheduledActivity } from '../../models'
import { ActivityTypeBadge } from './ActivityTypeBadge'

export type TimelineItemProps = {
  activity: ScheduledActivity
  /** The instant this occurrence starts. */
  at: number
  /** Dims the row once the time has passed. */
  past?: boolean
  onSelect?: (activity: ScheduledActivity) => void
  className?: string
}

/**
 * A single row in a day's timeline: time on the left, activity on the right.
 *
 * The time column is a fixed 3.25rem so times line up down the list — the thing
 * that makes a timeline scannable — while the title takes the remaining width.
 */
export function TimelineItem({
  activity,
  at,
  past = false,
  onSelect,
  className,
}: TimelineItemProps) {
  const category = categoryOf(activity)
  const interactive = typeof onSelect === 'function'

  const content = (
    <>
      <time
        dateTime={new Date(at).toISOString()}
        className={cn(
          'tabular w-12 shrink-0 pt-px text-xs font-medium',
          past ? 'text-muted' : 'text-secondary',
        )}
      >
        {formatTimeOfDay(at)}
      </time>

      <span
        className={cn(
          'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
          CATEGORY_BG[category.slot],
          past && 'opacity-50',
        )}
        aria-hidden="true"
      />

      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-sm',
            past ? 'text-secondary' : 'font-medium text-primary',
          )}
        >
          {activity.title}
        </span>
      </span>

      <ActivityTypeBadge type={activity.type} variant="icon" className="mt-0.5" />
    </>
  )

  const shell = cn(
    'flex w-full items-start gap-3 rounded-md px-2.5 py-2 text-left',
    interactive &&
      'transition-colors duration-150 ease-tp hover:bg-surface-hover ' +
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
    className,
  )

  return interactive ? (
    <button type="button" onClick={() => onSelect(activity)} className={shell}>
      {content}
    </button>
  ) : (
    <div className={shell}>{content}</div>
  )
}
