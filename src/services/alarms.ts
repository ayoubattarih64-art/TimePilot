/**
 * chrome.alarms wrapper.
 *
 * Alarms rather than setTimeout: the service worker is evicted after ~30s idle,
 * which kills any pending timer. An alarm survives eviction and wakes the worker
 * back up, so it is the only reliable scheduler here. Chrome clamps alarm
 * periods to a 30-second floor.
 */

export const ALARM_PREFIX = 'timepilot:'

/**
 * Namespaces for the alarms whose names carry an id.
 *
 * Kept distinct from the fixed names below so a scan of `chrome.alarms.getAll()`
 * can tell "an alarm for activity X" apart from the routine scan or the sweep,
 * and so reconciliation can delete every stale alarm of one kind without ever
 * touching an alarm it does not own.
 */
export const ACTIVITY_ALARM_PREFIX = `${ALARM_PREFIX}activity:`
export const SNOOZE_ALARM_PREFIX = `${ALARM_PREFIX}snooze:`
export const FOCUS_ALARM_PREFIX = `${ALARM_PREFIX}focus:`
export const TIMER_ALARM_PREFIX = `${ALARM_PREFIX}timer:`

/**
 * The single fixed focus alarm earlier builds used, before sessions carried
 * their own namespaced alarm. Recognised only so reconciliation can clear one
 * left behind by an update; nothing creates it.
 */
export const LEGACY_FOCUS_END_ALARM = `${ALARM_PREFIX}focus-end`

/**
 * The one-minute tick earlier builds registered.
 *
 * It woke the worker sixty times an hour to run an empty handler: countdowns are
 * derived from persisted absolute instants, so there was never anything for it
 * to persist. Kept only as a name to clear on update; nothing creates it.
 */
export const LEGACY_TICK_ALARM = `${ALARM_PREFIX}tick`

/** Named alarms the extension owns. */
export const Alarms = {
  /** Recomputes upcoming routine notifications for the day. */
  routineScan: `${ALARM_PREFIX}routine-scan`,
  /** Periodic safety net: re-reconciles scheduled activities against alarms. */
  scheduleSweep: `${ALARM_PREFIX}schedule-sweep`,
} as const

export type AlarmName = (typeof Alarms)[keyof typeof Alarms]

/* --- Names ---------------------------------------------------------------- */

/**
 * Alarm name for a scheduled activity's next notification.
 *
 * Pure and total, so both the scheduler and the reconciler derive the same name
 * from the same id without sharing state.
 */
export function activityAlarmName(activityId: string): string {
  return `${ACTIVITY_ALARM_PREFIX}${activityId}`
}

/** Alarm name for a snoozed occurrence of an activity. */
export function snoozeAlarmName(activityId: string): string {
  return `${SNOOZE_ALARM_PREFIX}${activityId}`
}

/**
 * Alarm name for a focus session's planned end.
 *
 * Per session rather than one fixed name, so a stale alarm from a session that
 * was cancelled while the worker was down is identifiable — and clearable — by
 * the id it carries.
 */
export function focusAlarmName(sessionId: string): string {
  return `${FOCUS_ALARM_PREFIX}${sessionId}`
}

/**
 * Alarm name for a timer's end.
 *
 * Its own namespace, not a fourth focus kind: timers and focus sessions are
 * different features whose alarms must never be confused by a scan, and this
 * is the only file that knows either name exists.
 */
export function timerAlarmName(timerId: string): string {
  return `${TIMER_ALARM_PREFIX}${timerId}`
}

export type ParsedAlarm =
  | { kind: 'activity'; activityId: string }
  | { kind: 'snooze'; activityId: string }
  | { kind: 'focus'; sessionId: string }
  | { kind: 'timer'; timerId: string }
  | { kind: 'fixed'; name: AlarmName }
  | { kind: 'foreign' }

/** Classify an alarm name. `foreign` means "not ours — leave it alone". */
export function parseAlarmName(name: string): ParsedAlarm {
  if (name.startsWith(ACTIVITY_ALARM_PREFIX)) {
    return {
      kind: 'activity',
      activityId: name.slice(ACTIVITY_ALARM_PREFIX.length),
    }
  }
  if (name.startsWith(SNOOZE_ALARM_PREFIX)) {
    return {
      kind: 'snooze',
      activityId: name.slice(SNOOZE_ALARM_PREFIX.length),
    }
  }
  if (name.startsWith(FOCUS_ALARM_PREFIX)) {
    return { kind: 'focus', sessionId: name.slice(FOCUS_ALARM_PREFIX.length) }
  }
  if (name.startsWith(TIMER_ALARM_PREFIX)) {
    return { kind: 'timer', timerId: name.slice(TIMER_ALARM_PREFIX.length) }
  }
  const fixed = Object.values(Alarms).find((value) => value === name)
  if (fixed) return { kind: 'fixed', name: fixed }
  return { kind: 'foreign' }
}

/* --- Scheduling ----------------------------------------------------------- */

/** Create or replace a repeating alarm. */
export async function schedulePeriodic(
  name: AlarmName,
  periodInMinutes: number,
): Promise<void> {
  await chrome.alarms.create(name, { periodInMinutes })
}

/**
 * Create or replace a one-shot alarm at an absolute time.
 *
 * Returns false when Chrome refused to create it, so callers can report the
 * failure rather than assume a schedule that does not exist. Chrome fires an
 * alarm whose `when` is in the past almost immediately; callers that must not
 * fire late check the time before calling.
 */
export async function scheduleAt(name: string, when: number): Promise<boolean> {
  if (!Number.isFinite(when)) return false
  try {
    await chrome.alarms.create(name, { when })
    // create() resolves without telling us whether it took; confirm by reading
    // back, which also catches a quota rejection reported via lastError.
    return (await chrome.alarms.get(name)) !== undefined
  } catch (error: unknown) {
    console.warn(`[timepilot] could not schedule alarm "${name}"`, error)
    return false
  }
}

export async function clear(name: string): Promise<boolean> {
  try {
    return await chrome.alarms.clear(name)
  } catch (error: unknown) {
    console.warn(`[timepilot] could not clear alarm "${name}"`, error)
    return false
  }
}

/** Every alarm currently registered, ours and anyone else's. */
export async function getAll(): Promise<chrome.alarms.Alarm[]> {
  try {
    return await chrome.alarms.getAll()
  } catch (error: unknown) {
    console.warn('[timepilot] could not read alarms', error)
    return []
  }
}

/* --- Events --------------------------------------------------------------- */

export type AlarmHandlers = Partial<
  Record<AlarmName, () => void | Promise<void>>
>

/**
 * Route alarm events to per-alarm handlers.
 *
 * `onDynamic` receives the alarms whose names carry an id (activity, snooze,
 * focus), which cannot be enumerated up front. Rejections are caught here: an
 * unhandled one would be an uncaught error in the worker's global scope.
 */
export function onAlarm(
  handlers: AlarmHandlers,
  onDynamic?: (parsed: ParsedAlarm, alarm: chrome.alarms.Alarm) => void | Promise<void>,
): void {
  chrome.alarms.onAlarm.addListener((alarm) => {
    const parsed = parseAlarmName(alarm.name)

    const run =
      parsed.kind === 'fixed'
        ? handlers[parsed.name]?.()
        : parsed.kind === 'foreign'
          ? undefined
          : onDynamic?.(parsed, alarm)

    if (run === undefined) return
    void Promise.resolve(run).catch((error: unknown) => {
      console.error(`[timepilot] alarm "${alarm.name}" failed`, error)
    })
  })
}
