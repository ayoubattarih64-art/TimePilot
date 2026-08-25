import { parseAlarmName, timerAlarmName } from '../services/alarms'
import type { TimerSession } from '../models'

/**
 * Pure planner for the live timer's alarm.
 *
 * The same shape as `focusPlan` and `schedulePlan`, for the same reason: the
 * worker cannot trust its own memory, so "which timer alarm should exist" is
 * derived from the persisted timer plus the alarms Chrome actually holds,
 * every time. No Chrome calls and no I/O, so the rules below can be read — and
 * exercised — on their own.
 *
 * Exactly one timer alarm may exist, and only while a timer is running. A
 * paused timer has none (that is what stops the clock), and a settled one has
 * none. Everything else in the timer namespace is stale by definition.
 */

export type ExistingAlarm = {
  name: string
  /** Absolute fire time, ms since epoch. */
  scheduledTime: number
}

export type TimerAlarmPlan = {
  /** The alarm to create or replace. Null when none is owed. */
  create: { name: string; when: number } | null
  /** Timer-namespace alarm names to remove. */
  clear: string[]
  /**
   * Set when the running timer's end has already passed — the completion is
   * owed *now* rather than scheduled, because the alarm that should have
   * raised it was lost (browser closed over the end, alarm store cleared).
   */
  completeDue: string | null
}

/** Matches `focusPlan`'s tolerance: a DST or time-zone shift is noticed, a correct alarm is never churned. */
const DRIFT_TOLERANCE_MS = 30_000

/** Every timer alarm Chrome currently holds. */
function timerAlarmsIn(existing: readonly ExistingAlarm[]): ExistingAlarm[] {
  return existing.filter(
    (alarm) => parseAlarmName(alarm.name).kind === 'timer',
  )
}

export function planTimerAlarm(
  timer: TimerSession | null,
  existing: readonly ExistingAlarm[],
  now: number = Date.now(),
): TimerAlarmPlan {
  const timerAlarms = timerAlarmsIn(existing)

  // No live timer, or a paused one: nothing may fire. Every timer alarm goes.
  if (!timer || timer.status !== 'running' || timer.endsAt === null) {
    return {
      create: null,
      clear: timerAlarms.map((alarm) => alarm.name),
      completeDue: null,
    }
  }

  const name = timerAlarmName(timer.id)
  const stale = timerAlarms
    .filter((alarm) => alarm.name !== name)
    .map((alarm) => alarm.name)

  // Already due. Completing it is the caller's job; the alarm is moot either
  // way, so it is cleared rather than rewritten into the past.
  if (timer.endsAt <= now) {
    return {
      create: null,
      clear: [...new Set([...stale, name])],
      completeDue: timer.id,
    }
  }

  const current = timerAlarms.find((alarm) => alarm.name === name)
  const drifted =
    current === undefined ||
    Math.abs(current.scheduledTime - timer.endsAt) > DRIFT_TOLERANCE_MS

  return {
    create: drifted ? { name, when: timer.endsAt } : null,
    clear: [...new Set(stale)],
    completeDue: null,
  }
}
