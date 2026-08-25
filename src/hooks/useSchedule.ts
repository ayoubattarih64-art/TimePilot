import { useMemo } from 'react'
import {
  nextOccurrenceOf,
  occurrenceOnDay,
  type ScheduledActivity,
} from '../models'
import { startOfLocalDay } from '../lib/time'

export type Occurrence = {
  activity: ScheduledActivity
  at: number
}

/**
 * The derived views Home and Schedule need: what is next, and what falls on a
 * given day. Pure derivation from the activity list — no I/O.
 */
export function useSchedule(activities: readonly ScheduledActivity[], now: number) {
  return useMemo(() => {
    const upcoming: Occurrence[] = []
    for (const activity of activities) {
      const at = nextOccurrenceOf(activity, now)
      if (at !== null) upcoming.push({ activity, at })
    }
    upcoming.sort((a, b) => a.at - b.at)

    const dayStart = startOfLocalDay(now)
    const today: Occurrence[] = []
    for (const activity of activities) {
      const at = occurrenceOnDay(activity, dayStart)
      if (at !== null) today.push({ activity, at })
    }
    today.sort((a, b) => a.at - b.at)

    return { upcoming, next: upcoming[0] ?? null, today }
  }, [activities, now])
}

/** Occurrences on one specific local day, soonest first. */
export function occurrencesOnDay(
  activities: readonly ScheduledActivity[],
  dayStart: number,
): Occurrence[] {
  const found: Occurrence[] = []
  for (const activity of activities) {
    const at = occurrenceOnDay(activity, dayStart)
    if (at !== null) found.push({ activity, at })
  }
  return found.sort((a, b) => a.at - b.at)
}
