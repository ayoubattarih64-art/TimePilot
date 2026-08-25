import { createId } from '../../lib/id'
import {
  normalizeActivity,
  nextOccurrenceOf,
  toInstant,
  type NewScheduledActivity,
  type ScheduledActivity,
  type StoredScheduledActivity,
} from '../../models'
import { readKey, writeKey } from '../../services/storage'

/**
 * Planned activities — the reminders and timers the user creates.
 *
 * Storage is the only state; the worker holds nothing between wake-ups. Ordering
 * is normalised on write so every reader gets the same sequence without sorting.
 *
 * This module owns persistence only. Alarms are the scheduler's business (see
 * ./scheduler), which reconciles after every mutation here — so a write that
 * lands without a matching alarm is still repaired on the next reconcile rather
 * than lost.
 */

/**
 * Every row storage holds that can be made sense of, in schedule order.
 *
 * Normalisation happens here rather than at each call site, so nothing
 * downstream has to know a malformed row could exist: `chrome.storage.local` is
 * writable by anything with the extension's origin, and a row without an id or
 * a resolvable date is dropped rather than passed on.
 */
export async function list(): Promise<ScheduledActivity[]> {
  const stored: unknown = await readKey('scheduled')
  if (!Array.isArray(stored)) return []
  return stored
    .map((row: StoredScheduledActivity) => normalizeActivity(row))
    .filter((activity): activity is ScheduledActivity => activity !== null)
}

export async function get(id: string): Promise<ScheduledActivity | null> {
  const activities = await list()
  return activities.find((activity) => activity.id === id) ?? null
}

export async function create(
  input: NewScheduledActivity,
  now = Date.now(),
): Promise<ScheduledActivity> {
  if (toInstant(input.date, input.time) === null) {
    throw new Error('Activity needs a valid date and time')
  }

  const activity: ScheduledActivity = {
    ...input,
    id: createId(),
    title: input.title.trim() || 'Untitled activity',
    durationMinutes: Math.max(0, Math.round(input.durationMinutes)),
    enabled: input.enabled !== false,
    lastFiredAt: null,
    lastCompletedAt: null,
    createdAt: now,
  }

  const existing = await list()
  await writeKey('scheduled', sortByNext([...existing, activity], now))
  return activity
}

export async function update(
  id: string,
  patch: Partial<NewScheduledActivity>,
  now = Date.now(),
): Promise<ScheduledActivity | null> {
  const existing = await list()
  const index = existing.findIndex((activity) => activity.id === id)
  if (index === -1) return null

  const previous = existing[index]
  const merged: ScheduledActivity = { ...previous, ...patch }
  if (toInstant(merged.date, merged.time) === null) {
    throw new Error('Activity needs a valid date and time')
  }

  // Editing when or how often it fires makes the old fire mark meaningless: the
  // new time must be allowed to fire even if the old one already had.
  if (
    patch.date !== undefined ||
    patch.time !== undefined ||
    patch.repeat !== undefined ||
    patch.notify !== undefined
  ) {
    merged.lastFiredAt = null
  }

  const next = [...existing]
  next[index] = merged
  await writeKey('scheduled', sortByNext(next, now))
  return merged
}

/** Returns false when nothing matched the id. */
export async function remove(id: string): Promise<boolean> {
  const existing = await list()
  const next = existing.filter((activity) => activity.id !== id)
  if (next.length === existing.length) return false
  await writeKey('scheduled', next)
  return true
}

/**
 * Stamp the fire mark for an occurrence. This is the one-shot guard: the same
 * occurrence is never notified twice, and `nextFireOf` searches past it.
 */
export async function markFired(
  id: string,
  occurrenceAt: number,
): Promise<ScheduledActivity | null> {
  return patchRecord(id, (activity) => ({
    ...activity,
    lastFiredAt: occurrenceAt,
  }))
}

/**
 * Record that the user dealt with an occurrence.
 *
 * The smallest honest extension of the current model: one timestamp, no history
 * collection. It is presentational — nothing in scheduling reads it, so marking
 * done cannot disturb a recurring schedule.
 */
export async function markCompleted(
  id: string,
  at = Date.now(),
): Promise<ScheduledActivity | null> {
  return patchRecord(id, (activity) => ({ ...activity, lastCompletedAt: at }))
}

export async function setEnabled(
  id: string,
  enabled: boolean,
): Promise<ScheduledActivity | null> {
  return patchRecord(id, (activity) => ({
    ...activity,
    enabled,
    // Re-enabling starts clean, so an occurrence missed while off can fire.
    lastFiredAt: enabled ? null : activity.lastFiredAt,
  }))
}

/** Read-modify-write one record, leaving order untouched. */
async function patchRecord(
  id: string,
  change: (activity: ScheduledActivity) => ScheduledActivity,
): Promise<ScheduledActivity | null> {
  const existing = await list()
  const index = existing.findIndex((activity) => activity.id === id)
  if (index === -1) return null

  const updated = change(existing[index])
  const next = [...existing]
  next[index] = updated
  await writeKey('scheduled', next)
  return updated
}

/**
 * Soonest-first, with activities that have no upcoming occurrence last. Ties
 * break on creation order so the sequence is stable across writes.
 */
function sortByNext(
  activities: ScheduledActivity[],
  now: number,
): ScheduledActivity[] {
  return [...activities].sort((a, b) => {
    const aNext = nextOccurrenceOf(a, now)
    const bNext = nextOccurrenceOf(b, now)
    if (aNext === null && bNext === null) return a.createdAt - b.createdAt
    if (aNext === null) return 1
    if (bNext === null) return -1
    return aNext - bNext || a.createdAt - b.createdAt
  })
}
