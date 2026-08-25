import {
  alarmNamesFor,
  planSchedule,
  type ExistingAlarm,
} from '../../lib/schedulePlan'
import { formatTimeOfDay } from '../../lib/activityFormat'
import {
  nextFireOf,
  SNOOZE_MINUTES,
  type ScheduledActivity,
  type SnoozeMinutes,
  type Timestamp,
} from '../../models'
import {
  activityAlarmName,
  clear as clearAlarm,
  getAll as getAllAlarms,
  parseAlarmName,
  scheduleAt,
  snoozeAlarmName,
} from '../../services/alarms'
import {
  activityNotificationId,
  dismiss,
  notify,
} from '../../services/notifications'
import * as scheduled from './scheduledActivities'

/**
 * The bridge between persisted activities and Chrome's alarm/notification APIs.
 *
 * Everything here is written for a worker that may be killed between any two
 * lines. There is no module-scope state: each entry point re-reads storage and
 * re-reads `chrome.alarms`, so the outcome is the same whether it runs in a
 * freshly started worker or one that has been alive for an hour. `reconcile()`
 * is idempotent and is the recovery path for every failure below — if a single
 * alarm write is lost, the next reconcile puts it back.
 */

const MINUTE_MS = 60_000

/**
 * How far into the past an alarm may point and still be treated as "this is the
 * occurrence you woke me for".
 *
 * Chrome fires an alarm at or *after* its scheduled time, and the worker takes a
 * moment to start, so by the time `fireActivity` runs the occurrence is already
 * a few hundred milliseconds old — without a grace window `nextFireOf` would
 * skip straight to tomorrow's occurrence and nothing would ever be raised.
 * Small enough that an alarm delivered long late (browser closed over the fire
 * time) still counts as missed rather than fired.
 */
const FIRE_GRACE_MS = 2 * MINUTE_MS

/**
 * Which snooze the notification's button applies.
 *
 * Chrome renders at most two buttons and "Done" takes one, so the notification
 * offers a single middle-ground snooze; the full set (5/10/30) is on the card in
 * the side panel.
 */
export const BUTTON_SNOOZE_MINUTES: SnoozeMinutes = SNOOZE_MINUTES[1]

/** Buttons on an activity notification, in index order. */
const NOTIFICATION_BUTTONS = [
  { title: 'Done' },
  { title: `Snooze ${String(BUTTON_SNOOZE_MINUTES)} min` },
]

export const NotificationButton = { done: 0, snooze: 1 } as const

export type ReconcileResult = {
  created: number
  cleared: number
  failed: number
}

/**
 * Bring chrome.alarms in line with persisted activities.
 *
 * Called on install, on browser start-up, after every mutation, on every sweep,
 * and after each fire. Reads both sides fresh and repairs the difference:
 * missing alarms are created, alarms for deleted activities are removed, and an
 * alarm whose time has drifted (DST, a time-zone change, an edit that raced a
 * previous reconcile) is rewritten.
 */
export async function reconcile(now = Date.now()): Promise<ReconcileResult> {
  const result: ReconcileResult = { created: 0, cleared: 0, failed: 0 }

  const activities = await scheduled.list()
  const existing: ExistingAlarm[] = (await getAllAlarms()).map((alarm) => ({
    name: alarm.name,
    scheduledTime: alarm.scheduledTime,
  }))

  const plan = planSchedule(activities, existing, now)

  for (const name of plan.clear) {
    await clearAlarm(name)
    result.cleared += 1
  }

  for (const alarm of plan.create) {
    const ok = await scheduleAt(alarm.name, alarm.when)
    if (ok) result.created += 1
    else result.failed += 1
  }

  if (result.failed > 0) {
    console.warn(
      `[timepilot] ${String(result.failed)} alarm(s) could not be scheduled`,
    )
  }
  return result
}

/** Fire times keyed by activity id, for the surfaces' scheduled state. */
export async function scheduledTimes(): Promise<Record<string, Timestamp>> {
  const alarms = await getAllAlarms()
  const times: Record<string, Timestamp> = {}
  for (const alarm of alarms) {
    const parsed = parseAlarmName(alarm.name)
    // Activity and snooze alarms both count as "scheduled"; the sooner wins.
    if (parsed.kind !== 'activity' && parsed.kind !== 'snooze') continue
    const current = times[parsed.activityId]
    if (current === undefined || alarm.scheduledTime < current) {
      times[parsed.activityId] = alarm.scheduledTime
    }
  }
  return times
}

/* --- Firing --------------------------------------------------------------- */

/**
 * An activity alarm fired.
 *
 * The occurrence is recomputed here rather than carried on the alarm, because an
 * alarm has no payload and the worker that scheduled it is long gone. Storage
 * is the only input.
 */
