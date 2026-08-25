import { createId } from '../../lib/id'
import { planTimerAlarm, type ExistingAlarm } from '../../lib/timerPlan'
import {
  cancelTimerSession,
  completeTimerSession,
  extendTimerSession,
  isLiveTimer,
  liveTimerOf,
  normalizeTimerSession,
  pauseTimerSession,
  resumeTimerSession,
  startTimerSession,
  type NewTimerSession,
  type TimerSession,
} from '../../models'
import {
  clear as clearAlarm,
  getAll as getAllAlarms,
  scheduleAt,
  timerAlarmName,
} from '../../services/alarms'
import {
  dismiss,
  notify,
  timerNotificationId,
} from '../../services/notifications'
import { readKey, writeKey } from '../../services/storage'

/**
 * Timers: a standalone countdown, at most one live at a time.
 *
 * Built to the same rules as `focusSessions`, minus everything that makes
 * focus focus (no blocklists, no activity link): no module-scope state, every
 * entry point re-reads storage and re-derives the alarm from it, and
 * `reconcile()` is the recovery path an eviction or a closed browser lands on.
 * The countdown the user sees is always derived from the persisted
 * `endsAt`/`remainingMs` — nothing is ever counted down in memory.
 */

/**
 * How far past `endsAt` an alarm may arrive and still count as "the end you
 * woke me for" rather than a stale delivery. Same value as focus: either way
 * the timer completes, this only decides whether it is treated as on time.
 */
export const TIMER_GRACE_MS = 60_000

/** The completion notification's only button: acknowledge and dismiss. */
const NOTIFICATION_BUTTONS = [{ title: 'Done' }]

/* --- Reading -------------------------------------------------------------- */

/**
 * Every stored timer, repaired on the way out.
 *
 * Normalisation happens here rather than at each call site so nothing
 * downstream has to know a malformed row could exist. Rows that cannot be
 * made sense of are dropped.
 */
async function readTimers(): Promise<TimerSession[]> {
  const stored: unknown = await readKey('timers')
  if (!Array.isArray(stored)) return []
  return stored
    .map((row) => normalizeTimerSession(row))
    .filter((timer): timer is TimerSession => timer !== null)
}

async function writeTimers(timers: readonly TimerSession[]): Promise<void> {
  await writeKey('timers', [...timers])
}

/** The live timer — running or paused — or null. */
export async function getCurrent(): Promise<TimerSession | null> {
  return liveTimerOf(await readTimers())
}

/**
 * What the Timer surface needs in one round trip: the live timer, and the one
 * that settled most recently so the page can show "complete" without keeping
 * that in React state across a panel close.
 */
export type TimerSnapshot = {
  current: TimerSession | null
  last: TimerSession | null
}

export async function snapshot(): Promise<TimerSnapshot> {
  const timers = await readTimers()
  const current = liveTimerOf(timers)

  let last: TimerSession | null = null
  for (const timer of timers) {
    if (isLiveTimer(timer)) continue
    const at = timer.endedAt ?? timer.startedAt
    const bestAt = last === null ? -Infinity : (last.endedAt ?? last.startedAt)
    if (at >= bestAt) last = timer
  }

  return { current, last }
}

/* --- Lifecycle ------------------------------------------------------------ */

export type StartResult =
  | { ok: true; timer: TimerSession }
  /** Refused: a timer is already live. The caller shows it rather than replacing it. */
  | { ok: false; reason: 'already-running'; timer: TimerSession }

/**
 * Start a timer.
 *
 * Refuses rather than replacing when one is already live, exactly as focus
 * does: silently discarding a countdown the user is watching is never what
 * they meant. Order is deliberate — persist, then alarm — because persisting
 * first is what makes a lost alarm recoverable by the sweep, whereas an alarm
 * belonging to a timer that was never written would fire into nothing.
 */
