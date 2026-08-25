import {
  activityAlarmName,
  parseAlarmName,
  snoozeAlarmName,
} from '../services/alarms'
import { nextFireOf, type ScheduledActivity } from '../models'

/**
 * Pure reconciliation planner.
 *
 * The service worker cannot trust its own memory — Chrome evicts it between
 * events and re-runs the file from scratch — so "which alarms should exist" is
 * derived, every time, from persisted activities plus the alarms Chrome actually
 * holds. That derivation is this file: no Chrome calls, no I/O, so it can be
 * reasoned about (and exercised from a console) without a browser.
 */

export type ExistingAlarm = {
  name: string
  /** Absolute fire time, ms since epoch. */
  scheduledTime: number
}

export type PlannedAlarm = {
  name: string
  when: number
  activityId: string
}

export type SchedulePlan = {
  /** Alarms to create or replace. */
  create: PlannedAlarm[]
  /** Alarm names to remove — stale, orphaned, or no longer due. */
  clear: string[]
}

/**
 * How far an existing alarm may drift from the computed fire time before it is
 * rewritten. A DST shift or a time-zone change moves the absolute instant of a
 * wall-clock 18:00, and this is what notices. Well under a minute, so a correct
 * alarm is never churned.
 */
const DRIFT_TOLERANCE_MS = 30_000

/**
 * Reconcile persisted activities against the alarms Chrome currently holds.
 *
 * Snooze alarms are deliberately left alone unless their activity is gone: a
 * snooze is a one-shot the user asked for, and rewriting it from the recurring
 * schedule is exactly the bug the "snooze must not modify the schedule" rule
 * forbids.
 */
export function planSchedule(
  activities: readonly ScheduledActivity[],
  existing: readonly ExistingAlarm[],
  now: number = Date.now(),
): SchedulePlan {
  const create: PlannedAlarm[] = []
  const clear: string[] = []

  const byName = new Map(existing.map((alarm) => [alarm.name, alarm]))
  const liveIds = new Set(activities.map((activity) => activity.id))

  for (const activity of activities) {
    const name = activityAlarmName(activity.id)
    const fire = nextFireOf(activity, now)

    if (fire === null) {
      // Disabled, non-notifying, or permanently past. Any alarm is stale.
      if (byName.has(name)) clear.push(name)
      continue
    }

    const current = byName.get(name)
    if (
      !current ||
      Math.abs(current.scheduledTime - fire.at) > DRIFT_TOLERANCE_MS
    ) {
      create.push({ name, when: fire.at, activityId: activity.id })
    }
  }

  for (const alarm of existing) {
    const parsed = parseAlarmName(alarm.name)
    // Never touch the routine scan, the sweep, a focus or timer alarm, or
    // anything that is not ours at all.
    if (parsed.kind !== 'activity' && parsed.kind !== 'snooze') continue
    // Stale: the activity it names no longer exists. Both namespaces go.
    if (!liveIds.has(parsed.activityId)) clear.push(alarm.name)
  }

  // A name can be reached twice (stale by fire time *and* orphaned); collapse.
  return { create, clear: [...new Set(clear)] }
}

/** Names an activity owns, for teardown when it is deleted. */
export function alarmNamesFor(activityId: string): string[] {
  return [activityAlarmName(activityId), snoozeAlarmName(activityId)]
}
