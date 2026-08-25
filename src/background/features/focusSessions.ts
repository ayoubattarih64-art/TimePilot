import { formatDuration } from '../../lib/time'
import { createId } from '../../lib/id'
import { endsAtFrom } from '../../lib/countdown'
import { planFocusAlarm, type ExistingAlarm } from '../../lib/focusPlan'
import {
  focusRemainingMs,
  liveFocusOf,
  normalizeFocusSession,
  startFocusSession,
  type FocusSession,
  type NewFocusSession,
} from '../../models'
import {
  clear as clearAlarm,
  focusAlarmName,
  getAll as getAllAlarms,
  scheduleAt,
} from '../../services/alarms'
import {
  dismiss,
  focusNotificationId,
  notify,
} from '../../services/notifications'
import { readKey, writeKey } from '../../services/storage'
import { reconcile as reconcileBlocking, type BlockingStatus } from './blocking'

/**
 * Focus sessions: one deliberate stretch of attention, at most one live at a
 * time.
 *
 * Written for a worker that may be killed between any two lines. There is no
 * module-scope state — every entry point re-reads storage and re-reads
 * `chrome.alarms`, so the outcome is the same in a freshly started worker as in
 * one that has been alive for an hour. The planned end is an alarm rather than a
 * timer, because a timer dies with the worker; and remaining time is derived
 * from the persisted `endsAt`, so a closed panel or a restarted browser changes
 * nothing about what the user sees.
 *
 * `reconcile()` is idempotent and is the recovery path for every failure here:
 * if an alarm write is lost, the next reconcile puts it back — or, if the end
 * has already passed, completes the session on the spot.
 *
 * Website blocking hangs off the same transitions. Every one of them ends in
 * `blocking.reconcile()` rather than adding or removing rules itself: the rules
 * that should be in force are a function of the session that is persisted, so
 * making the session the only thing this module writes means blocking cannot
 * drift from it. Pausing therefore releases the websites and resuming brings
 * them back with no extra machinery, and a session interrupted by an eviction is
 * repaired by the sweep that repairs its alarm.
 */

/** The completion notification's only button: acknowledge and dismiss. */
const NOTIFICATION_BUTTONS = [{ title: 'Done' }]

/**
 * How far past `endsAt` an alarm may arrive and still count as "the end you woke
 * me for" rather than a stale delivery. Generous, because either way the
 * session is completed — this only decides whether it is treated as on time.
 */
export const FOCUS_GRACE_MS = 60_000

/* --- Reading -------------------------------------------------------------- */

/**
 * Every stored session, repaired on the way out.
 *
 * Normalisation happens here rather than at each call site so nothing
 * downstream has to know that earlier builds wrote a different shape. Rows that
 * cannot be made sense of are dropped.
 */
async function readSessions(): Promise<FocusSession[]> {
  const stored: unknown = await readKey('focusSessions')
  if (!Array.isArray(stored)) return []
  return stored
    .map((row) => normalizeFocusSession(row))
    .filter((session): session is FocusSession => session !== null)
}

async function writeSessions(sessions: readonly FocusSession[]): Promise<void> {
  await writeKey('focusSessions', [...sessions])
}

/**
 * Every stored session, normalised on the way out.
 *
 * Read-only view for Insights: the whole history is the dataset its numbers are
 * derived from, so it must be the same normalised shape the rest of this module
 * reads, not the raw rows an earlier build may have written.
 */
export async function list(): Promise<FocusSession[]> {
  return readSessions()
}

/** The live session — running or paused — or null. */
export async function getCurrent(): Promise<FocusSession | null> {
  return liveFocusOf(await readSessions())
}

/**
 * What the Focus surface needs in one round trip: the live session, and the
 * session that settled most recently so the page can show "complete" or
 * "cancelled" without keeping that in React state across a panel close.
 */
export type FocusSnapshot = {
  current: FocusSession | null
  last: FocusSession | null
}

export async function snapshot(): Promise<FocusSnapshot> {
  const sessions = await readSessions()
  const current = liveFocusOf(sessions)

  let last: FocusSession | null = null
  for (const session of sessions) {
    if (session.status === 'running' || session.status === 'paused') continue
    const at = session.endedAt ?? session.startedAt
    const bestAt = last === null ? -Infinity : (last.endedAt ?? last.startedAt)
    if (at >= bestAt) last = session
  }

  return { current, last }
}

/* --- Lifecycle ------------------------------------------------------------ */

