import type { Category, Timestamp } from './activity'
// Type-only, so it is erased at compile time: `routine.ts` imports the date
// helpers below, and a value import here would close that into a real cycle.
import type { RoutineStepType } from './routine'

/**
 * The product's scheduled Activity — something the user planned. This is
 * distinct from `Activity` in ./activity, which is a span of time that was
 * actually tracked.
 *
 * Times are stored as local wall-clock strings rather than absolute timestamps,
 * for the same reason routines are: a 06:30 reminder should stay 06:30 across a
 * DST shift or a flight. The absolute instant is computed against the current
 * clock whenever it is needed.
 */

/**
 * Types implemented in this phase. Focus, Routine and Website Block are planned
 * and deliberately absent from the union — adding them before they work would
 * force every switch to handle cases that cannot occur.
 */
export type ActivityType = 'reminder' | 'timer'

export const ACTIVITY_TYPES: readonly ActivityType[] = ['reminder', 'timer']

export type RepeatRule = 'none' | 'daily' | 'weekdays' | 'weekly'

/** How far ahead of the start time the user wants to be notified. */
export type NotifyLead = 'none' | 'at-time' | 'min-5' | 'min-15'

export type ScheduledActivity = {
  id: string
  title: string
  type: ActivityType
  /** Local calendar date, YYYY-MM-DD. The first occurrence when repeating. */
  date: string
  /** Local start time, HH:MM on a 24-hour clock. */
  time: string
  repeat: RepeatRule
  /** Planned length in minutes. 0 means unspecified. */
  durationMinutes: number
  /** An id from ACTIVITY_CATEGORIES, or CUSTOM_CATEGORY_ID. */
  categoryId: string
  /** Set only when categoryId is CUSTOM_CATEGORY_ID. */
  customCategory?: string
  notify: NotifyLead
  createdAt: Timestamp
  /** A disabled activity keeps its schedule but never fires. */
  enabled: boolean
  /**
   * Fire time of the most recent notification raised for this activity.
   *
   * This is the one-shot guard: an occurrence whose fire time is at or before
   * this instant is never raised again, so a re-entrant alarm or a reconcile
   * running in the same millisecond as a fire cannot double-notify.
   */
  lastFiredAt?: Timestamp | null
  /** When the user last marked an occurrence done. Never affects scheduling. */
  lastCompletedAt?: Timestamp | null
  /**
   * Set when this row was generated from a routine.
   *
   * The routine is the source and this is the copy: the marks below are what let
   * regeneration recognise its own rows — so editing a routine can replace them
   * and deleting one can remove them — without ever touching an activity the
   * user created by hand. Absent on everything the user typed themselves.
   */
  routineId?: string | null
  /** The routine step this row came from. Set with `routineId` or not at all. */
  routineStepId?: string | null
  /**
   * What the step *is*, which the activity type alone cannot say: `ActivityType`
   * has no `focus` member, so a focus step is stored as a timer and this is the
   * only field that distinguishes the two. The surfaces read it to offer the
   * right action — start a timer, start a focus session — from the engines that
   * already exist.
   */
  routineStepType?: RoutineStepType | null
}

/**
 * What is actually in chrome.storage: whatever was written there, by any
 * version of this code or by anything else running as the extension. Repaired
 * on read by `normalizeActivity` rather than by a schema migration.
 */
export type StoredScheduledActivity = unknown

/**
 * Repair a stored activity, or drop it.
 *
 * Same contract as `normalizeTimerSession`, `normalizeBlocklist` and
 * `normalizeRoutine`, and for the same reason: `chrome.storage.local` is
 * writable by anything with the extension's origin, and a row nothing
 * downstream can make sense of must not reach the scheduler, the surfaces, or
 * the routine planner. Every field is checked against the type rather than
 * trusted, so a record written before a field existed reads as if it had the
 * default all along.
 *
 * Two things make a row unusable rather than merely incomplete, and both drop
 * it: no id, because nothing can address it, and no resolvable date and time,
 * because every occurrence, alarm and list position is derived from those. A
 * row that survives is fully formed.
 */
