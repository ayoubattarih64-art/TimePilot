import { formatDuration } from './time'
import {
  nextOccurrenceOf,
  toInstant,
  type RepeatRule,
  type ScheduledActivity,
} from '../models'

/**
 * Presentation helpers for scheduled activities. Pure string/number work, no
 * React and no Chrome APIs, so surfaces and the worker can both use them.
 */

const MINUTE_MS = 60_000
const DAY_MS = 86_400_000

/** "18:00" from a timestamp, in the user's locale 24/12-hour convention. */
export function formatTimeOfDay(at: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(at)
}

/** "Today", "Tomorrow", or "Mon 24 Aug" — relative to `now`'s local day. */
export function formatDayLabel(at: number, now = Date.now()): string {
  const dayOf = (value: number) => {
    const date = new Date(value)
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }
  const days = Math.round((dayOf(at) - dayOf(now)) / DAY_MS)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(at)
}

/**
 * "Starts in 38 minutes" / "Started 5 minutes ago" / "Now".
 * Rounded to the minute — a countdown to the second belongs on a running timer,
 * not on a schedule.
 */
export function formatRelativeStart(at: number, now = Date.now()): string {
  const deltaMs = at - now
  const minutes = Math.round(deltaMs / MINUTE_MS)
  if (minutes === 0) return 'Now'

  const magnitude = formatDuration(Math.abs(minutes) * MINUTE_MS)
  return minutes > 0 ? `Starts in ${magnitude}` : `Started ${magnitude} ago`
}

const REPEAT_LABELS: Record<RepeatRule, string> = {
  none: 'Once',
  daily: 'Every day',
  weekdays: 'Weekdays',
  weekly: 'Every week',
}

export function formatRepeat(repeat: RepeatRule): string {
  return REPEAT_LABELS[repeat]
}

/** The line under an activity's title: "Today · 18:00", plus repeat if set. */
export function formatSchedule(
  activity: ScheduledActivity,
  now = Date.now(),
): string {
  const at = nextOccurrenceOf(activity, now) ?? toInstant(activity.date, activity.time)
  if (at === null) return 'No date set'

  const base = `${formatDayLabel(at, now)} · ${formatTimeOfDay(at)}`
  return activity.repeat === 'none'
    ? base
    : `${base} · ${formatRepeat(activity.repeat)}`
}

/** A greeting keyed to the local hour. Neutral, no cultural framing. */
export function greetingFor(now = Date.now()): string {
  const hour = new Date(now).getHours()
  if (hour < 5) return 'Good night'
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}