export type StartResult =
  | { ok: true; session: FocusSession; blocking: BlockingStatus }
  /** Refused: a session is already live. The caller shows it rather than replacing it. */
  | { ok: false; reason: 'already-running'; session: FocusSession }

/**
 * Start a session.
 *
 * Refuses rather than replacing when one is already live: silently discarding
 * the session the user is in the middle of is never what they meant, and the
 * spec asks for the choice to be theirs. Concurrency is not supported.
 *
 * Order is deliberate: persist, then block, then set the alarm. Persisting first
 * is what makes the other two recoverable — an eviction after the write leaves a
 * session the sweep can finish arming, whereas rules or an alarm belonging to a
 * session that was never written would be orphaned with nothing to repair them.
 * Blocking precedes the alarm so that the status returned here describes rules
 * that are already in force by the time the caller renders "Focus started".
 */
export async function start(
  input: NewFocusSession,
  now = Date.now(),
): Promise<StartResult> {
  const sessions = await readSessions()
  const live = liveFocusOf(sessions)
  if (live) return { ok: false, reason: 'already-running', session: live }

  const session = startFocusSession(createId(), input, now)
  await writeSessions([...sessions, session])

  // Derived from what was just persisted, not from `input` — one path decides
  // what is blocked, and it is the same one a restart would take.
  const blocking = await reconcileBlocking()

  if (session.endsAt !== null) {
    const scheduled = await scheduleAt(focusAlarmName(session.id), session.endsAt)
    if (!scheduled) {
      // The session is persisted and its end is a timestamp, so the sweep will
      // notice and either re-create the alarm or complete it outright.
      console.warn('[timepilot] focus alarm could not be scheduled')
    }
  }
  return { ok: true, session, blocking }
}

/**
 * End a session early.
 *
 * Cancelled, never completed: the two mean different things to the user and the
 * record keeps them apart. The alarm goes first in intent but order does not
 * matter for correctness — a worker death between the two lines leaves either a
 * settled session with a stale alarm (which fires, finds nothing running, and
 * clears itself) or a live session with no alarm (which the sweep repairs).
 */
export async function cancel(now = Date.now()): Promise<FocusSession | null> {
  const sessions = await readSessions()
  const index = sessions.findIndex(
    (session) => session.status === 'running' || session.status === 'paused',
  )
  if (index === -1) return null

  const cancelled: FocusSession = {
    ...sessions[index],
    status: 'cancelled',
    endsAt: null,
    remainingMs: null,
    endedAt: now,
  }
  const next = [...sessions]
  next[index] = cancelled

  await writeSessions(next)
  await clearAlarm(focusAlarmName(cancelled.id))
  // A completion notification for this session must not linger or arrive later.
  await dismiss(focusNotificationId(cancelled.id))
  // Nothing is running now, so this releases every website the session held.
  await reconcileBlocking()
  return cancelled
}

/**
 * Pause the running session.
 *
 * The alarm is cleared and what was left is written down. That is the whole
 * mechanism: with no alarm nothing can fire, and with `endsAt` null there is no
 * instant to count towards, so time genuinely cannot continue while paused.
 */
export async function pause(now = Date.now()): Promise<FocusSession | null> {
  const sessions = await readSessions()
  const index = sessions.findIndex((session) => session.status === 'running')
  if (index === -1) return null

  const running = sessions[index]
  const left = focusRemainingMs(running, now)

  // Already at zero: pausing it would strand a session that is owed a
  // completion. Complete it instead of freezing it.
  if (left <= 0) return completeSession(running.id, now)

  const paused: FocusSession = {
    ...running,
    status: 'paused',
    endsAt: null,
    remainingMs: left,
  }
  const next = [...sessions]
  next[index] = paused

  await writeSessions(next)
  await clearAlarm(focusAlarmName(paused.id))
  // Paused means the websites come back: the session is no longer `running`, so
  // the reconciler removes the rules without being told to.
  await reconcileBlocking()
  return paused
}

/** Resume a paused session: a fresh `endsAt` from what was left, and a new alarm. */
export async function resume(now = Date.now()): Promise<FocusSession | null> {
  const sessions = await readSessions()
  const index = sessions.findIndex((session) => session.status === 'paused')
  if (index === -1) return null

  const left = Math.max(0, sessions[index].remainingMs ?? 0)
  const resumed: FocusSession = {
    ...sessions[index],
    status: 'running',
    endsAt: endsAtFrom(now, left),
    remainingMs: null,
  }
  const next = [...sessions]
  next[index] = resumed

  await writeSessions(next)
  // Running again, so the same reconciler puts the rules back — including any
  // domain added to the list while the session was paused.
  await reconcileBlocking()
  if (resumed.endsAt !== null) {
    await scheduleAt(focusAlarmName(resumed.id), resumed.endsAt)
  }
  return resumed
}

