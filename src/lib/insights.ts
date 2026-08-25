import {
  isRoutineStep,
  toDateKey,
  PENDING_WINDOW_MS,
  type DurationMs,
  type FocusSession,
  type Routine,
  type ScheduledActivity,
  type Timestamp,
} from '../models'
import { startOfLocalDay } from './time'

/**
 * Pure analytics layer for Insights.
 *
 * Everything here derives numbers from persisted domain rows and nothing else:
 * no Chrome APIs, no React, no clock reads (`now` is always a parameter), no
 * storage of its own. Given the same data and the same `now` it returns the
 * same report, which is what makes it testable and what keeps the page honest —
 * a number that cannot be traced back to a stored field does not belong here.
 *
 * The honest-limits rules this module is written under:
 *
 * - Focus time counts *completed* sessions only. A cancelled session's delivered
 *   amount is not derivable (cancel clears `remainingMs`), so none is invented.
 * - For a completed session, delivered focus equals `plannedMs`: completion
 *   means the countdown ran to zero, so the planned length is exactly what was
 *   consumed. The wall-clock span `endedAt - startedAt` would additionally
 *   count time the session spent paused, which was not focus.
 * - A session belongs to the local day (and hour) it *started* on.
 * - Activity completion is per row, not per occurrence: the scheduler stores
 *   `lastFiredAt` (the instant of the most recent occurrence that fired) and
 *   `lastCompletedAt` (when the user last marked one done). A repeating row
 *   therefore contributes only its most recent fired occurrence to a period;
 *   earlier occurrences were overwritten when the schedule advanced and cannot
 *   be reconstructed. Counts are exact for what is stored, and a lower bound
 *   on everything the user ever completed.
 * - Website blocking keeps no history of its own — the DNR rules are derived,
 *   and whether enforcement actually held during a session is not persisted.
 *   What *is* persisted is the session's `blocklistId`, so the report can state
 *   focus time in sessions that had blocking attached. That is a request
 *   measure, not a verified enforcement measure, and the UI labels it as such.
 */

/* --- Periods --------------------------------------------------------------- */

export type InsightsPeriod = 'today' | 'week' | 'month'

export const INSIGHTS_PERIODS: readonly InsightsPeriod[] = [
  'today',
  'week',
  'month',
]

/** Inclusive start, exclusive end; both are local midnights. */
export type PeriodRange = {
  start: Timestamp
  end: Timestamp
}

/** Local midnight `days` after the local day containing `at`. Date-part arithmetic, so a DST transition shifts the instant correctly. */
function dayShift(at: Timestamp, days: number): Timestamp {
  const date = new Date(at)
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
  ).getTime()
}

/**
 * The range a period covers, in the user's local wall clock.
 *
 * Weeks start on Monday, matching how `WEEKDAY_ORDER` presents a week
 * everywhere else in TimePilot. Month boundaries are calendar months. All
 * boundaries are computed with `Date` parts rather than millisecond arithmetic,
 * which is what keeps a 23- or 25-hour DST day from shifting a boundary.
 */
export function periodRange(period: InsightsPeriod, now: Timestamp): PeriodRange {
  const today = startOfLocalDay(now)
  switch (period) {
    case 'today':
      return { start: today, end: dayShift(today, 1) }
    case 'week': {
      // Monday-first: (getDay() + 6) % 7 maps Sun=0…Sat=6 to Mon=0…Sun=6.
      const back = (new Date(today).getDay() + 6) % 7
      const start = dayShift(today, -back)
      return { start, end: dayShift(start, 7) }
    }
    case 'month': {
      const date = new Date(today)
      const start = new Date(date.getFullYear(), date.getMonth(), 1).getTime()
      const end = new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime()
      return { start, end }
    }
  }
}

/** The period immediately before the one `periodRange` would return. */
export function previousPeriodRange(
  period: InsightsPeriod,
  now: Timestamp,
): PeriodRange {
  const current = periodRange(period, now)
  switch (period) {
    case 'today':
      return { start: dayShift(current.start, -1), end: current.start }
    case 'week':
      return { start: dayShift(current.start, -7), end: current.start }
    case 'month': {
      const date = new Date(current.start)
      const start = new Date(date.getFullYear(), date.getMonth() - 1, 1).getTime()
      return { start, end: current.start }
    }
  }
}

/* --- Day buckets ----------------------------------------------------------- */

