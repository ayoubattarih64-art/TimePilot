import type {
  BlocklistMutation,
  Request,
  Response,
  RoutineMutation,
} from '../services/messaging'
import { nextFireOf, type ScheduledActivity, type Settings } from '../models'
import { readKey, writeKey } from '../services/storage'
import * as blocking from './features/blocking'
import * as blocklists from './features/blocklists'
import * as focusSessions from './features/focusSessions'
import * as routines from './features/routines'
import * as scheduled from './features/scheduledActivities'
import * as scheduler from './features/scheduler'
import * as timers from './features/timers'

/**
 * Request router. Kept apart from the worker entry point so it can be reasoned
 * about (and later tested) without the top-level listener registration.
 *
 * Every mutation of a scheduled activity is followed by a reconcile, so alarms
 * and storage can never drift apart on the happy path — and the reconcile is
 * derived from storage, so it is also correct if the write and the alarm update
 * were split by an eviction.
 *
 * Blocklist mutations follow the same rule against a different actual state:
 * each one ends in `blocking.reconcile()`, which is why adding a domain to the
 * list a running session is enforcing starts blocking it immediately, with no
 * mechanism of its own and no restart.
 *
 * Routine mutations are the same rule again, one step longer: `generate()` turns
 * the routines into scheduled activities and `scheduler.reconcile()` then derives
 * the alarms from those rows. A routine therefore never schedules anything — it
 * changes what the existing scheduler has to work with.
 */

/** When the activity's next notification is due, for the UI's success state. */
function fireTimeOf(activity: ScheduledActivity | null): number | null {
  if (!activity) return null
  return nextFireOf(activity)?.at ?? null
}

/** Settings with defaults merged in, so a row written before a field existed reads sanely. */
async function readSettings(): Promise<Settings> {
  const stored = (await readKey('settings')) as Partial<Settings>
  return {
    notificationsEnabled: stored.notificationsEnabled !== false,
    onboardingCompletedAt:
      typeof stored.onboardingCompletedAt === 'number'
        ? stored.onboardingCompletedAt
        : null,
  }
}

/**
 * Apply a blocklist edit, then bring Chrome in line with it.
 *
 * The reconcile runs on failure too: a refused edit means storage is unchanged,
 * but the rules may still be stale from something else, and reporting blocking
 * state that was read after the attempt is what keeps the UI honest.
 */
async function withReconcile(
  result: blocklists.BlocklistResult,
): Promise<BlocklistMutation> {
  const status = await blocking.reconcile()
  if (!result.ok) return { ok: false, reason: result.reason }
  return { ok: true, list: result.list, blocking: status }
}

/**
 * Apply a routine edit, then regenerate the activities it owns and reconcile the
 * alarms derived from them.
 *
 * Runs on failure too, for the same reason as `withReconcile`: a refused edit
 * left storage alone, but the generated rows may still be stale from an eviction
 * that split an earlier write from its regeneration, and this is a cheap
 * idempotent pass.
 *
 * `generated` is counted after generating, so the number the UI shows is what
 * storage actually holds rather than what the routine asked for.
 */
async function withGenerate(
  result: routines.RoutineResult,
): Promise<RoutineMutation> {
  await routines.generate()
  await scheduler.reconcile()
  if (!result.ok) return { ok: false, reason: result.reason }
  return {
    ok: true,
    routine: result.routine,
    generated: await routines.countGenerated(result.routine.id),
  }
}

