import type { DurationMs, Timestamp } from './activity'
import { endsAtFrom, MINUTE_MS, remainingMs as remainingUntil } from '../lib/countdown'

/**
 * A timer: a plain countdown, nothing more.
 *
 * Deliberately its own model and its own collection rather than a flag on a
 * focus session — focus is an intentional concentration session with blocking
 * and its own surface; a timer is "remind me in 25 minutes". They share the
 * countdown *arithmetic* (`lib/countdown`) and nothing else, which is why the
 * invariants below read the same as a focus session's: they are the only
 * honest way to store a pausable countdown as persisted data.
 *
 * Invariants, exactly as for focus:
 *
 *   running     endsAt != null,  remainingMs == null
 *   paused      endsAt == null,  remainingMs != null
 *   completed   endsAt == null,  remainingMs == null,  endedAt != null
 *   cancelled   endsAt == null,  remainingMs == null,  endedAt != null
 *
 * `plannedMs` is the *current* total length: adding time grows it alongside
 * `endsAt`/`remainingMs`, so the fraction shown as progress stays meaningful
 * after an extension.
 */

export type TimerSession = {
  id: string
  /** What this timer is for. Free text; defaults to "Timer". */
  title: string
  /** Current total length. Grows when time is added. */
  plannedMs: DurationMs
  startedAt: Timestamp
  /** Null exactly while paused. */
  endsAt: Timestamp | null
  /** Time left at the moment of pausing. Null unless `status` is 'paused'. */
  remainingMs: DurationMs | null
  /** When it stopped, however it stopped. Null while live. */
  endedAt: Timestamp | null
  status: TimerStatus
  createdAt: Timestamp
}

export type TimerStatus = 'running' | 'paused' | 'completed' | 'cancelled'

/** Statuses in which the timer still owns the Timer surface. */
const LIVE_STATUSES: ReadonlySet<TimerStatus> = new Set(['running', 'paused'])

export function isLiveTimer(timer: TimerSession): boolean {
  return LIVE_STATUSES.has(timer.status)
}

/** The live timer out of a collection, if any. At most one may be live. */
export function liveTimerOf(
  timers: readonly TimerSession[],
): TimerSession | null {
  return timers.find(isLiveTimer) ?? null
}

/** Durations offered as one-tap presets, in minutes. */
export const TIMER_PRESET_MINUTES: readonly number[] = [
  1, 5, 10, 15, 25, 30, 45, 60,
]

/** The quick "+ time" increments, in minutes. */
export const TIMER_ADD_MINUTES: readonly number[] = [1, 5]

export const MIN_TIMER_MINUTES = 1
/** 8 hours, matching focus: high enough never to bind, low enough to catch a typo. */
export const MAX_TIMER_MINUTES = 480

/** Clamp a requested duration to something a timer can actually hold. */
export function clampTimerMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return TIMER_PRESET_MINUTES[0]
  return Math.min(
    MAX_TIMER_MINUTES,
    Math.max(MIN_TIMER_MINUTES, Math.round(minutes)),
  )
}

export type NewTimerSession = {
  title: string
  durationMinutes: number
}

/**
 * Build a running timer. Pure, so the fields that must agree — `plannedMs`,
 * `startedAt`, `endsAt` — are derived together rather than assembled by each
 * caller.
 */
export function startTimerSession(
  id: string,
  input: NewTimerSession,
  now: number = Date.now(),
): TimerSession {
  const plannedMs = clampTimerMinutes(input.durationMinutes) * MINUTE_MS
  const title = input.title.trim()
  return {
    id,
    title: title.length > 0 ? title : 'Timer',
    plannedMs,
    startedAt: now,
    endsAt: endsAtFrom(now, plannedMs),
    remainingMs: null,
    endedAt: null,
    status: 'running',
    createdAt: now,
  }
}

/**
 * Milliseconds left on a timer.
 *
 * The one place that knows how the two live statuses differ: a running timer
 * counts down against the wall clock, a paused one is frozen at the figure
 * captured when it was paused. A settled timer has nothing left.
 */
export function timerRemainingMs(
  timer: TimerSession,
  now: number = Date.now(),
): DurationMs {
  if (timer.status === 'paused') {
    return Math.max(0, timer.remainingMs ?? 0)
  }
  if (timer.status !== 'running') return 0
  return timer.endsAt === null ? 0 : remainingUntil(timer.endsAt, now)
}

/**
 * Pause a running timer, capturing what is left.
 *
 * Pausing at (or past) zero would strand a timer that is already owed a
 * completion, so it completes instead of freezing — the same call the fire
 * path makes, reached from the UI.
 */
