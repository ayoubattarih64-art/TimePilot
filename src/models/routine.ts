import type { Timestamp } from './activity'
import { toDateKey, toInstant } from './scheduled'

/**
 * A routine: a reusable plan for a day, not an entry in a calendar.
 *
 * The distinction runs through the whole feature. A routine is a *template* —
 * "Study, weekdays at 18:00, four steps". A `ScheduledActivity` is one planned
 * occurrence of one of those steps on one date, and it is what the existing
 * scheduler turns into a Chrome alarm. Routines therefore own no alarms and no
 * notifications of their own; they generate occurrences (see `lib/routinePlan`)
 * and the machinery that already works takes it from there.
 *
 * Scheduling is stored as local wall-clock time plus a weekday set, for the same
 * reason `ScheduledActivity` stores `date`/`time` strings: a 07:00 routine should
 * stay 07:00 across a DST shift or a flight, so the absolute instant is computed
 * against the current clock every time it is needed.
 */

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** Sunday-first, matching `Date.prototype.getDay()`. */
export const WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6]

/**
 * What a step is, and therefore which of TimePilot's existing engines runs it.
 *
 * Deliberately a label on the step rather than a second implementation: a timer
 * step is run by the countdown layer Focus already owns, and a focus step by the
 * Focus engine. Nothing here counts anything down or raises anything.
 */
export type RoutineStepType = 'reminder' | 'timer' | 'focus'

export const ROUTINE_STEP_TYPES: readonly RoutineStepType[] = [
  'reminder',
  'timer',
  'focus',
]

/**
 * One step of a routine.
 *
 * `id` is not decoration: steps are reordered and removed in the editor, and a
 * generated occurrence records the step it came from, so a step needs an
 * identity that survives both.
 */
export type RoutineStep = {
  id: string
  title: string
  /** Length in minutes. 0 means "no set length" — only sensible for a reminder. */
  durationMinutes: number
  type: RoutineStepType
}

export type Routine = {
  id: string
  name: string
  /** Free text, may be empty. Never used for scheduling. */
  description: string
  /** An id from ACTIVITY_CATEGORIES, or null for no category. */
  categoryId: string | null
  /** 0 = Sunday … 6 = Saturday. Empty means every day. */
  daysOfWeek: readonly Weekday[]
  /** Local start time of the first step, HH:MM on a 24-hour clock. */
  startTime: string
  steps: readonly RoutineStep[]
  /** A disabled routine keeps its definition but generates nothing. */
  enabled: boolean
  createdAt: Timestamp
  updatedAt: Timestamp
}

/** The fields a caller supplies. Identity and timestamps are the worker's. */
export type NewRoutine = {
  name: string
  description?: string
  categoryId?: string | null
  daysOfWeek?: readonly Weekday[]
  startTime?: string
  steps?: readonly NewRoutineStep[]
  enabled?: boolean
}

/** A step as submitted from the editor: `id` is assigned if it has none. */
export type NewRoutineStep = {
  id?: string
  title: string
  durationMinutes: number
  type: RoutineStepType
}

/** Bounds. High enough to be irrelevant in practice, low enough to catch abuse. */
export const MAX_ROUTINE_NAME = 60
export const MAX_ROUTINE_DESCRIPTION = 200
export const MAX_ROUTINE_STEPS = 20
export const MAX_ROUTINES = 50
export const MAX_STEP_TITLE = 60
/** A single step longer than a day would push later steps onto another date. */
export const MAX_STEP_MINUTES = 720

/* --- Recurrence ----------------------------------------------------------- */

/**
 * The four recurrence shapes the UI offers.
 *
 * Not a stored field: recurrence *is* `daysOfWeek`, and a preset is only a
 * shortcut for filling it in. Deriving the label instead of storing it means a
 * routine can never claim "Weekdays" while holding Saturday, and there is no
 * second thing to keep in step when the user toggles a day.
 *
 * Calendar rules beyond this — "every other Tuesday", "the last Friday of the
 * month" — are deliberately absent. A routine is a daily plan, and predictable
 * beats expressive here.
 */
export type RoutineRecurrence = 'daily' | 'weekdays' | 'weekends' | 'selected'

const WEEKDAY_DAYS: readonly Weekday[] = [1, 2, 3, 4, 5]
const WEEKEND_DAYS: readonly Weekday[] = [0, 6]