export async function route<T extends Request>(
  request: T,
): Promise<Response<T['type']>> {
  // Each branch narrows `request`, but the return type is keyed off the generic,
  // so casts are needed to connect the two. The ResponseMap keeps them honest.
  switch (request.type) {
    case 'ping':
      return {
        ok: true,
        version: chrome.runtime.getManifest().version,
      } as Response<T['type']>

    case 'focus/start': {
      const result = await focusSessions.start(request.input)
      return {
        started: result.ok,
        session: result.session,
        // Only on a real start. A refusal changed nothing, so there is no new
        // blocking state to report.
        ...(result.ok ? { blocking: result.blocking } : {}),
      } as Response<T['type']>
    }

    case 'focus/pause':
      return { session: await focusSessions.pause() } as Response<T['type']>

    case 'focus/resume':
      return { session: await focusSessions.resume() } as Response<T['type']>

    case 'focus/cancel':
      return { session: await focusSessions.cancel() } as Response<T['type']>

    case 'focus/current': {
      // Reconcile on read: opening the Focus page is the moment a session whose
      // end passed while the browser was closed gets noticed and completed.
      await focusSessions.reconcile()
      const snapshot = await focusSessions.snapshot()
      // After the focus reconcile, so a session it just completed is reported
      // with its websites already released.
      const status = await blocking.reconcile()
      return {
        session: snapshot.current,
        last: snapshot.last,
        blocking: status,
      } as Response<T['type']>
    }

    case 'focus/list':
      return { sessions: await focusSessions.list() } as Response<T['type']>

    case 'timer/start': {
      const result = await timers.start(request.input)
      return {
        started: result.ok,
        timer: result.timer,
      } as Response<T['type']>
    }

    case 'timer/pause':
      return { timer: await timers.pause() } as Response<T['type']>

    case 'timer/resume':
      return { timer: await timers.resume() } as Response<T['type']>

    case 'timer/add':
      return { timer: await timers.add(request.minutes) } as Response<T['type']>

    case 'timer/cancel':
      return { timer: await timers.cancel() } as Response<T['type']>

    case 'timer/current': {
      // Reconcile on read: opening the Timer surface is the moment a timer
      // whose end passed while the browser was closed gets noticed and
      // completed, before the surface renders a countdown that is already
      // over.
      await timers.reconcile()
      const state = await timers.snapshot()
      return {
        timer: state.current,
        last: state.last,
      } as Response<T['type']>
    }

    case 'scheduled/list':
      return { activities: await scheduled.list() } as Response<T['type']>

    case 'scheduled/create': {
      const activity = await scheduled.create(request.input)
      await scheduler.reconcile()
      return {
        activity,
        scheduledAt: fireTimeOf(activity),
      } as Response<T['type']>
    }

    case 'scheduled/update': {
      const activity = await scheduled.update(request.id, request.patch)
      // Reconcile even when nothing matched: the id may name an activity that
      // was deleted elsewhere, leaving an alarm to clean up.
      await scheduler.reconcile()
      return {
        activity,
        scheduledAt: fireTimeOf(activity),
      } as Response<T['type']>
    }

    case 'scheduled/remove': {
      const removed = await scheduled.remove(request.id)
      await scheduler.teardown(request.id)
      return { removed } as Response<T['type']>
    }

    case 'scheduled/set-enabled': {
      const activity = await scheduler.setEnabled(request.id, request.enabled)
      return {
        activity,
        scheduledAt: fireTimeOf(activity),
      } as Response<T['type']>
    }

    case 'scheduled/complete': {
      const activity = await scheduled.get(request.id)
      if (activity) await scheduler.complete(request.id)
      return { ok: activity !== null } as Response<T['type']>
    }

    case 'scheduled/snooze':
      return {
        ok: await scheduler.snooze(request.id, request.minutes),
      } as Response<T['type']>

    case 'scheduled/alarms':
      return {
        times: await scheduler.scheduledTimes(),
      } as Response<T['type']>

    case 'blocklist/list':
      return { blocklists: await blocklists.list() } as Response<T['type']>

    case 'blocklist/create':
      return (await withReconcile(
        await blocklists.create({ name: request.name }),
      )) as Response<T['type']>

    case 'blocklist/rename':
      return (await withReconcile(
        await blocklists.rename(request.id, request.name),
      )) as Response<T['type']>

    case 'blocklist/set-enabled':
      return (await withReconcile(
        await blocklists.setEnabled(request.id, request.enabled),
      )) as Response<T['type']>

    case 'blocklist/set-mode':
      return (await withReconcile(
        await blocklists.setMode(request.id, request.mode),
      )) as Response<T['type']>

    case 'blocklist/add-domain':
      return (await withReconcile(
        await blocklists.addDomain(request.id, request.domain),
      )) as Response<T['type']>

    case 'blocklist/remove-domain':
      return (await withReconcile(
        await blocklists.removeDomain(request.id, request.domain),
      )) as Response<T['type']>

    case 'blocklist/remove': {
      const removed = await blocklists.remove(request.id)
      // Deleting the list a running session named leaves it with nothing to
      // enforce; the reconcile is what actually releases those websites.
      const status = await blocking.reconcile()
      return { removed, blocking: status } as Response<T['type']>
    }

    case 'blocking/status':
      return { blocking: await blocking.status() } as Response<T['type']>

    case 'settings/get':
      return { settings: await readSettings() } as Response<T['type']>

    case 'settings/set-notifications': {
      // Read-modify-write through `readSettings` so the rest of the row is
      // carried forward rather than replaced by a partial write.
      const settings = await readSettings()
      const next: Settings = {
        ...settings,
        notificationsEnabled: request.enabled,
      }
      await writeKey('settings', next)
      return { settings: next } as Response<T['type']>
    }

    case 'settings/complete-onboarding': {
      const settings = await readSettings()
      const next: Settings = { ...settings, onboardingCompletedAt: Date.now() }
      await writeKey('settings', next)
      return { settings: next } as Response<T['type']>
    }

    case 'routine/list':
      return { routines: await routines.list() } as Response<T['type']>

    case 'routine/create':
      return (await withGenerate(
        await routines.create(request.input),
      )) as Response<T['type']>

    case 'routine/update':
      return (await withGenerate(
        await routines.update(request.id, request.input),
      )) as Response<T['type']>

    case 'routine/set-enabled':
      return (await withGenerate(
        await routines.setEnabled(request.id, request.enabled),
      )) as Response<T['type']>

    case 'routine/remove': {
      // Detach first: once the routine is gone, `generate()` can no longer tell
      // which rows belonged to it, so this is the only moment its plans can be
      // cleaned up — and `detachActivities` keeps the ones that carry history.
      await routines.detachActivities(request.id)
      const removed = await routines.remove(request.id)
      await routines.generate()
      await scheduler.reconcile()
      return { removed } as Response<T['type']>
    }

    default: {
      // Exhaustiveness guard: adding a Request variant without a case fails here.
      const exhaustive: never = request
      throw new Error(
        `Unhandled request: ${JSON.stringify(exhaustive satisfies never)}`,
      )
    }
  }
}
