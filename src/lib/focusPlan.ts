import {
  focusAlarmName,
  LEGACY_FOCUS_END_ALARM,
  parseAlarmName,
} from '../services/alarms'
import { type FocusSession } from '../models'

/**
 * Pure planner for the focus session's alarm.
 *
 * The same shape as `schedulePlan` and for the same reason: the worker cannot
 * trust its own memory, so "which focus alarm should exist" is derived from the
 * persisted session plus the alarms Chrome actually holds, every time. No Chrome
 * calls and no I/O, so the rules below can be read — and exercised — on their
 * own.
 *
 * Exactly one focus alarm may exist, and only while a session is running. A
 * paused session has none (that is what stops the clock), and a settled one has
 * none. Everything else in the focus namespace is stale by definition.
 */

export type ExistingAlarm = {
  name: string
  /** Absolute fire time, ms since epoch. */
  scheduledTime: number
}

export type FocusAlarmPlan = {
  /** The alarm to create or replace. Null when none is owed. */
  create: { name: string; when: number } | null
  /** Focus-namespace alarm names to remove. */
  clear: string[]
  /**
   * Set when the running session's end has already passed — the completion is
   * owed *now* rather than scheduled, because the alarm that should have raised
   * it was lost (browser closed over the end, alarm store cleared).
   */
  completeDue: string | null
}

/** Matches `schedulePlan`'s tolerance: a DST or time-zone shift is noticed, a correct alarm is never churned. */
const DRIFT_TOLERANCE_MS = 30_000

/** Every focus alarm Chrome currently holds, including the pre-rename fixed one. */
function focusAlarmsIn(existing: readonly ExistingAlarm[]): ExistingAlarm[] {
  return existing.filter(
    (alarm) =>
      parseAlarmName(alarm.name).kind === 'focus' ||
      alarm.name === LEGACY_FOCUS_END_ALARM,
  )
}

export function planFocusAlarm(
  session: FocusSession | null,
  existing: readonly ExistingAlarm[],
  now: number = Date.now(),
): FocusAlarmPlan {
  const focusAlarms = focusAlarmsIn(existing)

  // No live session, or a paused one: nothing may fire. Every focus alarm goes.
  if (!session || session.status !== 'running' || session.endsAt === null) {
    return {
      create: null,
      clear: focusAlarms.map((alarm) => alarm.name),
      completeDue: null,
    }
  }

  const name = focusAlarmName(session.id)
  const stale = focusAlarms
    .filter((alarm) => alarm.name !== name)
    .map((alarm) => alarm.name)

  // Already due. Completing it is the caller's job; the alarm is moot either
  // way, so it is cleared rather than rewritten into the past.
  if (session.endsAt <= now) {
    return {
      create: null,
      clear: [...new Set([...stale, name])],
      completeDue: session.id,
    }
  }

  const current = focusAlarms.find((alarm) => alarm.name === name)
  const drifted =
    current === undefined ||
    Math.abs(current.scheduledTime - session.endsAt) > DRIFT_TOLERANCE_MS

  return {
    create: drifted ? { name, when: session.endsAt } : null,
    clear: [...new Set(stale)],
    completeDue: null,
  }
}