export function normalizeActivity(
  stored: StoredScheduledActivity,
): ScheduledActivity | null {
  if (typeof stored !== 'object' || stored === null) return null
  const raw = stored as Partial<ScheduledActivity>

  if (typeof raw.id !== 'string' || raw.id.length === 0) return null
  if (typeof raw.date !== 'string' || typeof raw.time !== 'string') return null
  if (toInstant(raw.date, raw.time) === null) return null

  const routineId = typeof raw.routineId === 'string' ? raw.routineId : null
  const routineStepId =
    typeof raw.routineStepId === 'string' ? raw.routineStepId : null

  return {
    id: raw.id,
    title:
      typeof raw.title === 'string' && raw.title.trim().length > 0
        ? raw.title.trim()
        : 'Untitled activity',
    type: raw.type === 'timer' ? 'timer' : 'reminder',
    date: raw.date,
    time: raw.time,
    repeat: isRepeatRule(raw.repeat) ? raw.repeat : 'none',
    durationMinutes:
      typeof raw.durationMinutes === 'number' &&
      Number.isFinite(raw.durationMinutes)
        ? Math.max(0, Math.round(raw.durationMinutes))
        : 0,
    categoryId:
      typeof raw.categoryId === 'string' && raw.categoryId.length > 0
        ? raw.categoryId
        : 'personal',
    ...(typeof raw.customCategory === 'string'
      ? { customCategory: raw.customCategory }
      : {}),
    notify: isNotifyLead(raw.notify) ? raw.notify : 'at-time',
    createdAt:
      typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
        ? raw.createdAt
        : 0,
    enabled: raw.enabled !== false,
    lastFiredAt:
      typeof raw.lastFiredAt === 'number' && Number.isFinite(raw.lastFiredAt)
        ? raw.lastFiredAt
        : null,
    lastCompletedAt:
      typeof raw.lastCompletedAt === 'number' &&
      Number.isFinite(raw.lastCompletedAt)
        ? raw.lastCompletedAt
        : null,
    // The two ownership marks are set together or not at all: half a mark would
    // make a row a routine step no regeneration could recognise.
    routineId: routineStepId === null ? null : routineId,
    routineStepId: routineId === null ? null : routineStepId,
    routineStepType:
      raw.routineStepType === 'reminder' ||
      raw.routineStepType === 'timer' ||
      raw.routineStepType === 'focus'
        ? raw.routineStepType
        : null,
  }
}

function isRepeatRule(value: unknown): value is RepeatRule {
  return (
    value === 'none' ||
    value === 'daily' ||
    value === 'weekdays' ||
    value === 'weekly'
  )
}

function isNotifyLead(value: unknown): value is NotifyLead {
  return (
    value === 'none' ||
    value === 'at-time' ||
    value === 'min-5' ||
    value === 'min-15'
  )
}

export const CUSTOM_CATEGORY_ID = 'custom'

/**
 * The fields a caller supplies when creating one. `id` and `createdAt` are
 * assigned by the background layer, and the fire/completion marks are owned by
 * the scheduler, so none of them are part of the input. `enabled` is optional
 * and defaults to true.
 */
export type NewScheduledActivity = Omit<
  ScheduledActivity,
  'id' | 'createdAt' | 'enabled' | 'lastFiredAt' | 'lastCompletedAt'
> & { enabled?: boolean }

/**
 * Built-in categories, reusing the existing Category type so colour slots stay
 * aligned with the design system's `--color-cat-*` ramp. Religion is one
 * ordinary option among the others and carries no special treatment anywhere.
 */
export const ACTIVITY_CATEGORIES: readonly Category[] = [
  { id: 'personal', name: 'Personal', slot: 1 },
  { id: 'work', name: 'Work', slot: 2 },
  { id: 'study', name: 'Study', slot: 3 },
  { id: 'health', name: 'Health', slot: 4 },
  { id: 'family', name: 'Family', slot: 5 },
  { id: 'religion', name: 'Religion', slot: 6 },
]