/* --- Firing --------------------------------------------------------------- */

/**
 * A focus alarm fired.
 *
 * The alarm carries only an id, so everything else is recomputed from storage.
 * Safe against every stale case: the session may have been cancelled, completed,
 * paused, or deleted since the alarm was written, and none of those may throw —
 * an unhandled rejection here would surface as a worker error.
 */
export async function fireFocus(
  sessionId: string,
  now = Date.now(),
): Promise<void> {
  await clearAlarm(focusAlarmName(sessionId))

  const sessions = await readSessions()
  const session = sessions.find((candidate) => candidate.id === sessionId)
  // Cancelled, already completed, or gone. The alarm is cleared; stay quiet.
  if (!session || session.status !== 'running') return

  // Paused-then-resumed can move the end later than the alarm that woke us.
  // Re-derive rather than trust the wake-up: reconcile puts the right alarm back.
  if (session.endsAt !== null && session.endsAt > now + FOCUS_GRACE_MS) {
    await reconcile(now)
    return
  }

  await completeSession(sessionId, now)
}

/**
 * Complete a session and raise the notification.
 *
 * The status is written before the notification, so a worker death in between
 * loses the notification rather than replaying the completion. The websites are
 * released before it too: an eviction must never leave rules standing for a
 * session that has finished, and losing the notification is the cheaper failure.
 */
async function completeSession(
  sessionId: string,
  now: number,
): Promise<FocusSession | null> {
  const sessions = await readSessions()
  const index = sessions.findIndex((session) => session.id === sessionId)
  if (index === -1) return null
  if (sessions[index].status === 'completed') return sessions[index]

  const completed: FocusSession = {
    ...sessions[index],
    status: 'completed',
    endsAt: null,
    remainingMs: null,
    endedAt: now,
  }
  const next = [...sessions]
  next[index] = completed

  await writeSessions(next)
  await clearAlarm(focusAlarmName(completed.id))
  await reconcileBlocking()

  const raised = await notify({
    id: focusNotificationId(completed.id),
    title: 'Focus session complete',
    message: `${completed.title} · ${formatDuration(completed.plannedMs)}`,
    requireInteraction: true,
    buttons: NOTIFICATION_BUTTONS,
  })
  if (raised === null) {
    // Muted by the user's setting or blocked by the OS. Not an error: the
    // session is complete either way.
    console.info('[timepilot] no notification shown for focus completion')
  }
  return completed
}

/** The notification's only button. Acknowledgement, not a state change. */
export async function acknowledge(sessionId: string): Promise<void> {
  await dismiss(focusNotificationId(sessionId))
}

/* --- Reconciliation ------------------------------------------------------- */

export type FocusReconcileResult = {
  created: number
  cleared: number
  completed: number
  failed: number
}

/**
 * Bring the focus alarm in line with the persisted session.
 *
 * Called on install, on start-up, on every sweep, and after a suspect fire. The
 * safety net for what listeners cannot observe: a browser closed across the end
 * of a session, a wall clock moved by suspend/resume or a time-zone change, an
 * alarm lost to an eviction. Reads both sides fresh and repairs the difference,
 * so it is safe to call at any time and cheap when there is nothing to do.
 */
export async function reconcile(
  now = Date.now(),
): Promise<FocusReconcileResult> {
  const result: FocusReconcileResult = {
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

  const plan = planFocusAlarm(current, existing, now)

  for (const name of plan.clear) {
    await clearAlarm(name)
    result.cleared += 1
  }

  if (plan.completeDue !== null) {
    // The end passed while nothing was listening. Complete it now — late is
    // correct, silently dropping it is not.
    const completed = await completeSession(plan.completeDue, now)
    if (completed) result.completed += 1
    return result
  }

  if (plan.create) {
    const ok = await scheduleAt(plan.create.name, plan.create.when)
    if (ok) result.created += 1
    else result.failed += 1
  }

  if (result.failed > 0) {
    console.warn('[timepilot] focus alarm could not be scheduled')
  }
  return result
}