export async function start(
  input: NewTimerSession,
  now = Date.now(),
): Promise<StartResult> {
  const timers = await readTimers()
  const live = liveTimerOf(timers)
  if (live) return { ok: false, reason: 'already-running', timer: live }

  const timer = startTimerSession(createId(), input, now)
  await writeTimers([...timers, timer])

  if (timer.endsAt !== null) {
    const scheduled = await scheduleAt(timerAlarmName(timer.id), timer.endsAt)
    if (!scheduled) {
      // The timer is persisted and its end is a timestamp, so the sweep will
      // notice and either re-create the alarm or complete it outright.
      console.warn('[timepilot] timer alarm could not be scheduled')
    }
  }
  return { ok: true, timer }
}

/**
 * Pause the running timer.
 *
 * The alarm is cleared and what was left is written down. That is the whole
 * mechanism: with no alarm nothing can fire, and with `endsAt` null there is
 * no instant to count towards, so time genuinely cannot continue while
 * paused. Pausing at zero completes instead of freezing.
 */
export async function pause(now = Date.now()): Promise<TimerSession | null> {
  const timers = await readTimers()
  const index = timers.findIndex((timer) => timer.status === 'running')
  if (index === -1) return null

  const paused = pauseTimerSession(timers[index], now)
  const next = [...timers]
  next[index] = paused
  await writeTimers(next)

  if (paused.status === 'paused') {
    await clearAlarm(timerAlarmName(paused.id))
    return paused
  }
  // Pausing at zero completed it: take the same path a natural completion
  // takes, notification included.
  await completeTimer(paused.id, now)
  return paused
}

/** Resume a paused timer: a fresh `endsAt` from what was left, and a new alarm. */
export async function resume(now = Date.now()): Promise<TimerSession | null> {
  const timers = await readTimers()
  const index = timers.findIndex((timer) => timer.status === 'paused')
  if (index === -1) return null

  const resumed = resumeTimerSession(timers[index], now)
  const next = [...timers]
  next[index] = resumed
  await writeTimers(next)

  if (resumed.status === 'running' && resumed.endsAt !== null) {
    await scheduleAt(timerAlarmName(resumed.id), resumed.endsAt)
  }
  return resumed
}

/**
 * Add time to the live timer.
 *
 * The pure extension is applied, then the alarm is reconciled: a running
 * timer's alarm must move to the new end, and anything else in the namespace
 * is stale. Idempotent and cheap when nothing changed.
 */
export async function add(
  minutes: number,
  now = Date.now(),
): Promise<TimerSession | null> {
  const timers = await readTimers()
  const index = timers.findIndex((timer) => isLiveTimer(timer))
  if (index === -1) return null

  const extended = extendTimerSession(timers[index], minutes)
  const next = [...timers]
  next[index] = extended
  await writeTimers(next)

  await reconcile(now)
  return extended
}

/**
 * Cancel the live timer.
 *
 * Cancelled, never completed: the two mean different things and the record
 * keeps them apart. The alarm goes first in intent, but order does not matter
 * for correctness — a worker death between the two lines leaves either a
 * settled timer with a stale alarm (which fires, finds nothing running, and
 * clears itself) or a live timer with no alarm (which the sweep repairs).
 */
export async function cancel(now = Date.now()): Promise<TimerSession | null> {
  const timers = await readTimers()
  const index = timers.findIndex((timer) => isLiveTimer(timer))
  if (index === -1) return null

  const cancelled = cancelTimerSession(timers[index], now)
  const next = [...timers]
  next[index] = cancelled
  await writeTimers(next)

  await clearAlarm(timerAlarmName(cancelled.id))
  // A completion notification for this timer must not linger or arrive later.
  await dismiss(timerNotificationId(cancelled.id))
  return cancelled
}

/* --- Firing --------------------------------------------------------------- */

/**
 * A timer alarm fired.
 *
 * The alarm carries only an id, so everything else is recomputed from
 * storage. Safe against every stale case: the timer may have been paused,
 * resumed, cancelled, or gone since the alarm was written, and none of those
 * may throw — an unhandled rejection here would surface as a worker error.
 */
