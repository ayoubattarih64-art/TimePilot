import {
  CUSTOM_CATEGORY_ID,
  recurrenceOf,
  routineCategoryOf,
  routineRunsOn,
  stepStartTimes,
  toDateKey,
  toInstant,
  type NewScheduledActivity,
  type Routine,
  type RoutineStepType,
  type ScheduledActivity,
  type Weekday,
} from '../models'

/**
 * Pure planner: routines in, scheduled activities out.
 *
 * The generation chain is deliberately one-way and stops here —
 *
 *     Routine → this planner → ScheduledActivity → existing scheduler → alarm
 *
 * — so routines own no alarms, no notifications and no recurrence rules of their
 * own. A routine is expanded into ordinary `ScheduledActivity` rows and from that
 * point on it is indistinguishable from something the user typed by hand: the
 * same `nextOccurrenceOf`, the same `nextFireOf`, the same `planSchedule`, the
 * same notification. That is the whole design, and it is why there is no
 * `routineScheduler`.
 *
 * No Chrome calls and no I/O, exactly like `schedulePlan`, `focusPlan` and
 * `blockingRules`, so the rules below can be read and exercised on their own.
 */

/**
 * Recurrence is expressed with the `RepeatRule` that already exists rather than
 * a new one:
 *
 * - every day            → one row, `repeat: 'daily'`
 * - weekdays (Mon–Fri)   → one row, `repeat: 'weekdays'`
 * - anything else        → one row per selected weekday, `repeat: 'weekly'`
 *
 * Weekends and hand-picked days therefore reuse the weekly rule rather than
 * introduce a rule that understands day sets. It costs a row per day, and it
 * buys the guarantee that every recurrence decision in TimePilot is still made
 * by `nextOccurrenceOf`.
 */
export type PlannedRepeat = 'daily' | 'weekdays' | 'weekly'

/** One row a routine wants to exist, plus the marks that tie it to its source. */
export type PlannedOccurrence = {
  /** The stable identity of this row across regenerations. See `occurrenceKey`. */
  key: string
  input: NewScheduledActivity
  routineId: string
  routineStepId: string
  routineStepType: RoutineStepType
}

/**
 * The identity of a generated row, derivable from both a plan and a stored
 * activity — which is what lets reconciliation match the two without storing a
 * key. A weekly row is per weekday, so the weekday is part of it; a daily or
 * weekdays row covers the whole set and uses `*`.
 */
export function occurrenceKey(
  routineId: string,
  stepId: string,
  repeat: PlannedRepeat,
  weekday: Weekday | null,
): string {
  const day = repeat === 'weekly' && weekday !== null ? String(weekday) : '*'
  return `${routineId}:${stepId}:${repeat}:${day}`
}

/** The key a stored activity belongs to, or null when it was not generated. */
export function keyOfActivity(activity: ScheduledActivity): string | null {
  const routineId = activity.routineId ?? null
  const stepId = activity.routineStepId ?? null
  if (routineId === null || stepId === null) return null
  if (activity.repeat === 'none') return null

  const first = toInstant(activity.date, activity.time)
  const weekday =
    activity.repeat === 'weekly' && first !== null
      ? (new Date(first).getDay() as Weekday)
      : null
  return occurrenceKey(routineId, stepId, activity.repeat, weekday)
}

/**
 * The repeat rule and weekday set a routine expands into.
 *
 * `weekdays` is empty for the two rules that already cover a set of days; for
 * `weekly` it lists the days that each need their own row.
 */
export function repeatForRoutine(routine: Routine): {
  repeat: PlannedRepeat
  weekdays: readonly Weekday[]
} {
  switch (recurrenceOf(routine)) {
    case 'daily':
      return { repeat: 'daily', weekdays: [] }
    case 'weekdays':
      return { repeat: 'weekdays', weekdays: [] }
    case 'weekends':
    case 'selected': {
      const days = routine.daysOfWeek.filter((day) => routineRunsOn(routine, day))
      return { repeat: 'weekly', weekdays: days }
    }
  }
}

/**
 * The first date a weekly row should carry, as "YYYY-MM-DD".
 *
 * `nextOccurrenceOf` reads a weekly rule's weekday off its first occurrence, so
 * the date is what actually encodes "every Tuesday". It is the *coming* Tuesday
 * rather than an arbitrary past one, which also means the row never starts life
 * looking overdue.
 */
function firstDateFor(weekday: Weekday | null, time: string, now: number): string {
  for (let offset = 0; offset < 8; offset++) {
    const day = new Date(now + offset * 86_400_000)
    const key = toDateKey(day.getTime())
    const at = toInstant(key, time)
    if (at === null) continue
    if (weekday !== null && day.getDay() !== weekday) continue
    // Today only counts if the time has not already gone; otherwise the row
    // would be created already in the past and fire nothing until it recurs.
    if (offset === 0 && at < now) continue
    return key
  }
  return toDateKey(now)
}

/**
 * Every row one routine wants to exist.
 *
 * Bounded by construction: one row per step per selected weekday, and nothing
 * beyond that. There is no horizon to choose and no future occurrences to
 * materialise, because a repeating `ScheduledActivity` already means "every
 * weekday at 18:25" — the scheduler computes each occurrence when it needs it.
 * That is what keeps "do not create all future occurrences indefinitely" true
 * without a sliding window to maintain.
 */