/** The days a preset stands for. `selected` has none of its own. */
export function daysForRecurrence(
  recurrence: RoutineRecurrence,
): readonly Weekday[] {
  switch (recurrence) {
    case 'daily':
      return WEEKDAYS
    case 'weekdays':
      return WEEKDAY_DAYS
    case 'weekends':
      return WEEKEND_DAYS
    case 'selected':
      return []
  }
}

function sameDays(a: readonly Weekday[], b: readonly Weekday[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((day) => set.has(day))
}

/** Which preset a day set corresponds to, if any. */
export function recurrenceOfDays(
  days: readonly Weekday[],
): RoutineRecurrence {
  // Empty means every day, so it reads as Daily rather than as a bare set.
  if (days.length === 0 || sameDays(days, WEEKDAYS)) return 'daily'
  if (sameDays(days, WEEKDAY_DAYS)) return 'weekdays'
  if (sameDays(days, WEEKEND_DAYS)) return 'weekends'
  return 'selected'
}

/** Which preset a routine's day set corresponds to, if any. */
export function recurrenceOf(routine: Routine): RoutineRecurrence {
  return recurrenceOfDays(routine.daysOfWeek)
}

/** Whether the routine runs on the given weekday. Empty days means every day. */
export function routineRunsOn(routine: Routine, weekday: Weekday): boolean {
  return routine.daysOfWeek.length === 0 || routine.daysOfWeek.includes(weekday)
}

/** Days in display order, Monday first — how a week is read, not how it is stored. */
export const WEEKDAY_ORDER: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0]

const WEEKDAY_INITIALS: Record<Weekday, string> = {
  0: 'S',
  1: 'M',
  2: 'T',
  3: 'W',
  4: 'T',
  5: 'F',
  6: 'S',
}

const WEEKDAY_NAMES: Record<Weekday, string> = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
}

/** One letter, for the day toggles. Ambiguous on its own — always paired with a label. */
export function weekdayInitial(day: Weekday): string {
  return WEEKDAY_INITIALS[day]
}

/** The day's full name, for the toggle's accessible name. */
export function weekdayName(day: Weekday): string {
  return WEEKDAY_NAMES[day]
}

/** "Every day" / "Weekdays" / "Mon, Wed, Fri" — the line under a routine's name. */
export function describeDays(routine: Routine): string {
  return describeDaysOf(routine.daysOfWeek)
}

/**
 * The same sentence for a day set that is not (yet) a stored routine — the
 * editor's live preview needs it before anything is saved.
 */
export function describeDaysOf(days: readonly Weekday[]): string {
  switch (recurrenceOfDays(days)) {
    case 'daily':
      return 'Every day'
    case 'weekdays':
      return 'Every weekday'
    case 'weekends':
      return 'Weekends'
    case 'selected':
      return WEEKDAY_ORDER.filter((day) => days.includes(day))
        .map((day) => weekdayName(day).slice(0, 3))
        .join(', ')
  }
}

/* --- Occurrences ---------------------------------------------------------- */

const DAY_MS = 86_400_000

/**
 * The instant this routine next starts, at or after `now`, or null when it never
 * will.
 *
 * Recomputed from wall-clock parts rather than stored, exactly as
 * `nextOccurrenceOf` does for an activity: a 07:00 routine stays 07:00 through a
 * DST transition. Eight days of walking covers every rule here — a weekly-shaped
 * set always recurs inside that.
 */
export function nextRoutineStart(
  routine: Routine,
  now: Timestamp = Date.now(),
): Timestamp | null {
  if (!routine.enabled) return null
  if (routine.steps.length === 0) return null

  for (let offset = 0; offset < 8; offset++) {
    const day = new Date(now + offset * DAY_MS)
    const candidate = toInstant(toDateKey(day.getTime()), routine.startTime)
    if (candidate === null || candidate < now) continue
    if (routineRunsOn(routine, day.getDay() as Weekday)) return candidate
  }
  return null
}

/** Total planned length of the routine, in minutes. */
export function routineDurationMinutes(routine: Routine): number {
  return routine.steps.reduce(
    (total, step) => total + Math.max(0, step.durationMinutes),
    0,
  )
}

/**
 * The local start time of each step, as "HH:MM", laid out back to back from the
 * routine's start.
 *
 * Pure string/number work so both the planner and the editor's preview use one
 * layout. A step that would spill past midnight is clamped to 23:59 rather than
 * silently moved to the next day — a routine is a plan for *a* day, and moving a
 * step across the date boundary would make the generated occurrence's date wrong.
 */