export async function fireActivity(
  activityId: string,
  now = Date.now(),
): Promise<void> {
  const activity = await scheduled.get(activityId)
  if (!activity) {
    // Deleted while its alarm was pending. Drop the alarm and stay quiet.
    await Promise.all(alarmNamesFor(activityId).map((name) => clearAlarm(name)))
    return
  }

  // Search from before the present, not from it: the occurrence that woke us is
  // by now a few hundred milliseconds in the past, and `nextFireOf` filters past
  // fire times out.
  const fire = nextFireOf(activity, now - FIRE_GRACE_MS)
  const due = fire !== null && fire.at <= now + FIRE_GRACE_MS

  if (fire === null || !due) {
    // Woke early, delivered long late, or the activity was disabled/retimed
    // since it was scheduled. Re-derive rather than guess.
    await reconcile(now)
    return
  }

  await raise(activity, fire.occurrenceAt, now)
  // Stamp before rescheduling: if the worker dies in between, the next
  // reconcile computes the following occurrence rather than repeating this one.
  await scheduled.markFired(activity.id, fire.occurrenceAt)
  await reschedule(activity.id, now)
}

/** A snooze alarm fired. Same notification, no change to the schedule. */
export async function fireSnooze(
  activityId: string,
  now = Date.now(),
): Promise<void> {
  await clearAlarm(snoozeAlarmName(activityId))

  const activity = await scheduled.get(activityId)
  if (!activity) return
  // Paused between the snooze and its expiry: the user's later choice wins.
  if (!activity.enabled) return

  // `now` for the occurrence: the snooze is the occurrence now, and passing it
  // as both keeps the message on the "it's time" wording rather than a lead-time
  // one. The fire mark is deliberately untouched — a snooze re-raises the same
  // occurrence and must not make the recurring schedule skip ahead.
  await raise(activity, now, now)
}

/**
 * Raise the notification for an occurrence.
 *
 * The id is derived from the activity id, so re-raising replaces the previous
 * notification for the same activity instead of stacking a duplicate.
 */
async function raise(
  activity: ScheduledActivity,
  occurrenceAt: Timestamp,
  now: Timestamp,
): Promise<void> {
  // With a lead time the notification arrives before the activity, so it has to
  // say when — at-time notifications do not, and read better without it.
  const early = occurrenceAt - now > MINUTE_MS
  const message = early
    ? `${activity.title} starts at ${formatTimeOfDay(occurrenceAt)}.`
    : `It's time for ${activity.title}.`

  const raised = await notify({
    id: activityNotificationId(activity.id),
    title: activity.title,
    message,
    requireInteraction: true,
    buttons: NOTIFICATION_BUTTONS,
  })
  if (raised === null) {
    // Blocked by the user's setting or by the OS. Not an error: the schedule
    // advances regardless, so a muted period does not replay later.
    console.info(`[timepilot] no notification shown for "${activity.title}"`)
  }
}

/** Recompute and rewrite one activity's alarm. */
async function reschedule(activityId: string, now: number): Promise<void> {
  const activity = await scheduled.get(activityId)
  const name = activityAlarmName(activityId)
  if (!activity) {
    await clearAlarm(name)
    return
  }

  const fire = nextFireOf(activity, now)
  if (fire === null) {
    // One-shot that has fired, or disabled. Nothing further is owed.
    await clearAlarm(name)
    return
  }
  await scheduleAt(name, fire.at)
}

/* --- User actions --------------------------------------------------------- */

/**
 * Mark an occurrence done: close the notification, record it, leave the
 * recurring schedule exactly as it was.
 */
export async function complete(
  activityId: string,
  now = Date.now(),
): Promise<void> {
  await dismiss(activityNotificationId(activityId))
  // A pending snooze for this occurrence is moot once it is done.
  await clearAlarm(snoozeAlarmName(activityId))
  await scheduled.markCompleted(activityId, now)
  // Done does not touch the recurring alarm; only repair it if it went missing.
  await reconcile(now)
}

/**
 * Snooze an occurrence.
 *
 * A separate one-shot alarm in its own namespace — the recurring alarm is left
 * untouched, so a daily 18:00 reminder snoozed at 18:00 still fires at 18:00
 * tomorrow.
 */
export async function snooze(
  activityId: string,
  minutes: number,
  now = Date.now(),
): Promise<boolean> {
  const activity = await scheduled.get(activityId)
  if (!activity) return false

  const span = Math.max(1, Math.round(minutes))
  await dismiss(activityNotificationId(activityId))
  return scheduleAt(snoozeAlarmName(activityId), now + span * MINUTE_MS)
}

/** Enable or disable an activity, then bring its alarm in line. */
export async function setEnabled(
  activityId: string,
  enabled: boolean,
  now = Date.now(),
): Promise<ScheduledActivity | null> {
  const updated = await scheduled.setEnabled(activityId, enabled)
  if (!updated) return null

  if (!enabled) {
    // Disabled must not fire: drop the recurring alarm, any snooze, and any
    // notification already on screen.
    await Promise.all(alarmNamesFor(activityId).map((name) => clearAlarm(name)))
    await dismiss(activityNotificationId(activityId))
  }
  await reconcile(now)
  return updated
}

/** Tear down everything an activity owns. Called on delete. */
export async function teardown(activityId: string): Promise<void> {
  await Promise.all(alarmNamesFor(activityId).map((name) => clearAlarm(name)))
  await dismiss(activityNotificationId(activityId))
}