export type DayBucket = {
  /** "YYYY-MM-DD" — the local day this bucket aggregates. */
  key: string
  /** Short display label: "Mon" in a week, "14" in a month, "Today" alone. */
  label: string
  /** Local midnight the bucket starts at. */
  start: Timestamp
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * Every local day in a range, in order, whether or not anything happened.
 *
 * A day with no focus sessions is a real zero, not missing data, so the chart
 * fills the whole period. Buckets are walked with date-part arithmetic for the
 * same DST reason as the boundaries above.
 */
export function daysOf(
  range: PeriodRange,
  period: InsightsPeriod,
): DayBucket[] {
  const buckets: DayBucket[] = []
  for (let at = range.start; at < range.end; at = dayShift(at, 1)) {
    const date = new Date(at)
    buckets.push({
      key: toDateKey(at),
      label:
        period === 'today'
          ? 'Today'
          : period === 'week'
            ? WEEKDAY_LABELS[(date.getDay() + 6) % 7]
            : String(date.getDate()),
      start: at,
    })
  }
  return buckets
}

/* --- Focus ----------------------------------------------------------------- */

/** Minimum completed sessions before a "best time" pattern is claimed. */
export const MIN_SESSIONS_FOR_BEST_TIME = 5

/** Width of the best-focus-time window, in hours. */
export const BEST_TIME_WINDOW_HOURS = 3

export type BestFocusTime = {
  /** First hour of the window, 0–21 local. */
  startHour: number
  /** Exclusive end hour, `startHour + BEST_TIME_WINDOW_HOURS`. */
  endHour: number
  /** Completed sessions that started inside the window. */
  sessionCount: number
  /** Focus ms those sessions delivered. */
  totalMs: DurationMs
}

/** One day of the focus distribution: the bucket plus the focus ms in it. */
export type DailyFocus = DayBucket & { ms: DurationMs }

export type FocusInsights = {
  /** Delivered focus ms across completed sessions in the period. */
  totalMs: DurationMs
  /** Completed sessions in the period. */
  sessionCount: number
  /** Mean delivered focus per completed session; null when there are none. */
  averageMs: DurationMs | null
  /** Focus ms per local day of session start, zero-filled across the period. */
  daily: DailyFocus[]
  /** Focus ms per local start hour (index 0–23) across the period. */
  hourly: DurationMs[]
  /** Focus ms in completed sessions that had a blocklist attached. */
  withBlockingMs: DurationMs
  /** How many of those sessions there were. */
  withBlockingCount: number
  /**
   * The strongest contiguous focus window, or null below the sample minimum.
   * Null is the honest answer for "no pattern yet", never a guess.
   */
  bestTime: BestFocusTime | null
}

/** Delivered focus of one session: `plannedMs` when completed, else nothing. */
function focusMsOf(session: FocusSession): DurationMs | null {
  if (session.status !== 'completed') return null
  // Reaching zero consumed exactly the planned length; see module header.
  return Math.max(0, session.plannedMs)
}

function inRange(at: Timestamp, range: PeriodRange): boolean {
  return at >= range.start && at < range.end
}

function focusInsights(
  sessions: readonly FocusSession[],
  range: PeriodRange,
  period: InsightsPeriod,
): FocusInsights {
  const daily = daysOf(range, period).map((bucket) => ({ ...bucket, ms: 0 }))
  const dailyByKey = new Map(daily.map((bucket) => [bucket.key, bucket]))
  const hourly: DurationMs[] = new Array(24).fill(0)

  let totalMs = 0
  let sessionCount = 0
  let withBlockingMs = 0
  let withBlockingCount = 0
  const byHourCount = new Array(24).fill(0)

  for (const session of sessions) {
    const ms = focusMsOf(session)
    if (ms === null || !inRange(session.startedAt, range)) continue

    totalMs += ms
    sessionCount += 1
    const bucket = dailyByKey.get(toDateKey(session.startedAt))
    if (bucket) bucket.ms += ms
    const hour = new Date(session.startedAt).getHours()
    hourly[hour] += ms
    byHourCount[hour] += 1

    if (session.blocklistId !== null) {
      withBlockingMs += ms
      withBlockingCount += 1
    }
  }

  return {
    totalMs,
    sessionCount,
    averageMs: sessionCount > 0 ? Math.round(totalMs / sessionCount) : null,
    daily,
    hourly,
    withBlockingMs,
    withBlockingCount,
    bestTime: bestFocusTime(hourly, byHourCount),
  }
}

/**
 * The contiguous window with the most delivered focus, given enough sessions.
 *
 * `MIN_SESSIONS_FOR_BEST_TIME` is the sample size below which a single busy
 * evening would look like a pattern; it is a judgement call, deliberately in
 * code so it can be argued with in one place.
 *
 * Candidate windows start only on an hour that actually holds focus — a
 * "strongest period" that began in an hour the user never focused in would be
 * an artefact of the window shape, not a habit. Hours near midnight are
 * clamped so late-night focus still gets a window that contains it. Ties
 * resolve to more sessions, then to the earlier window, so the answer is
 * deterministic.
 */
function bestFocusTime(
  hourly: readonly DurationMs[],
  hourlyCounts: readonly number[],
): BestFocusTime | null {
  const sessions = hourlyCounts.reduce((sum, count) => sum + count, 0)
  if (sessions < MIN_SESSIONS_FOR_BEST_TIME) return null

  const starts = new Set<number>()
  for (let hour = 0; hour < 24; hour += 1) {
    if (hourlyCounts[hour] > 0) {
      starts.add(Math.min(hour, 24 - BEST_TIME_WINDOW_HOURS))
    }
  }

  let best: BestFocusTime | null = null
  for (const start of starts) {
    let totalMs = 0
    let count = 0
    for (let hour = start; hour < start + BEST_TIME_WINDOW_HOURS; hour += 1) {
      totalMs += hourly[hour]
      count += hourlyCounts[hour]
    }
    if (totalMs <= 0) continue
    if (
      best === null ||
      totalMs > best.totalMs ||
      (totalMs === best.totalMs && count > best.sessionCount)
    ) {
      best = {
        startHour: start,
        endHour: start + BEST_TIME_WINDOW_HOURS,
        sessionCount: count,
        totalMs,
      }
    }
  }
  return best
}

/* --- Activities ------------------------------------------------------------ */

export type ActivityInsights = {
  /** Fired occurrences in the period the user marked done. */
  completed: number
  /** Fired occurrences that aged past the pending window with no completion. */
  missed: number
  /** `completed / (completed + missed)`; null before anything settles. */
  completionRate: number | null
  /** Fired occurrences still within their actionable window (or disabled). */
  pending: number
}

/**
 * What one row can account for, if anything.
 *
 * The occurrence a row speaks for is the one `lastFiredAt` names — the most
 * recent one that fired. It was completed when `lastCompletedAt` postdates the
 * fire (the same comparison `isCompletedForLastFire` makes for the card). An
 * occurrence that has neither been completed nor aged out is pending, not
 * missed; neither is one on a disabled row, because a paused template must not
 * read as a failure. Occurrences that never fired — future ones, and past ones
 * the browser was closed for — leave no mark and are not counted at all.
 */
function occurrenceOf(
  activity: ScheduledActivity,
  now: Timestamp,
): { at: Timestamp; outcome: 'completed' | 'missed' | 'pending' } | null {
  const fired = activity.lastFiredAt ?? null
  if (fired === null) return null

  const completedAt = activity.lastCompletedAt ?? null
  if (completedAt !== null && completedAt >= fired) {
    return { at: fired, outcome: 'completed' }
  }
  if (!activity.enabled) return { at: fired, outcome: 'pending' }
  if (fired + PENDING_WINDOW_MS > now) return { at: fired, outcome: 'pending' }
  return { at: fired, outcome: 'missed' }
}

function activityInsights(
  activities: readonly ScheduledActivity[],
  scope: (activity: ScheduledActivity) => boolean,
  range: PeriodRange,
  now: Timestamp,
): ActivityInsights {
  let completed = 0
  let missed = 0
  let pending = 0

  for (const activity of activities) {
    if (!scope(activity)) continue
    const occurrence = occurrenceOf(activity, now)
    if (occurrence === null || !inRange(occurrence.at, range)) continue
    if (occurrence.outcome === 'completed') completed += 1
    else if (occurrence.outcome === 'missed') missed += 1
    else pending += 1
  }

  const settled = completed + missed
  return {
    completed,
    missed,
    completionRate: settled > 0 ? completed / settled : null,
    pending,
  }
}

/* --- Routines -------------------------------------------------------------- */

/** Settled occurrences before a routine can be called "most consistent". */
export const MIN_OCCURRENCES_FOR_CONSISTENCY = 3

export type RoutinePerformance = {
  routineId: string
  name: string
  completed: number
  missed: number
  /** Same definition as the overall rate; null before anything settles. */
  completionRate: number | null
}

export type RoutineInsights = {
  completed: number
  missed: number
  completionRate: number | null
  pending: number
  /** Per-routine breakdown, best rate first. */
  perRoutine: RoutinePerformance[]
  /**
   * The routine with the highest completion rate among those with enough
   * settled occurrences. Null when no routine reaches the minimum — "most
   * consistent" from one occurrence would be a pattern claimed from nothing.
   */
  mostConsistent: RoutinePerformance | null
}

function routineInsights(
  activities: readonly ScheduledActivity[],
  routines: readonly Routine[],
  range: PeriodRange,
  now: Timestamp,
): RoutineInsights {
  const overall = activityInsights(
    activities,
    isRoutineStep,
    range,
    now,
  )

  const names = new Map(routines.map((routine) => [routine.id, routine.name]))
  const per = new Map<string, RoutinePerformance>()
  for (const activity of activities) {
    if (!isRoutineStep(activity)) continue
    // A row whose routine is gone should not exist — deletion retires its rows
    // and clears the marks — but if one ever slips through, it has no name to
    // report and no routine to attribute, so it is skipped rather than guessed.
    const name = names.get(activity.routineId ?? '')
    if (name === undefined) continue

    let entry = per.get(activity.routineId ?? '')
    if (!entry) {
      entry = {
        routineId: activity.routineId ?? '',
        name,
        completed: 0,
        missed: 0,
        completionRate: null,
      }
      per.set(activity.routineId ?? '', entry)
    }

    const occurrence = occurrenceOf(activity, now)
    if (occurrence === null || !inRange(occurrence.at, range)) continue
    if (occurrence.outcome === 'completed') entry.completed += 1
    else if (occurrence.outcome === 'missed') entry.missed += 1
  }

  const perRoutine = [...per.values()].map((entry) => {
    const settled = entry.completed + entry.missed
    return {
      ...entry,
      completionRate: settled > 0 ? entry.completed / settled : null,
    }
  })
  perRoutine.sort((a, b) => {
    const rateA = a.completionRate ?? -1
    const rateB = b.completionRate ?? -1
    if (rateA !== rateB) return rateB - rateA
    return b.completed + b.missed - (a.completed + a.missed)
  })

  let mostConsistent: RoutinePerformance | null = null
  for (const entry of perRoutine) {
    const settled = entry.completed + entry.missed
    if (settled < MIN_OCCURRENCES_FOR_CONSISTENCY) continue
    if ((entry.completionRate ?? 0) <= 0) continue
    mostConsistent = entry
    break
  }

  return { ...overall, perRoutine, mostConsistent }
}

/* --- Comparison ------------------------------------------------------------ */

export type PeriodComparison = {
  /** Current minus previous focus ms; null when the previous week was empty. */
  focusDeltaMs: number | null
  /** Relative focus change; null when there is no previous total to divide by. */
  focusDeltaPercent: number | null
  /** Current minus previous completed occurrences; null when nothing settled before. */
  completedDelta: number | null
}

function comparisonOf(
  current: { focus: FocusInsights; activities: ActivityInsights },
  previous: { focus: FocusInsights; activities: ActivityInsights },
): PeriodComparison {
  const previousFocusExists = previous.focus.sessionCount > 0
  const previousActivitiesExist =
    previous.activities.completed + previous.activities.missed > 0

  return {
    focusDeltaMs: previousFocusExists
      ? current.focus.totalMs - previous.focus.totalMs
      : null,
    focusDeltaPercent:
      previousFocusExists && previous.focus.totalMs > 0
        ? (current.focus.totalMs - previous.focus.totalMs) /
          previous.focus.totalMs
        : null,
    completedDelta: previousActivitiesExist
      ? current.activities.completed - previous.activities.completed
      : null,
  }
}

/* --- Report ---------------------------------------------------------------- */

export type InsightsInput = {
  activities: readonly ScheduledActivity[]
  focusSessions: readonly FocusSession[]
  routines: readonly Routine[]
  now: Timestamp
}

export type InsightsReport = {
  period: InsightsPeriod
  range: PeriodRange
  focus: FocusInsights
  activities: ActivityInsights
  routines: RoutineInsights
  comparison: PeriodComparison
}

/** Everything the Insights page shows, derived once from persisted rows. */
export function insightsReport(
  input: InsightsInput,
  period: InsightsPeriod,
): InsightsReport {
  const range = periodRange(period, input.now)
  const previousRange = previousPeriodRange(period, input.now)

  const focus = focusInsights(input.focusSessions, range, period)
  const activities = activityInsights(
    input.activities,
    () => true,
    range,
    input.now,
  )
  const routines = routineInsights(input.activities, input.routines, range, input.now)

  return {
    period,
    range,
    focus,
    activities,
    routines,
    comparison: comparisonOf(
      { focus, activities },
      {
        focus: focusInsights(input.focusSessions, previousRange, period),
        activities: activityInsights(
          input.activities,
          () => true,
          previousRange,
          input.now,
        ),
      },
    ),
  }
}