export function stepStartTimes(routine: Routine): string[] {
  return stepStartTimesFrom(routine.startTime, routine.steps)
}

/**
 * The same layout for a start time and a step list that are still being edited.
 * The editor previews "18:00 · 18:25 · 18:30" before anything is saved, and it
 * must be the *same* arithmetic the planner will use, not a second copy of it.
 */
export function stepStartTimesFrom(
  startTime: string,
  steps: readonly { durationMinutes: number }[],
): string[] {
  const start = parseTimeMinutes(startTime) ?? 0
  const times: string[] = []
  let cursor = start
  for (const step of steps) {
    times.push(formatTimeMinutes(Math.min(cursor, 23 * 60 + 59)))
    cursor += Math.max(0, Math.round(step.durationMinutes))
  }
  return times
}

/** Minutes past midnight for "HH:MM", or null when it is not a time. */
export function parseTimeMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/** "HH:MM" for minutes past midnight, clamped into the day. */
export function formatTimeMinutes(minutes: number): string {
  const clamped = Math.min(24 * 60 - 1, Math.max(0, Math.round(minutes)))
  const hours = String(Math.floor(clamped / 60)).padStart(2, '0')
  return `${hours}:${String(clamped % 60).padStart(2, '0')}`
}

/* --- Construction and repair ---------------------------------------------- */

/** A name that is never empty, whatever the user typed. */
export function routineName(input: string): string {
  const trimmed = input.trim().slice(0, MAX_ROUTINE_NAME)
  return trimmed.length > 0 ? trimmed : 'Routine'
}

function stepTitle(input: string): string {
  const trimmed = input.trim().slice(0, MAX_STEP_TITLE)
  return trimmed.length > 0 ? trimmed : 'Step'
}

function stepType(value: unknown): RoutineStepType {
  return value === 'timer' || value === 'focus' || value === 'reminder'
    ? value
    : 'reminder'
}

/** Whole minutes inside the allowed range. */
function stepMinutes(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.min(MAX_STEP_MINUTES, Math.max(0, Math.round(parsed)))
}

/** A weekday set with no duplicates, no nonsense values, and a stable order. */
export function normalizeDays(input: unknown): Weekday[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<Weekday>()
  for (const value of input) {
    const day = typeof value === 'number' ? Math.trunc(value) : Number.NaN
    if (Number.isInteger(day) && day >= 0 && day <= 6) seen.add(day as Weekday)
  }
  return WEEKDAYS.filter((day) => seen.has(day))
}

/** A time string that `toInstant` will accept. Falls back to 09:00. */
export function normalizeStartTime(input: unknown): string {
  if (typeof input !== 'string') return '09:00'
  const minutes = parseTimeMinutes(input)
  return minutes === null ? '09:00' : formatTimeMinutes(minutes)
}

/**
 * Build a step, assigning an id when the editor did not carry one.
 *
 * `makeId` is a parameter rather than an import so this module stays pure — the
 * worker passes `createId`, and a test can pass a counter.
 */
export function buildStep(
  input: NewRoutineStep,
  makeId: () => string,
): RoutineStep {
  const type = stepType(input.type)
  return {
    id:
      typeof input.id === 'string' && input.id.length > 0 ? input.id : makeId(),
    title: stepTitle(input.title),
    // A timer or a focus step with no length has nothing to count, so it gets a
    // usable default rather than a zero the engines would have to special-case.
    durationMinutes:
      type === 'reminder'
        ? stepMinutes(input.durationMinutes)
        : Math.max(1, stepMinutes(input.durationMinutes) || 25),
    type,
  }
}