export async function fireTimer(
  timerId: string,
  now = Date.now(),
): Promise<void> {
  await clearAlarm(timerAlarmName(timerId))

  const timers = await readTimers()
  const timer = timers.find((candidate) => candidate.id === timerId)
  // Cancelled, already completed, or gone. The alarm is cleared; stay quiet.
  if (!timer || timer.status !== 'running') return

  // Paused-then-resumed can move the end later than the alarm that woke us,
  // and so can an add-time that raced this delivery. Re-derive rather than
  // trust the wake-up: reconcile puts the right alarm back.
  if (timer.endsAt !== null && timer.endsAt > now + TIMER_GRACE_MS) {
    await reconcile(now)
    return
  }

  await completeTimer(timerId, now)
}

/**
 * Complete a timer and raise the notification.
 *
 * The status is written before the notification, so a worker death in between
 * loses the notification rather than replaying the completion. Exactly one
 * notification, under the timer's own id, so a re-raise replaces rather than
 * stacks.
 */
async function completeTimer(
  timerId: string,
  now: number,
): Promise<TimerSession | null> {
  const timers = await readTimers()
  const index = timers.findIndex((timer) => timer.id === timerId)
  if (index === -1) return null
  if (timers[index].status === 'completed') return timers[index]

  const completed = completeTimerSession(timers[index], now)
  const next = [...timers]
  next[index] = completed
  await writeTimers(next)
  await clearAlarm(timerAlarmName(completed.id))

  await raiseCompletion(completed)
  return completed
}

async function raiseCompletion(timer: TimerSession): Promise<void> {
  const raised = await notify({
    id: timerNotificationId(timer.id),
    title: 'Timer complete',
    message: timer.title,
    requireInteraction: true,
    buttons: NOTIFICATION_BUTTONS,
  })
  if (raised === null) {
    // Blocked by the user's setting or by the OS. Not an error: the timer is
    // complete either way.
    console.info(`[timepilot] no notification shown for timer "${timer.title}"`)
  }
}

/** The notification's only button. Acknowledgement, not a state change. */
export async function acknowledge(timerId: string): Promise<void> {
  await dismiss(timerNotificationId(timerId))
}

/* --- Reconciliation ------------------------------------------------------- */

export type TimerReconcileResult = {
  created: number
  cleared: number
  completed: number
  failed: number
}

/**
 * Bring the timer alarm in line with the persisted timer.
 *
 * Called on install, on start-up, on every sweep, after every suspect fire,
 * and when the Timer surface reads its state. Reads both sides fresh and
 * repairs the difference, so it is safe to call at any time and cheap when
 * there is nothing to do — which is the normal case.
 */
export async function reconcile(
  now = Date.now(),
): Promise<TimerReconcileResult> {
  const result: TimerReconcileResult = {
    created: 0,
    cleared: 0,
    completed: 0,
    failed: 0,
  }

  const current = await getCurrent()
  const existing: ExistingAlarm[] = (await getAllAlarms()).map((alarm) => ({
    name: alarm.name,
    scheduledTime: alarm.scheduledTime,
  }))

  const plan = planTimerAlarm(current, existing, now)

  for (const name of plan.clear) {
    await clearAlarm(name)
    result.cleared += 1
  }

  if (plan.completeDue !== null) {
    // The end passed while nothing was listening. Complete it now — late is
    // correct, silently dropping it is not.
    const completed = await completeTimer(plan.completeDue, now)
    if (completed) result.completed += 1
    return result
  }

  if (plan.create) {
    const ok = await scheduleAt(plan.create.name, plan.create.when)
    if (ok) result.created += 1
    else result.failed += 1
  }

  if (result.failed > 0) {
    console.warn('[timepilot] timer alarm could not be scheduled')
  }
  return result
}
