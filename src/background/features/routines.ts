import { createId } from '../../lib/id'
import {
  activityIdsForRoutine,
  planRoutines,
  type RoutinePlan,
} from '../../lib/routinePlan'
import {
  buildStep,
  createRoutine,
  MAX_ROUTINE_DESCRIPTION,
  MAX_ROUTINE_STEPS,
  MAX_ROUTINES,
  normalizeDays,
  normalizeRoutine,
  normalizeStartTime,
  routineName,
  type NewRoutine,
  type Routine,
} from '../../models'
import { readKey, writeKey } from '../../services/storage'
import * as scheduled from './scheduledActivities'
import * as scheduler from './scheduler'

/**
 * Routines: persistence, plus the generation step that turns them into ordinary
 * scheduled activities.
 *
 * What this module deliberately is *not* is a scheduler. It writes no alarms and
 * raises no notifications; it produces `ScheduledActivity` rows and then calls
 * the scheduler that already exists. The chain is
 *
 *     Routine → lib/routinePlan → ScheduledActivity → scheduler.reconcile → alarm
 *
 * and every recovery path — install, start-up, the hourly sweep, the routine
 * scan — runs `generate()` followed by `scheduler.reconcile()`, so a routine
 * whose rows were lost is repaired by the same idempotent pass that repairs a
 * missing alarm.
 *
 * Written for a worker that may be killed between any two lines: no module-scope
 * state, storage re-read at every entry point, and `generate()` safe to call at
 * any time and cheap when there is nothing to do.
 */

async function read(): Promise<Routine[]> {
  const stored: unknown = await readKey('routines')
  if (!Array.isArray(stored)) return []
  return stored
    .map((row) => normalizeRoutine(row))
    .filter((routine): routine is Routine => routine !== null)
}

async function write(routines: readonly Routine[]): Promise<void> {
  await writeKey('routines', [...routines])
}

export async function list(): Promise<Routine[]> {
  return read()
}

export async function get(id: string): Promise<Routine | null> {
  const routines = await read()
  return routines.find((routine) => routine.id === id) ?? null
}

export type RoutineError = 'not-found' | 'limit'

export type RoutineResult =
  | { ok: true; routine: Routine }
  | { ok: false; reason: RoutineError }

export async function create(
  input: NewRoutine,
  now = Date.now(),
): Promise<RoutineResult> {
  const existing = await read()
  if (existing.length >= MAX_ROUTINES) return { ok: false, reason: 'limit' }

  const routine = createRoutine(createId(), input, createId, now)
  await write([...existing, routine])
  return { ok: true, routine }
}

/**
 * Replace a routine's definition.
 *
 * Every field is re-normalised through the same helpers `create` uses, so an
 * edit cannot produce a shape a fresh routine could not. Steps keep their ids
 * when the editor sent them back, which is what makes an edit that only renames
 * a step an update of its generated row rather than a delete and a re-create.
 */
export async function update(
  id: string,
  patch: NewRoutine,
  now = Date.now(),
): Promise<RoutineResult> {
  const routines = await read()
  const index = routines.findIndex((routine) => routine.id === id)
  if (index === -1) return { ok: false, reason: 'not-found' }

  const previous = routines[index]
  const updated: Routine = {
    ...previous,
    name: routineName(patch.name),
    description: (patch.description ?? '').trim().slice(0, MAX_ROUTINE_DESCRIPTION),
    categoryId:
      typeof patch.categoryId === 'string' && patch.categoryId.length > 0
        ? patch.categoryId
        : null,
    daysOfWeek: normalizeDays(patch.daysOfWeek ?? []),
    startTime: normalizeStartTime(patch.startTime),
    steps: (patch.steps ?? [])
      .slice(0, MAX_ROUTINE_STEPS)
      .map((step) => buildStep(step, createId)),
    enabled: patch.enabled ?? previous.enabled,
    updatedAt: now,
  }

  const next = [...routines]
  next[index] = updated
  await write(next)
  return { ok: true, routine: updated }
}

export async function setEnabled(
  id: string,
  enabled: boolean,
  now = Date.now(),
): Promise<RoutineResult> {
  const routines = await read()
  const index = routines.findIndex((routine) => routine.id === id)
  if (index === -1) return { ok: false, reason: 'not-found' }

  const updated: Routine = { ...routines[index], enabled, updatedAt: now }
  const next = [...routines]
  next[index] = updated
  await write(next)
  return { ok: true, routine: updated }
}

