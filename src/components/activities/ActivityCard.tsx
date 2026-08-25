import { BellOff, BellRing, Check, Clock, Trash2 } from 'lucide-react'
import { cn } from '../../lib/cn'
import { CATEGORY_BG } from '../../lib/categoryColors'
import { formatSchedule, formatTimeOfDay } from '../../lib/activityFormat'
import {
  categoryOf,
  hasPendingOccurrence,
  isCompletedForLastFire,
  isSchedulable,
  SNOOZE_MINUTES,
  type ScheduledActivity,
} from '../../models'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { ActivityTypeBadge } from './ActivityTypeBadge'

export type ActivityCardProps = {
  activity: ScheduledActivity
  /** Reference instant for the relative schedule line. Comes from `useNow`. */
  now: number
  /**
   * When this activity's next notification will fire, read back from
   * chrome.alarms by the worker. Absent means no alarm is registered.
   */
  scheduledAt?: number
  /** Opens the editor. Omit for a static card. */
  onEdit?: (activity: ScheduledActivity) => void
  onDelete?: (activity: ScheduledActivity) => void
  /** Toggles whether the activity may fire. Omit to hide the control. */
  onToggleEnabled?: (activity: ScheduledActivity, enabled: boolean) => void
  /** Marks the fired occurrence done. Omit to hide the pending-action row. */
  onComplete?: (activity: ScheduledActivity) => void
  onSnooze?: (activity: ScheduledActivity, minutes: number) => void
  className?: string
}

/**
 * One planned activity, as a card. Built for a narrow panel: the title truncates,
 * the metadata row wraps, and nothing has a fixed width.
 *
 * Category identity is carried by the swatch *and* the category name in text, so
 * it never rests on colour alone. The three status facts the scheduling phase
 * added — enabled, scheduled, completed — are each a labelled badge for the same
 * reason.
 */
export function ActivityCard({
  activity,
  now,
  scheduledAt,
  onEdit,
  onDelete,
  onToggleEnabled,
  onComplete,
  onSnooze,
  className,
}: ActivityCardProps) {
  const category = categoryOf(activity)
  const interactive = typeof onEdit === 'function'
  const completed = isCompletedForLastFire(activity)
  // "Scheduled" means Chrome holds an alarm — not merely that a time is set.
  const scheduled = scheduledAt !== undefined
  const wantsNotification = isSchedulable(activity)
  // Done/Snooze are offered here as well as on the notification, so a dismissed
  // notification does not strand the occurrence.
  const pending =
    hasPendingOccurrence(activity, now) &&
    (typeof onComplete === 'function' || typeof onSnooze === 'function')

  return (
    <div
      className={cn(
        'group relative',
        interactive &&
          'transition-colors duration-150 ease-tp hover:bg-surface-hover',
        !activity.enabled && 'opacity-70',
        className,
      )}
    >
      {/* The whole card is the edit affordance; the delete button sits above it. */}
      {interactive ? (
        <button
          type="button"
          onClick={() => onEdit(activity)}
          className={cn(
            'absolute inset-0 rounded-md',
            'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
          )}
        >
          <span className="sr-only">{`Edit ${activity.title}`}</span>
        </button>
      ) : null}

      <div className="pointer-events-none relative flex items-start gap-2.5 px-4 py-3">
        <span
          className={cn(
            'mt-1.5 h-2 w-2 shrink-0 rounded-full',
            CATEGORY_BG[category.slot],
          )}
          aria-hidden="true"
        />

        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'truncate text-sm font-medium text-primary',
              !activity.enabled && 'text-secondary',
            )}
          >
            {activity.title}
          </p>
          <p className="mt-0.5 text-xs text-secondary">
            {formatSchedule(activity, now)}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {/* An icon, not a second chip: type reads at a glance without
                competing with the status badges below. */}
            <ActivityTypeBadge type={activity.type} variant="icon" />
            <span className="text-2xs text-muted">{category.name}</span>
            {activity.durationMinutes > 0 ? (
              <span className="tabular text-2xs text-muted">
                {activity.durationMinutes} min
              </span>
            ) : null}

            {completed ? (
              <Badge
                tone="good"
                icon={<Check size={10} strokeWidth={2.5} aria-hidden="true" />}
              >
                Done
              </Badge>
            ) : null}

            {!activity.enabled ? (
              <Badge
                tone="neutral"
                icon={<BellOff size={10} strokeWidth={2.25} aria-hidden="true" />}
              >
                Paused
              </Badge>
            ) : scheduled ? (
              <Badge
                tone="accent"
                icon={<BellRing size={10} strokeWidth={2.25} aria-hidden="true" />}
              >
                {`Alarm ${formatTimeOfDay(scheduledAt)}`}
              </Badge>
            ) : wantsNotification ? (
              // Wants one and has none: the reminder will not fire. Say so
              // rather than leaving the absence of a badge to be noticed.
              <Badge tone="warning">Not scheduled</Badge>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {onToggleEnabled ? (
            <IconButton
              label={
                activity.enabled
                  ? `Pause ${activity.title}`
                  : `Resume ${activity.title}`
              }
              size="sm"
              icon={
                activity.enabled ? (
                  <BellRing size={14} strokeWidth={2} />
                ) : (
                  <BellOff size={14} strokeWidth={2} />
                )
              }
              onClick={() => onToggleEnabled(activity, !activity.enabled)}
              className={cn(
                'pointer-events-auto relative',
                // A paused activity keeps its control visible: the state is not
                // discoverable by hovering.
                activity.enabled &&
                  'opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
              )}
            />
          ) : null}

          {onDelete ? (
            <IconButton
              label={`Delete ${activity.title}`}
              size="sm"
              icon={<Trash2 size={14} strokeWidth={2} />}
              onClick={() => onDelete(activity)}
              className={cn(
                'pointer-events-auto relative',
                // Always reachable by keyboard; revealed on hover for the mouse.
                'opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
              )}
            />
          ) : null}
        </div>
      </div>

      {/* A fired occurrence nobody has dealt with. Sits below the row body so
          the actions are not competing with the edit affordance. */}
      {pending ? (
        <div className="pointer-events-auto relative flex flex-wrap items-center gap-1.5 border-t border-border-subtle px-4 py-2.5">
          <span className="mr-auto inline-flex items-center gap-1 text-2xs text-secondary">
            <Clock size={11} strokeWidth={2.25} aria-hidden="true" />
            {`Due ${formatTimeOfDay(activity.lastFiredAt ?? now)}`}
          </span>

          {onComplete ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onComplete(activity)}
              iconLeft={<Check size={13} strokeWidth={2.5} aria-hidden="true" />}
            >
              Done
            </Button>
          ) : null}

          {onSnooze
            ? SNOOZE_MINUTES.map((minutes) => (
                <Button
                  key={minutes}
                  variant="ghost"
                  size="sm"
                  onClick={() => onSnooze(activity, minutes)}
                  aria-label={`Snooze ${activity.title} ${String(minutes)} minutes`}
                >
                  {`+${String(minutes)}m`}
                </Button>
              ))
            : null}
        </div>
      ) : null}
    </div>
  )
}