/** Resolve an activity's category to a display name and colour slot. */
export function categoryOf(activity: ScheduledActivity): Category {
  const found = ACTIVITY_CATEGORIES.find((c) => c.id === activity.categoryId)
  if (found) return found
  return {
    id: CUSTOM_CATEGORY_ID,
    name: activity.customCategory?.trim() || 'Custom',
    slot: 'other',
  }
}

/* --- Local date/time keys ------------------------------------------------- */

const DAY_MS = 86_400_000

/** "YYYY-MM-DD" for the local day containing `at`. */
export function toDateKey(at: Timestamp): string {
  const date = new Date(at)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(date.getFullYear())}-${month}-${day}`
}

/** "HH:MM" for the local time of `at`. */
export function toTimeKey(at: Timestamp): string {
  const date = new Date(at)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/** The instant a local date+time pair refers to, or null if either is malformed. */
export function toInstant(date: string, time: string): Timestamp | null {
  const onDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const atTime = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!onDate || !atTime) return null

  const value = new Date(
    Number(onDate[1]),
    Number(onDate[2]) - 1,
    Number(onDate[3]),
    Number(atTime[1]),
    Number(atTime[2]),
    0,
    0,
  ).getTime()
  return Number.isFinite(value) ? value : null
}

/* --- Occurrences ---------------------------------------------------------- */

/**
 * The next time this activity is due at or after `now`, or null when it has
 * passed and does not repeat.
 *
 * Recomputed from wall-clock parts each call rather than stored, so a repeating
 * 06:30 stays 06:30 through DST and time-zone changes.
 */
export function nextOccurrenceOf(
  activity: ScheduledActivity,
  now: Timestamp = Date.now(),
): Timestamp | null {
  const first = toInstant(activity.date, activity.time)
  if (first === null) return null
  if (activity.repeat === 'none') return first >= now ? first : null
  if (first >= now) return first

  // Walk day by day from today; at most 8 steps covers every rule here.
  const cursor = new Date(now)
  for (let offset = 0; offset < 8; offset++) {
    const day = new Date(
      cursor.getFullYear(),
      cursor.getMonth(),
      cursor.getDate() + offset,
    )
    const candidate = toInstant(toDateKey(day.getTime()), activity.time)
    if (candidate === null || candidate < now) continue
    if (repeatsOnDay(activity, day, first)) return candidate
  }
  return null
}

function repeatsOnDay(
  activity: ScheduledActivity,
  day: Date,
  first: Timestamp,
): boolean {
  const weekday = day.getDay()
  switch (activity.repeat) {
    case 'daily':
      return true
    case 'weekdays':
      return weekday >= 1 && weekday <= 5
    case 'weekly':
      return weekday === new Date(first).getDay()
    case 'none':
      return false
  }
}

/** Whether an occurrence of this activity falls on the given local day. */
export function occursOnDay(
  activity: ScheduledActivity,
  dayStart: Timestamp,
): boolean {
  const first = toInstant(activity.date, activity.time)
  if (first === null) return false
  const dayEnd = dayStart + DAY_MS
  if (activity.repeat === 'none') return first >= dayStart && first < dayEnd
  if (first >= dayEnd) return false
  return repeatsOnDay(activity, new Date(dayStart), first)
}

/** The instant this activity occurs on the given local day, if it does. */
export function occurrenceOnDay(
  activity: ScheduledActivity,
  dayStart: Timestamp,
): Timestamp | null {
  if (!occursOnDay(activity, dayStart)) return null
  return toInstant(toDateKey(dayStart), activity.time)
}

/* --- Firing ---------------------------------------------------------------- */

const MINUTE_MS = 60_000

/**
 * Snooze offsets offered to the user, in minutes.
 *
 * In the model rather than in either the worker or the card, because both need
 * the same list and neither may import the other — the UI must not reach into
 * background code, and the worker must not import React.
 */
export const SNOOZE_MINUTES = [5, 10, 30] as const

export type SnoozeMinutes = (typeof SNOOZE_MINUTES)[number]

/** How far before the start time the notification is due, in minutes. */
export function leadMinutesOf(notify: NotifyLead): number {
  switch (notify) {
    case 'min-5':
      return 5
    case 'min-15':
      return 15
    case 'at-time':
    case 'none':
      return 0
  }
}

/**
 * Whether this activity is one the scheduler will raise notifications for.
 *
 * Reminders, and any row a routine generated. Routine steps are included because
 * a routine's whole point is that it tells you when each step begins — a timer
 * step still needs the "it's time" notification before there is anything to
 * count down, and a focus step needs it before there is a session to start. The
 * widening is scoped to `routineStepType`, so a timer the user created by hand
 * still behaves exactly as it did.
 */
export function isSchedulable(activity: ScheduledActivity): boolean {
  if (!activity.enabled || activity.notify === 'none') return false
  return activity.type === 'reminder' || isRoutineStep(activity)
}

/** Whether this row was generated from a routine step. */
export function isRoutineStep(activity: ScheduledActivity): boolean {
  return (
    typeof activity.routineId === 'string' &&
    typeof activity.routineStepId === 'string'
  )
}

/** A due notification: when to raise it, and the occurrence it belongs to. */
export type Fire = {
  /** When the notification should appear. */
  at: Timestamp
  /** The occurrence's own start time — what the notification talks about. */
  occurrenceAt: Timestamp
}

/**
 * The next notification this activity owes, or null when it owes none.
 *
 * Two things are filtered out here, which is why the scheduler never has to:
 * fire times that have already passed (a one-shot whose moment came and went
 * while the browser was closed does not fire late), and occurrences already
 * covered by `lastFiredAt` (so a duplicate alarm cannot notify twice).
 */
export function nextFireOf(
  activity: ScheduledActivity,
  now: Timestamp = Date.now(),
): Fire | null {
  if (!isSchedulable(activity)) return null

  const leadMs = leadMinutesOf(activity.notify) * MINUTE_MS
  // Search over occurrences, not fire times: `nextOccurrenceOf` owns the repeat
  // rules, and shifting its floor by the lead keeps that the only repeat logic.
  // Two constraints on the floor — the fire must not be in the past
  // (occurrence >= now + lead), and the occurrence must be a later one than the
  // last already notified (occurrence > lastFiredAt).
  const alreadyFired = activity.lastFiredAt ?? null
  const floor =
    alreadyFired === null
      ? now + leadMs
      : Math.max(now + leadMs, alreadyFired + 1)

  const occurrenceAt = nextOccurrenceOf(activity, floor)
  if (occurrenceAt === null) return null
  return { at: occurrenceAt - leadMs, occurrenceAt }
}

/**
 * How long a fired occurrence stays actionable in the UI.
 *
 * Long enough that a notification dismissed by mistake can still be dealt with
 * from the panel, short enough that yesterday's reminder is not still offering
 * a snooze today.
 */
export const PENDING_WINDOW_MS = 6 * 60 * 60 * 1000

/** Whether the most recent fired occurrence has been marked done. */
export function isCompletedForLastFire(activity: ScheduledActivity): boolean {
  const fired = activity.lastFiredAt ?? null
  const completed = activity.lastCompletedAt ?? null
  if (fired === null) return false
  return completed !== null && completed >= fired
}

/**
 * Whether this activity has a fired occurrence the user has not dealt with —
 * what makes Done and Snooze meaningful on the card as well as on the
 * notification.
 */
export function hasPendingOccurrence(
  activity: ScheduledActivity,
  now: Timestamp = Date.now(),
): boolean {
  const fired = activity.lastFiredAt ?? null
  if (fired === null) return false
  if (isCompletedForLastFire(activity)) return false
  return now - fired < PENDING_WINDOW_MS
}