/** Returns false when nothing matched the id. */
export async function remove(id: string): Promise<boolean> {
  const routines = await read()
  const next = routines.filter((routine) => routine.id !== id)
  if (next.length === routines.length) return false
  await write(next)
  return true
}

/* --- Generation ----------------------------------------------------------- */

export type GenerateResult = {
  created: number
  updated: number
  removed: number
  /** Rows kept because they carry history; see `retire`. */
  retired: number
}

/**
 * Bring the generated activities in line with the stored routines.
 *
 * The recovery path for routines, and the only thing that writes them: called
 * after every routine mutation, on install, on start-up, on the hourly sweep and
 * on the routine scan. It reads both sides fresh and repairs the difference, so
 * it is idempotent and costs no writes when nothing has moved.
 *
 * The caller reconciles alarms afterwards. That order matters: the rows have to
 * exist before the scheduler can derive an alarm from them.
 */
export async function generate(now = Date.now()): Promise<GenerateResult> {
  const result: GenerateResult = { created: 0, updated: 0, removed: 0, retired: 0 }

  const routines = await read()
  const activities = await scheduled.list()
  const plan: RoutinePlan = planRoutines(routines, activities, now)
  if (plan.unchanged) return result

  // Removals first: a step that was retimed reaches here as one row to drop and
  // one to create, and doing it in this order keeps the list from briefly
  // holding both.
  for (const id of plan.remove) {
    const outcome = await retire(id, now)
    if (outcome === 'removed') result.removed += 1
    if (outcome === 'retired') result.retired += 1
  }

  for (const { id, input } of plan.update) {
    const updated = await scheduled.update(id, input, now)
    if (updated) result.updated += 1
  }

  for (const occurrence of plan.create) {
    await scheduled.create(occurrence.input, now)
    result.created += 1
  }

  return result
}

/**
 * Deal with a generated row the routines no longer want.
 *
 * A row that has never fired and was never completed is nothing but a plan, so
 * it is deleted outright. A row that *has* a history — it fired, or the user
 * marked it done — is retired instead: its routine marks are cleared and it is
 * disabled, so it stops generating anything and stops firing, but the record of
 * what happened survives. Deleting it would erase history to tidy up a template,
 * which is the one thing the spec is explicit about not doing.
 *
 * Retiring also takes it out of the planner's view — `keyOfActivity` needs both
 * marks — so it is never re-adopted by a routine that comes back later.
 */
async function retire(
  id: string,
  now: number,
): Promise<'removed' | 'retired' | 'missing'> {
  const activity = await scheduled.get(id)
  if (!activity) return 'missing'

  const fired = activity.lastFiredAt ?? null
  const completed = activity.lastCompletedAt ?? null
  if (fired === null && completed === null) {
    await scheduled.remove(id)
    await scheduler.teardown(id)
    return 'removed'
  }

  await scheduled.update(
    id,
    { routineId: null, routineStepId: null, routineStepType: null, enabled: false },
    now,
  )
  // Disabled means it must not fire, so its alarm and any notification go now
  // rather than waiting for the reconcile the caller runs afterwards.
  await scheduler.teardown(id)
  return 'retired'
}

/**
 * Retire or delete every generated row of one routine. Called when the routine
 * itself is deleted, before `generate()` would no longer be able to find them.
 *
 * Uses the same `retire` rule, so a routine deleted after a week of use leaves
 * its completed occurrences behind and takes only the un-fired plans with it.
 */
export async function detachActivities(
  routineId: string,
  now = Date.now(),
): Promise<{ removed: number; retired: number }> {
  const activities = await scheduled.list()
  const ids = activityIdsForRoutine(routineId, activities)

  let removed = 0
  let retired = 0
  for (const id of ids) {
    const outcome = await retire(id, now)
    if (outcome === 'removed') removed += 1
    if (outcome === 'retired') retired += 1
  }
  return { removed, retired }
}

/** How many scheduled activities a routine currently owns. */
export async function countGenerated(routineId: string): Promise<number> {
  const activities = await scheduled.list()
  return activityIdsForRoutine(routineId, activities).length
}
