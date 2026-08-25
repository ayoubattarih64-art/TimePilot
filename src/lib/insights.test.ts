import { describe, expect, it } from 'vitest'
import {
  MIN_SESSIONS_FOR_BEST_TIME,
  daysOf,
  insightsReport,
  periodRange,
  previousPeriodRange,
  type InsightsInput,
} from './insights'
import { toDateKey, type FocusSession, type Routine, type ScheduledActivity } from '../models'

/**
 * Unit tests for the pure analytics layer.
 *
 * Every timestamp is built from local date parts (`new Date(y, m, d, …)`), the
 * same way the engines themselves store and re-derive wall-clock times, so the
 * tests assert on calendar meaning rather than on absolute instants and pass in
 * any host timezone.
 */

const MINUTE = 60_000

/** Local timestamp from date parts; month is 1-based, the way it is written. */
function local(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

/** Thursday 20 August 2026, midday. Its week is Mon 17 … Mon 24 August. */
const NOW = local(2026, 8, 20, 12)

function session(
  at: number,
  minutes: number,
  overrides: Partial<FocusSession> = {},
): FocusSession {
  return {
    id: `s-${String(at)}-${String(minutes)}`,
    title: 'Focus',
    plannedMs: minutes * MINUTE,
    startedAt: at,
    endsAt: at + minutes * MINUTE,
    remainingMs: null,
    endedAt: at + minutes * MINUTE,
    activityId: null,
    status: 'completed',
    blocklistId: null,
    ...overrides,
  }
}

function activity(
  overrides: Partial<ScheduledActivity> = {},
): ScheduledActivity {
  return {
    id: `a-${String(overrides.lastFiredAt ?? 'none')}`,
    title: 'Study',
    type: 'reminder',
    date: '2026-08-18',
    time: '09:00',
    repeat: 'none',
    durationMinutes: 30,
    categoryId: 'study',
    notify: 'at-time',
    createdAt: 0,
    enabled: true,
    lastFiredAt: null,
    lastCompletedAt: null,
    ...overrides,
  }
}

function routineOf(id: string, name: string): Routine {
  return {
    id,
    name,
    description: '',
    categoryId: null,
    daysOfWeek: [1, 2, 3, 4, 5],
    startTime: '07:00',
    steps: [],
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  }
}

function input(overrides: Partial<InsightsInput> = {}): InsightsInput {
  return {
    activities: [],
    focusSessions: [],
    routines: [],
    now: NOW,
    ...overrides,
  }
}

function week(overrides: Partial<InsightsInput> = {}) {
  return insightsReport(input(overrides), 'week')
}

/** The daily bucket a timestamp falls into, from a report's distribution. */
function bucketFor(
  daily: { key: string; ms: number }[],
  at: number,
): { key: string; ms: number } | undefined {
  return daily.find((bucket) => bucket.key === toDateKey(at))
}

/* --- 1. Empty dataset ------------------------------------------------------ */

describe('insightsReport', () => {
  it('reports honest zeros on an empty dataset', () => {
    const report = week()

    expect(report.focus.totalMs).toBe(0)
    expect(report.focus.sessionCount).toBe(0)
    expect(report.focus.averageMs).toBeNull()
    expect(report.focus.bestTime).toBeNull()
    expect(report.focus.daily).toHaveLength(7)
    expect(report.focus.daily.every((bucket) => bucket.ms === 0)).toBe(true)

    expect(report.activities.completed).toBe(0)
    expect(report.activities.missed).toBe(0)
    expect(report.activities.pending).toBe(0)
    expect(report.activities.completionRate).toBeNull()

    expect(report.routines.perRoutine).toHaveLength(0)
    expect(report.routines.mostConsistent).toBeNull()

    expect(report.comparison.focusDeltaMs).toBeNull()
    expect(report.comparison.focusDeltaPercent).toBeNull()
    expect(report.comparison.completedDelta).toBeNull()
  })

  /* --- 2–3. Focus sessions ------------------------------------------------ */

  it('counts a single completed focus session and its distribution', () => {
    const at = local(2026, 8, 19, 10) // Wednesday of the selected week
    const report = week({ focusSessions: [session(at, 25)] })

    expect(report.focus.sessionCount).toBe(1)
    expect(report.focus.totalMs).toBe(25 * MINUTE)
    expect(report.focus.averageMs).toBe(25 * MINUTE)
    // One session is below the sample minimum, so no pattern is claimed.
    expect(report.focus.bestTime).toBeNull()
    expect(bucketFor(report.focus.daily, at)?.ms).toBe(25 * MINUTE)
    expect(report.focus.hourly[10]).toBe(25 * MINUTE)
  })

  it('sums completed sessions only, and separates the ones with blocking', () => {
    const report = week({
      focusSessions: [
        session(local(2026, 8, 17, 9), 60), // Monday
        session(local(2026, 8, 18, 14), 45), // Tuesday
        session(local(2026, 8, 19, 18, 30), 30, { blocklistId: 'bl-1' }),
        // Cancelled: its delivered amount is not derivable, so it counts nowhere.
        session(local(2026, 8, 18, 16), 50, { status: 'cancelled' }),
        // Previous week: outside the period.
        session(local(2026, 8, 11, 9), 90),
      ],
    })

    expect(report.focus.sessionCount).toBe(3)
    expect(report.focus.totalMs).toBe((60 + 45 + 30) * MINUTE)
    expect(report.focus.withBlockingMs).toBe(30 * MINUTE)
    expect(report.focus.withBlockingCount).toBe(1)
    expect(bucketFor(report.focus.daily, local(2026, 8, 17))?.ms).toBe(60 * MINUTE)
    expect(bucketFor(report.focus.daily, local(2026, 8, 18))?.ms).toBe(45 * MINUTE)
    expect(bucketFor(report.focus.daily, local(2026, 8, 11))?.ms ?? 0).toBe(0)
    expect(report.focus.hourly[18]).toBe(30 * MINUTE)
  })

  /* --- 4–6. Activity occurrences ------------------------------------------ */

  it('counts an occurrence completed after its fire', () => {
    const report = week({
      activities: [
        activity({
          id: 'a1',
          lastFiredAt: local(2026, 8, 18, 9),
          lastCompletedAt: local(2026, 8, 18, 9, 5),
        }),
      ],
    })

    expect(report.activities.completed).toBe(1)
    expect(report.activities.missed).toBe(0)
    expect(report.activities.pending).toBe(0)
    expect(report.activities.completionRate).toBe(1)
  })

  it('counts fired occurrences left past the window as missed', () => {
    const report = week({
      activities: [
        // Monday 08:00, never completed: far past the six-hour window.
        activity({ id: 'a1', lastFiredAt: local(2026, 8, 17, 8) }),
        // Completed before the latest fire, so that completion belongs to an
        // earlier occurrence — the fired one is still outstanding.
        activity({
          id: 'a2',
          lastFiredAt: local(2026, 8, 18, 9),
          lastCompletedAt: local(2026, 8, 17, 9),
        }),
      ],
    })

    expect(report.activities.completed).toBe(0)
    expect(report.activities.missed).toBe(2)
    expect(report.activities.completionRate).toBe(0)
  })

  it('never counts future, pending, or disabled rows as missed', () => {
    const report = week({
      activities: [
        // Scheduled for next week and never fired: no occurrence happened.
        activity({ id: 'future', date: '2026-08-25', time: '09:00' }),
        // Fired an hour ago: still actionable, not yet a miss.
        activity({ id: 'pending', lastFiredAt: NOW - 60 * MINUTE }),
        // Fired long ago but the row is disabled: a paused template, not a miss.
        activity({
          id: 'paused',
          lastFiredAt: local(2026, 8, 17, 8),
          enabled: false,
        }),
      ],
    })

    expect(report.activities.completed).toBe(0)
    expect(report.activities.missed).toBe(0)
    expect(report.activities.pending).toBe(2)
    expect(report.activities.completionRate).toBeNull()
  })

  /* --- 7. Routine-generated activities ------------------------------------ */

  it('separates routine step occurrences and rates each routine', () => {
    const report = week({
      routines: [routineOf('r1', 'Morning')],
      activities: [
        activity({
          id: 'step-1',
          routineId: 'r1',
          routineStepId: 's1',
          routineStepType: 'reminder',
          lastFiredAt: local(2026, 8, 18, 7),
          lastCompletedAt: local(2026, 8, 18, 7, 2),
        }),
        activity({
          id: 'step-2',
          routineId: 'r1',
          routineStepId: 's2',
          routineStepType: 'timer',
          lastFiredAt: local(2026, 8, 17, 7),
        }),
        activity({
          id: 'own',
          lastFiredAt: local(2026, 8, 19, 10),
          lastCompletedAt: local(2026, 8, 19, 10, 3),
        }),
      ],
    })

    // Routine section sees only the generated rows.
    expect(report.routines.completed).toBe(1)
    expect(report.routines.missed).toBe(1)
    expect(report.routines.completionRate).toBe(0.5)
    expect(report.routines.perRoutine).toHaveLength(1)
    expect(report.routines.perRoutine[0]).toMatchObject({
      routineId: 'r1',
      name: 'Morning',
      completed: 1,
      missed: 1,
    })
    // Two settled occurrences is below the consistency minimum.
    expect(report.routines.mostConsistent).toBeNull()

    // The overall activity counts include routine rows: 2 completed, 1 missed.
    expect(report.activities.completed).toBe(2)
    expect(report.activities.missed).toBe(1)
  })

  it('names the most consistent routine once enough settles', () => {
    const steps = [0, 1, 2].map((index) =>
      activity({
        id: `step-${String(index)}`,
        routineId: 'r1',
        routineStepId: `s${String(index)}`,
        lastFiredAt: local(2026, 8, 17 + index, 7),
        lastCompletedAt: local(2026, 8, 17 + index, 7, 2),
      }),
    )
    const report = week({
      routines: [routineOf('r1', 'Morning'), routineOf('r2', 'Evening')],
      activities: [
        ...steps,
        activity({
          id: 'e-1',
          routineId: 'r2',
          routineStepId: 'e1',
          lastFiredAt: local(2026, 8, 18, 19),
        }),
      ],
    })

    expect(report.routines.mostConsistent).not.toBeNull()
    expect(report.routines.mostConsistent?.routineId).toBe('r1')
    expect(report.routines.mostConsistent?.name).toBe('Morning')
    // Best rate first in the breakdown.
    expect(report.routines.perRoutine[0].routineId).toBe('r1')
  })

  /* --- 8–10. Period boundaries -------------------------------------------- */

  it('bounds today at local midnights', () => {
    const range = periodRange('today', NOW)
    expect(range.start).toBe(local(2026, 8, 20))
    expect(range.end).toBe(local(2026, 8, 21))

    const report = insightsReport(
      input({
        focusSessions: [
          session(local(2026, 8, 19, 23), 30), // yesterday → out
          session(local(2026, 8, 20, 0, 30), 20), // today → in
        ],
        activities: [
          activity({
            id: 'yesterday',
            lastFiredAt: local(2026, 8, 19, 23),
            lastCompletedAt: local(2026, 8, 19, 23, 2),
          }),
          activity({
            id: 'today',
            lastFiredAt: local(2026, 8, 20, 8),
            lastCompletedAt: local(2026, 8, 20, 8, 2),
          }),
        ],
      }),
      'today',
    )

    expect(report.focus.sessionCount).toBe(1)
    expect(report.focus.totalMs).toBe(20 * MINUTE)
    expect(report.focus.daily).toHaveLength(1)
    expect(report.focus.daily[0].label).toBe('Today')
    expect(report.activities.completed).toBe(1)
  })

  it('bounds the week Monday to Monday and labels all seven days', () => {
    const range = periodRange('week', NOW)
    expect(range.start).toBe(local(2026, 8, 17))
    expect(new Date(range.start).getDay()).toBe(1)
    expect(range.end).toBe(local(2026, 8, 24))

    const days = daysOf(range, 'week')
    expect(days.map((day) => day.label)).toEqual([
      'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
    ])

    // A Sunday and a Monday now both resolve to the week that contains them.
    expect(periodRange('week', local(2026, 8, 23, 10)).start).toBe(local(2026, 8, 17))
    expect(periodRange('week', local(2026, 8, 17, 10)).start).toBe(local(2026, 8, 17))

    const report = week({
      focusSessions: [
        session(local(2026, 8, 23, 23, 59), 15), // Sunday edge → in
        session(local(2026, 8, 24, 0), 15), // next Monday → out
        session(local(2026, 8, 16, 23), 15), // previous Sunday → out
      ],
    })
    expect(report.focus.sessionCount).toBe(1)
  })

  it('bounds the month at calendar months', () => {
    const range = periodRange('month', NOW)
    expect(range.start).toBe(local(2026, 8, 1))
    expect(range.end).toBe(local(2026, 9, 1))

    const days = daysOf(range, 'month')
    expect(days).toHaveLength(31)
    expect(days[0]?.label).toBe('1')
    expect(days[30]?.label).toBe('31')

    // February 2026 has no leap day.
    expect(
      daysOf(periodRange('month', local(2026, 2, 10)), 'month'),
    ).toHaveLength(28)

    const report = insightsReport(
      input({
        focusSessions: [
          session(local(2026, 7, 31, 23), 30), // July → out
          session(local(2026, 8, 1, 0), 30), // 1 August → in
          session(local(2026, 8, 31, 23), 30), // 31 August → in
        ],
      }),
      'month',
    )
    expect(report.focus.sessionCount).toBe(2)
  })

  /* --- 11. Comparison ----------------------------------------------------- */

  it('compares against the previous week only when it holds data', () => {
    const report = week({
      focusSessions: [
        session(local(2026, 8, 17, 9), 60),
        session(local(2026, 8, 18, 9), 40),
        session(local(2026, 8, 11, 9), 50), // last week
      ],
      activities: [
        activity({
          id: 'c1',
          lastFiredAt: local(2026, 8, 17, 9),
          lastCompletedAt: local(2026, 8, 17, 9, 2),
        }),
        activity({
          id: 'c2',
          lastFiredAt: local(2026, 8, 18, 9),
          lastCompletedAt: local(2026, 8, 18, 9, 2),
        }),
        activity({
          id: 'c3',
          lastFiredAt: local(2026, 8, 19, 9),
          lastCompletedAt: local(2026, 8, 19, 9, 2),
        }),
        activity({
          id: 'prev',
          lastFiredAt: local(2026, 8, 12, 9),
          lastCompletedAt: local(2026, 8, 12, 9, 2),
        }),
      ],
    })

    expect(report.comparison.focusDeltaMs).toBe(50 * MINUTE)
    expect(report.comparison.focusDeltaPercent).toBe(1) // +100%
    expect(report.comparison.completedDelta).toBe(2)

    const fresh = week({
      focusSessions: [session(local(2026, 8, 17, 9), 60)],
    })
    expect(fresh.comparison.focusDeltaMs).toBeNull()
    expect(fresh.comparison.focusDeltaPercent).toBeNull()
    expect(fresh.comparison.completedDelta).toBeNull()
  })

  it('shifts each previous period by one whole period', () => {
    expect(previousPeriodRange('today', NOW)).toEqual({
      start: local(2026, 8, 19),
      end: local(2026, 8, 20),
    })
    expect(previousPeriodRange('week', NOW)).toEqual({
      start: local(2026, 8, 10),
      end: local(2026, 8, 17),
    })
    expect(previousPeriodRange('month', NOW)).toEqual({
      start: local(2026, 7, 1),
      end: local(2026, 8, 1),
    })
  })

  /* --- 12. Best focus time ------------------------------------------------ */

  it('claims a best time only at the documented sample size', () => {
    expect(MIN_SESSIONS_FOR_BEST_TIME).toBe(5)

    const evening = (day: number, hour: number) =>
      session(local(2026, 8, day, hour), 30)

    // One short of the minimum: honest null, however concentrated.
    const few = week({
      focusSessions: [
        evening(17, 18), evening(18, 18), evening(19, 19), evening(20, 18),
      ],
    })
    expect(few.focus.bestTime).toBeNull()

    const enough = week({
      focusSessions: [
        evening(17, 18), evening(18, 18), evening(19, 19), evening(20, 18),
        evening(17, 19), session(local(2026, 8, 18, 9), 30),
      ],
    })
    expect(enough.focus.bestTime).not.toBeNull()
    expect(enough.focus.bestTime?.startHour).toBe(18)
    expect(enough.focus.bestTime?.endHour).toBe(21)
    expect(enough.focus.bestTime?.sessionCount).toBe(5)
  })

  /* --- 13. DST-safe local timestamps -------------------------------------- */

  it('keeps day buckets on local midnight across DST transition weeks', () => {
    // Weeks containing the US (8 March) and EU (29 March) 2026 spring-forward
    // dates — 5 March sits in Mon 2 … Sun 8, 27 March in Mon 23 … Sun 29. On
    // a host zone without DST these are ordinary weeks and the assertions
    // hold all the same, so the test is portable.
    for (const now of [local(2026, 3, 5, 12), local(2026, 3, 27, 12)]) {
      const days = daysOf(periodRange('week', now), 'week')
      expect(days).toHaveLength(7)
      for (const day of days) {
        const date = new Date(day.start)
        expect(date.getHours()).toBe(0)
        expect(date.getMinutes()).toBe(0)
        expect(date.getSeconds()).toBe(0)
        expect(day.key).toBe(toDateKey(day.start))
      }
    }
  })

  it('attributes a session on a DST transition day to that local day', () => {
    // 02:30 on 8 March 2026 does not exist in US zones; constructing it from
    // date parts normalises it, and whichever instant results must still land
    // on 8 March — never spill into a neighbouring bucket. The `now` is the
    // same Sunday, so the transition day is inside the selected week.
    const onTheDay = session(local(2026, 3, 8, 2, 30), 30)
    const report = insightsReport(
      input({ now: local(2026, 3, 8, 12), focusSessions: [onTheDay] }),
      'week',
    )
    expect(bucketFor(report.focus.daily, local(2026, 3, 8))?.ms).toBe(30 * MINUTE)
  })
})