export function pauseTimerSession(
  timer: TimerSession,
  now: number = Date.now(),
): TimerSession {
  if (timer.status !== 'running') return timer
  const left = timerRemainingMs(timer, now)
  if (left <= 0) return completeTimerSession(timer, now)
  return { ...timer, status: 'paused', endsAt: null, remainingMs: left }
}

/** Resume a paused timer: a fresh `endsAt` from what was left. */
export function resumeTimerSession(
  timer: TimerSession,
  now: number = Date.now(),
): TimerSession {
  if (timer.status !== 'paused') return timer
  const left = Math.max(0, timer.remainingMs ?? 0)
  if (left <= 0) return completeTimerSession(timer, now)
  return { ...timer, status: 'running', endsAt: endsAtFrom(now, left), remainingMs: null }
}

/**
 * Add time to a live timer, running or paused.
 *
 * Running timers extend `endsAt`; paused ones grow `remainingMs`; both grow
 * `plannedMs` so progress stays a fraction of the current total. No clock is
 * read — extending is pure arithmetic on the stored fields — and the result is
 * clamped to the maximum length. A settled timer is returned unchanged, as
 * there is nothing to extend.
 */
export function extendTimerSession(
  timer: TimerSession,
  minutes: number,
): TimerSession {
  if (!isLiveTimer(timer)) return timer

  const requested = Math.round(minutes) * MINUTE_MS
  if (!Number.isFinite(requested) || requested <= 0) return timer

  const maxTotal = MAX_TIMER_MINUTES * MINUTE_MS
  const added = Math.min(requested, Math.max(0, maxTotal - timer.plannedMs))
  if (added <= 0) return timer

  return {
    ...timer,
    plannedMs: timer.plannedMs + added,
    endsAt: timer.endsAt === null ? null : timer.endsAt + added,
    remainingMs:
      timer.remainingMs === null ? null : timer.remainingMs + added,
  }
}

/** Cancel: stopped early, by hand. */
export function cancelTimerSession(
  timer: TimerSession,
  now: number = Date.now(),
): TimerSession {
  return { ...timer, status: 'cancelled', endsAt: null, remainingMs: null, endedAt: now }
}

/** Complete: reached zero, however that was noticed. */
export function completeTimerSession(
  timer: TimerSession,
  now: number = Date.now(),
): TimerSession {
  return { ...timer, status: 'completed', endsAt: null, remainingMs: null, endedAt: now }
}

/**
 * Repair a stored timer.
 *
 * Storage is writable by anything running as the extension, and this phase's
 * rows are new, so the only malformed shapes to absorb are hand-edited ones
 * and future migrations. The invariants at the top of this file are enforced
 * on the way out; a row with no usable id is dropped, because nothing can
 * address it.
 */
export function normalizeTimerSession(stored: unknown): TimerSession | null {
  if (typeof stored !== 'object' || stored === null) return null
  const raw = stored as Partial<TimerSession>

  if (typeof raw.id !== 'string' || raw.id.length === 0) return null
  if (typeof raw.startedAt !== 'number' || !Number.isFinite(raw.startedAt)) {
    return null
  }

  const plannedMs =
    typeof raw.plannedMs === 'number' && Number.isFinite(raw.plannedMs)
      ? Math.max(0, raw.plannedMs)
      : 0
  const createdAt =
    typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
      ? raw.createdAt
      : raw.startedAt

  const status =
    raw.status === 'running' || raw.status === 'paused' || raw.status === 'completed'
      ? raw.status
      : 'cancelled'

  const running = status === 'running'
  const paused = status === 'paused'

  const endsAt =
    running && typeof raw.endsAt === 'number' && Number.isFinite(raw.endsAt)
      ? raw.endsAt
      : running
        ? endsAtFrom(raw.startedAt, plannedMs)
        : null

  const remainingMs =
    paused && typeof raw.remainingMs === 'number'
      ? Math.max(0, raw.remainingMs)
      : paused
        ? 0
        : null

  const settledAt =
    typeof raw.endedAt === 'number' && Number.isFinite(raw.endedAt)
      ? raw.endedAt
      : null

  return {
    id: raw.id,
    title:
      typeof raw.title === 'string' && raw.title.trim().length > 0
        ? raw.title.trim()
        : 'Timer',
    plannedMs,
    startedAt: raw.startedAt,
    endsAt,
    remainingMs,
    endedAt: settledAt,
    status,
    createdAt,
  }
}