export function createRoutine(
  id: string,
  input: NewRoutine,
  makeId: () => string,
  now: Timestamp = Date.now(),
): Routine {
  return {
    id,
    name: routineName(input.name),
    description: (input.description ?? '').trim().slice(0, MAX_ROUTINE_DESCRIPTION),
    categoryId:
      typeof input.categoryId === 'string' && input.categoryId.length > 0
        ? input.categoryId
        : null,
    daysOfWeek: normalizeDays(input.daysOfWeek ?? []),
    startTime: normalizeStartTime(input.startTime),
    steps: (input.steps ?? [])
      .slice(0, MAX_ROUTINE_STEPS)
      .map((step) => buildStep(step, makeId)),
    enabled: input.enabled !== false,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Repair a stored routine.
 *
 * Read-time normalisation rather than a schema migration, for the same reason as
 * blocklists and focus sessions: storage is writable by anything running as the
 * extension, and the only fields that could be missing have safe defaults. It
 * also absorbs the shape the *first* Routine type used — `startMinute` instead of
 * `startTime`, `weekdays` instead of `daysOfWeek`, `durationMs` instead of steps
 * — so a store written by an earlier build reads as a routine with no steps
 * rather than as garbage. A row with no usable id is dropped.
 */
export function normalizeRoutine(stored: unknown): Routine | null {
  if (typeof stored !== 'object' || stored === null) return null
  const raw = stored as Partial<Routine> & {
    startMinute?: number
    weekdays?: unknown
  }

  if (typeof raw.id !== 'string' || raw.id.length === 0) return null

  const createdAt =
    typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
      ? raw.createdAt
      : 0

  const legacyTime =
    typeof raw.startMinute === 'number' && Number.isFinite(raw.startMinute)
      ? formatTimeMinutes(raw.startMinute)
      : undefined

  return {
    id: raw.id,
    name: routineName(typeof raw.name === 'string' ? raw.name : ''),
    description:
      typeof raw.description === 'string'
        ? raw.description.trim().slice(0, MAX_ROUTINE_DESCRIPTION)
        : '',
    // An empty string is "no category" the same as an absent field, and the
    // mutators already coerce it — normalising here too keeps a hand-written or
    // legacy record from holding a category id that matches nothing.
    categoryId:
      typeof raw.categoryId === 'string' && raw.categoryId.length > 0
        ? raw.categoryId
        : null,
    daysOfWeek: normalizeDays(raw.daysOfWeek ?? raw.weekdays ?? []),
    startTime: normalizeStartTime(raw.startTime ?? legacyTime),
    steps: normalizeSteps(raw.steps),
    enabled: raw.enabled !== false,
    createdAt,
    updatedAt:
      typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
        ? raw.updatedAt
        : createdAt,
  }
}

/** Steps with usable ids, titles and lengths. Rows without an id are dropped. */
function normalizeSteps(stored: unknown): RoutineStep[] {
  if (!Array.isArray(stored)) return []
  const steps: RoutineStep[] = []
  for (const row of stored.slice(0, MAX_ROUTINE_STEPS)) {
    if (typeof row !== 'object' || row === null) continue
    const step = row as Partial<RoutineStep>
    if (typeof step.id !== 'string' || step.id.length === 0) continue
    const type = stepType(step.type)
    steps.push({
      id: step.id,
      title: stepTitle(typeof step.title === 'string' ? step.title : ''),
      durationMinutes:
        type === 'reminder'
          ? stepMinutes(step.durationMinutes)
          : Math.max(1, stepMinutes(step.durationMinutes) || 25),
      type,
    })
  }
  return steps
}

/* --- Categories ----------------------------------------------------------- */

/**
 * The categories offered when creating a routine.
 *
 * Secular and global by construction: they name times of day and areas of life,
 * nothing else. They are also optional — a routine with no category works
 * exactly the same, which is why `categoryId` is nullable.
 *
 * Each one points at an existing activity category where a sensible equivalent
 * exists, so a generated occurrence lands in the colour ramp the rest of
 * TimePilot already uses rather than in a second taxonomy. Where there is no
 * equivalent — "Morning" is a time, not a subject — the generated occurrence
 * carries the routine category's name as a custom label instead.
 */
export const ROUTINE_CATEGORIES: readonly {
  id: string
  name: string
  /** An id from ACTIVITY_CATEGORIES, or null to label it as custom. */
  activityCategoryId: string | null
}[] = [
  { id: 'morning', name: 'Morning', activityCategoryId: null },
  { id: 'work', name: 'Work', activityCategoryId: 'work' },
  { id: 'study', name: 'Study', activityCategoryId: 'study' },
  { id: 'fitness', name: 'Fitness', activityCategoryId: 'health' },
  { id: 'evening', name: 'Evening', activityCategoryId: null },
  { id: 'personal', name: 'Personal', activityCategoryId: 'personal' },
]

/** The routine category with this id, if it is one. */
export function routineCategoryOf(
  routine: Routine,
): (typeof ROUTINE_CATEGORIES)[number] | null {
  if (routine.categoryId === null) return null
  return ROUTINE_CATEGORIES.find((entry) => entry.id === routine.categoryId) ?? null
}
