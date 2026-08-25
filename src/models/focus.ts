import type { DurationMs, Timestamp } from './activity'
import { endsAtFrom, MINUTE_MS, remainingMs } from '../lib/countdown'

/**
 * A focus session: one deliberate stretch of attention on one thing.
 *
 * Distinct from a scheduled activity, which is a *plan* for the future. A focus
 * session is happening now, so it is stored as two absolute instants —
 * `startedAt` and `endsAt` — rather than a ticking number. Remaining time is
 * always derived (see `lib/countdown`), which is what keeps the countdown honest
 * across a closed side panel, an evicted worker, and a browser restart.
 *
 * Website blocking hangs off `blocklistId`, when the user chose a list. It is a
 * reference, not a copy: the list may be edited mid-session and the blocking
 * rules follow it (see `background/features/blocking`). Whether blocking is
 * *actually* in force is deliberately not stored here — it is read back from
 * Chrome, so a session can never claim protection it does not have.
 */
export type FocusSession = {
  id: string
  /** What the user is focusing on. Free text, or an activity's title. */
  title: string
  /** Planned length. The delivered length is `endedAt - startedAt`. */
  plannedMs: DurationMs
  startedAt: Timestamp
  /**
   * When the session is due. Null exactly while paused — a paused session has
   * no due instant, and `remainingMs` holds what is left instead.
   */
  endsAt: Timestamp | null
  /** Time left at the moment of pausing. Null unless `status` is 'paused'. */
  remainingMs: DurationMs | null
  /** When it stopped, however it stopped. Null while live. */
  endedAt: Timestamp | null
  /** The scheduled activity this session was started from, if any. */
  activityId: string | null
  status: FocusSessionStatus
  /** The blocklist to enforce while running. Null when the user chose none. */
  blocklistId: string | null
}

/**
 * 'idle' is deliberately absent: no session *is* the idle state, and encoding it
 * as a stored row would mean two ways to say the same thing. 'cancelled' and
 * 'completed' are kept apart because they mean different things to the user —
 * one reached zero, the other was ended early.
 */
export type FocusSessionStatus =
  | 'running'
  | 'paused'
  | 'completed'
  | 'cancelled'

/** Statuses in which a session still owns the Focus surface. */
const LIVE_STATUSES: ReadonlySet<FocusSessionStatus> = new Set([
  'running',
  'paused',
])

/** Whether this session is still the active one. */
export function isLiveFocus(session: FocusSession): boolean {
  return LIVE_STATUSES.has(session.status)
}

/** The live session out of a collection, if any. At most one may be live. */
export function liveFocusOf(
  sessions: readonly FocusSession[],
): FocusSession | null {
  return sessions.find(isLiveFocus) ?? null
}

/**
 * Milliseconds left on a session.
 *
 * The one place that knows how the two live statuses differ: a running session
 * counts down against the wall clock, a paused one is frozen at the figure
 * captured when it was paused. A settled session has nothing left.
 */
export function focusRemainingMs(
  session: FocusSession,
  now: number = Date.now(),
): DurationMs {
  if (session.status === 'paused') return Math.max(0, session.remainingMs ?? 0)
  if (session.status !== 'running') return 0
  return session.endsAt === null ? 0 : remainingMs(session.endsAt, now)
}

/** Planned length in whole minutes, for display. */
export function focusDurationMinutes(session: FocusSession): number {
  return Math.max(1, Math.round(session.plannedMs / MINUTE_MS))
}

/** Durations offered as one-tap presets, in minutes. */
export const FOCUS_PRESET_MINUTES: readonly number[] = [15, 25, 30, 45, 60]

export const MIN_FOCUS_MINUTES = 1
/** 8 hours. High enough never to be a limit in practice, low enough to catch a typo. */
export const MAX_FOCUS_MINUTES = 480

/** Clamp a requested duration to something a session can actually hold. */
export function clampFocusMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return FOCUS_PRESET_MINUTES[1]
  return Math.min(
    MAX_FOCUS_MINUTES,
    Math.max(MIN_FOCUS_MINUTES, Math.round(minutes)),
  )
}

export type NewFocusSession = {
  title: string
  durationMinutes: number
  activityId: string | null
  /** The blocklist to enforce, or null/absent for a session without blocking. */
  blocklistId?: string | null
}

/**
 * Build a running session. Pure, so the fields that must agree — `plannedMs`,
 * `startedAt`, `endsAt` — are derived together rather than assembled by each
 * caller.
 */
export function startFocusSession(
  id: string,
  input: NewFocusSession,
  now: number = Date.now(),
): FocusSession {
  const plannedMs = clampFocusMinutes(input.durationMinutes) * MINUTE_MS
  const title = input.title.trim()
  return {
    id,
    title: title.length > 0 ? title : 'Focus',
    plannedMs,
    startedAt: now,
    endsAt: endsAtFrom(now, plannedMs),
    remainingMs: null,
    endedAt: null,
    activityId: input.activityId,
    status: 'running',
    blocklistId: input.blocklistId ?? null,
  }
}

/**
 * Repair a stored session.
 *
 * Storage predates this shape: earlier builds wrote `state: 'abandoned'` with no
 * `title` and no `endsAt`. Reading is where that is absorbed, so nothing
 * downstream has to know two shapes existed. A row that cannot be made sense of
 * is settled rather than left live, because a live session that no code can
 * finish would block the surface forever.
 */
export function normalizeFocusSession(stored: unknown): FocusSession | null {
  if (typeof stored !== 'object' || stored === null) return null
  const raw = stored as Partial<FocusSession> & { state?: string }

  if (typeof raw.id !== 'string' || raw.id.length === 0) return null
  if (typeof raw.startedAt !== 'number' || !Number.isFinite(raw.startedAt)) {
    return null
  }

  const plannedMs =
    typeof raw.plannedMs === 'number' && Number.isFinite(raw.plannedMs)
      ? Math.max(0, raw.plannedMs)
      : 0
  const status = normalizeStatus(raw.status ?? raw.state)
  const running = status === 'running'
  const paused = status === 'paused'

  return {
    id: raw.id,
    title:
      typeof raw.title === 'string' && raw.title.trim().length > 0
        ? raw.title.trim()
        : 'Focus',
    plannedMs,
    startedAt: raw.startedAt,
    endsAt: running
      ? typeof raw.endsAt === 'number' && Number.isFinite(raw.endsAt)
        ? raw.endsAt
        : endsAtFrom(raw.startedAt, plannedMs)
      : null,
    remainingMs:
      paused && typeof raw.remainingMs === 'number'
        ? Math.max(0, raw.remainingMs)
        : paused
          ? 0
          : null,
    endedAt:
      typeof raw.endedAt === 'number' && Number.isFinite(raw.endedAt)
        ? raw.endedAt
        : null,
    activityId: typeof raw.activityId === 'string' ? raw.activityId : null,
    status,
    blocklistId: typeof raw.blocklistId === 'string' ? raw.blocklistId : null,
  }
}

function normalizeStatus(value: unknown): FocusSessionStatus {
  switch (value) {
    case 'running':
    case 'paused':
    case 'completed':
      return value
    // 'abandoned' is the pre-rename name for the same thing.
    case 'cancelled':
    case 'abandoned':
      return 'cancelled'
    default:
      return 'cancelled'
  }
}
