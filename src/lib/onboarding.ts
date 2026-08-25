import {
  toDateKey,
  toTimeKey,
  type NewRoutine,
  type Timestamp,
} from '../models'

/**
 * Pure pieces of the welcome tour: the quick "when" choices for a first
 * reminder, and the routine templates offered on the routines step.
 *
 * No Chrome, no React — the same rule as every other planner in `lib/`, so the
 * choices the tour offers can be exercised on their own and can never drift
 * from the date arithmetic the rest of TimePilot uses.
 */

export type WhenChoice = {
  id: string
  label: string
  /** Local calendar date, YYYY-MM-DD, for the scheduled row. */
  date: string
  /** Local time, HH:MM, for the scheduled row. */
  time: string
}

const MINUTE_MS = 60_000

/**
 * The one-tap "when" options for a first reminder.
 *
 * "In an hour" is rounded to the minute so the created activity's fire time is
 * a clean one; "tomorrow morning" is the first sensible working moment of the
 * next day rather than the same clock time, which for an evening install would
 * be the middle of the night.
 */
export function whenChoices(now: Timestamp = Date.now()): WhenChoice[] {
  const inAnHour = new Date(now + 60 * MINUTE_MS)
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)

  return [
    {
      id: 'in-an-hour',
      label: 'In an hour',
      date: toDateKey(inAnHour.getTime()),
      time: toTimeKey(inAnHour.getTime()),
    },
    {
      id: 'tomorrow-morning',
      label: 'Tomorrow, 9:00',
      date: toDateKey(tomorrow.getTime()),
      time: '09:00',
    },
    {
      id: 'tomorrow-evening',
      label: 'Tomorrow, 19:00',
      date: toDateKey(tomorrow.getTime()),
      time: '19:00',
    },
  ]
}

/** A routine the tour can create in one tap, expressed for `routine/create`. */
export type RoutineTemplate = {
  id: string
  name: string
  description: string
  /** The line under the name: when it runs and how many steps. */
  summary: string
  input: Omit<NewRoutine, 'name' | 'description'>
}

/**
 * The offered starting points. Real routines with real steps — each becomes
 * ordinary scheduled activities through the existing create path, so what the
 * tour leaves behind is exactly what the user would have built by hand.
 */
export const ROUTINE_TEMPLATES: readonly RoutineTemplate[] = [
  {
    id: 'morning',
    name: 'Morning routine',
    description: 'Start the day deliberately.',
    summary: 'Weekdays · 07:00 · 3 steps',
    input: {
      daysOfWeek: [1, 2, 3, 4, 5],
      startTime: '07:00',
      steps: [
        { title: 'Morning reading', durationMinutes: 0, type: 'reminder' },
        { title: 'Stretch', durationMinutes: 15, type: 'timer' },
        { title: 'Plan the day', durationMinutes: 10, type: 'reminder' },
      ],
    },
  },
  {
    id: 'evening',
    name: 'Evening wind-down',
    description: 'Close the day on purpose.',
    summary: 'Every day · 21:00 · 2 steps',
    input: {
      daysOfWeek: [],
      startTime: '21:00',
      steps: [
        { title: 'Evening walk', durationMinutes: 0, type: 'reminder' },
        { title: 'Journal', durationMinutes: 15, type: 'focus' },
      ],
    },
  },
  {
    id: 'study',
    name: 'Study block',
    description: 'A repeatable place for deep work.',
    summary: 'Weekdays · 18:00 · 3 steps',
    input: {
      daysOfWeek: [1, 2, 3, 4, 5],
      startTime: '18:00',
      steps: [
        { title: 'Review notes', durationMinutes: 20, type: 'timer' },
        { title: 'Deep work', durationMinutes: 45, type: 'focus' },
        { title: 'Break', durationMinutes: 10, type: 'timer' },
      ],
    },
  },
]

/**
 * Whether the tour should show itself unprompted.
 *
 * The completed mark is the durable answer; this check is the first-run one,
 * and it deliberately excludes blocklists — they are seeded on install, so
 * their presence says nothing about whether a human has been here. An install
 * upgrading from before the tour existed has real data and reads as onboarded
 * rather than being ambushed by a welcome screen over a busy life.
 */
export function isFirstRun(usage: {
  scheduled: number
  routines: number
  focusUsed: boolean
  timerUsed: boolean
}): boolean {
  return (
    usage.scheduled === 0 &&
    usage.routines === 0 &&
    !usage.focusUsed &&
    !usage.timerUsed
  )
}