export function planRoutineOccurrences(
  routine: Routine,
  now: number = Date.now(),
): PlannedOccurrence[] {
  if (!routine.enabled) return []
  if (routine.steps.length === 0) return []

  const { repeat, weekdays } = repeatForRoutine(routine)
  // `weekly` needs one row per day; the other two rules cover their days alone.
  const days: readonly (Weekday | null)[] =
    repeat === 'weekly' ? weekdays : [null]
  if (days.length === 0) return []

  const times = stepStartTimes(routine)
  const planned: PlannedOccurrence[] = []

  for (const weekday of days) {
    routine.steps.forEach((step, index) => {
      const time = times[index]
      planned.push({
        key: occurrenceKey(routine.id, step.id, repeat, weekday),
        routineId: routine.id,
        routineStepId: step.id,
        routineStepType: step.type,
        input: {
          title: step.title,
          // A focus step is stored as a timer: `ActivityType` has no `focus`
          // member, and the step type is what the surfaces read anyway.
          type: step.type === 'reminder' ? 'reminder' : 'timer',
          date: firstDateFor(weekday, time, now),
          time,
          repeat,
          durationMinutes: step.durationMinutes,
          categoryId: activityCategoryFor(routine),
          ...(customCategoryFor(routine) !== null
            ? { customCategory: customCategoryFor(routine) ?? undefined }
            : {}),
          notify: 'at-time',
          routineId: routine.id,
          routineStepId: step.id,
          routineStepType: step.type,
        },
      })
    })
  }
  return planned
}

/**
 * The activity category a generated row carries.
 *
 * Routine categories map onto the existing activity categories where an
 * equivalent exists, so generated rows land in the colour ramp the rest of
 * TimePilot uses. The two that name a time of day rather than a subject
 * ("Morning", "Evening") have no equivalent and become the custom category,
 * labelled below. A routine with no category behaves like any uncategorised
 * activity.
 */
function activityCategoryFor(routine: Routine): string {
  const category = routineCategoryOf(routine)
  if (!category) return 'personal'
  return category.activityCategoryId ?? CUSTOM_CATEGORY_ID
}

/** The custom label, when the routine's category has no activity equivalent. */
function customCategoryFor(routine: Routine): string | null {
  const category = routineCategoryOf(routine)
  if (!category || category.activityCategoryId !== null) return null
  return category.name
}

/* --- Reconciliation ------------------------------------------------------- */

/**
 * What generating should do to the stored activity list.
 *
 * A diff rather than a rebuild, so an unchanged routine costs no writes and no
 * alarm churn: a row that already says the right thing is left exactly as it is,
 * fire marks and completion marks included.
 */
export type RoutinePlan = {
  create: PlannedOccurrence[]
  /** Rows to rewrite in place, keeping their id and their history marks. */
  update: { id: string; input: NewScheduledActivity }[]
  /** Ids of generated rows whose routine or step is gone. */
  remove: string[]
  unchanged: boolean
}

/**
 * Diff the rows routines want against the rows storage holds.
 *
 * Only ever considers activities that carry both routine marks. Anything the
 * user created by hand is invisible to this function — that is the whole
 * ownership contract, and it is why regenerating cannot delete unrelated
 * activities.
 *
 * Idempotent: given the state it just produced, it returns `unchanged`.
 */
export function planRoutines(
  routines: readonly Routine[],
  activities: readonly ScheduledActivity[],
  now: number = Date.now(),
): RoutinePlan {
  const desired = new Map<string, PlannedOccurrence>()
  for (const routine of routines) {
    for (const occurrence of planRoutineOccurrences(routine, now)) {
      desired.set(occurrence.key, occurrence)
    }
  }

  const create: PlannedOccurrence[] = []
  const update: { id: string; input: NewScheduledActivity }[] = []
  const remove: string[] = []
  const seen = new Set<string>()

  for (const activity of activities) {
    const key = keyOfActivity(activity)
    if (key === null) continue

    const wanted = desired.get(key)
    if (!wanted || seen.has(key)) {
      // The routine or the step is gone, the recurrence changed shape, or this
      // is a duplicate of a row already matched.
      remove.push(activity.id)
      continue
    }
    seen.add(key)
    if (differs(activity, wanted.input)) {
      update.push({ id: activity.id, input: wanted.input })
    }
  }

  for (const [key, occurrence] of desired) {
    if (!seen.has(key)) create.push(occurrence)
  }

  return {
    create,
    update,
    remove,
    unchanged: create.length === 0 && update.length === 0 && remove.length === 0,
  }
}

/**
 * Whether a stored row still says what the routine wants it to say.
 *
 * `date` is deliberately excluded. For a daily or weekdays row the date is only
 * the first occurrence — the recurrence rule carries the rest — so a stored row
 * whose date is last Tuesday is still correct, and comparing it would rewrite
 * every generated row on every sweep. For a weekly row the date encodes the
 * weekday, and a change of weekday changes the occurrence *key*, so it is caught
 * as a create plus a remove rather than as an update.
 */
function differs(
  activity: ScheduledActivity,
  input: NewScheduledActivity,
): boolean {
  return (
    activity.title !== input.title ||
    activity.type !== input.type ||
    activity.time !== input.time ||
    activity.repeat !== input.repeat ||
    activity.durationMinutes !== input.durationMinutes ||
    activity.categoryId !== input.categoryId ||
    (activity.customCategory ?? null) !== (input.customCategory ?? null) ||
    activity.notify !== input.notify ||
    (activity.routineStepType ?? null) !== (input.routineStepType ?? null)
  )
}

/** Ids of the generated rows belonging to one routine — for deleting it. */
export function activityIdsForRoutine(
  routineId: string,
  activities: readonly ScheduledActivity[],
): string[] {
  return activities
    .filter((activity) => activity.routineId === routineId)
    .map((activity) => activity.id)
}
