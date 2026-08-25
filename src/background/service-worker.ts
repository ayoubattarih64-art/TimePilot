/**
 * Service worker entry point.
 *
 * MV3 workers are event-driven and short-lived: Chrome tears this down when idle
 * and re-runs the whole file on the next event. Two consequences shape the code
 * below — every listener must be registered synchronously at top level (a
 * listener added inside an async callback can miss the event that woke the
 * worker), and no state may be held in module scope. Persistence is
 * chrome.storage; scheduling is chrome.alarms.
 */

import {
  Alarms,
  clear as clearAlarm,
  LEGACY_TICK_ALARM,
  onAlarm,
  schedulePeriodic,
} from '../services/alarms'
import { createSerialQueue } from '../lib/serial'
import { handleRequests } from '../services/messaging'
import {
  activityIdFromNotification,
  dismiss,
  focusSessionIdFromNotification,
  onNotificationAction,
  timerIdFromNotification,
} from '../services/notifications'
import { initializeStorage } from '../services/storage'
import { setOpenOnActionClick } from '../services/sidePanel'
import * as blocking from './features/blocking'
import * as blocklists from './features/blocklists'
import * as focusSessions from './features/focusSessions'
import * as routines from './features/routines'
import * as scheduler from './features/scheduler'
import * as timers from './features/timers'
import { route } from './router'

const ROUTINE_SCAN_MINUTES = 30
/**
 * Reconciliation sweep. The safety net for everything the event listeners cannot
 * observe: a time-zone change, a DST transition, a suspend/resume that moved the
 * wall clock, or an alarm write lost to an eviction. Hourly is frequent enough
 * that a wall-clock shift is corrected long before the next daily occurrence,
 * and cheap — it is two reads and, normally, no writes.
 */
const SWEEP_MINUTES = 60

/**
 * Notification button indices and the snooze the button applies. Both come from
 * the scheduler so the labels Chrome renders and the actions taken here cannot
 * drift apart.
 */
const { done: BUTTON_DONE, snooze: BUTTON_SNOOZE } = scheduler.NotificationButton

/**
 * The one thing this file keeps between events, and deliberately not state: a
 * position in a queue.
 *
 * Every mutation below is `read a storage key -> modify -> write it back`, which
 * is only safe while no two of them overlap. Chrome makes no such promise — two
 * alarms due in the same minute, a notification button pressed during a sweep,
 * or two open surfaces sending at once all arrive as independent callbacks, and
 * the second read then modifies an array the first has not written yet, so the
 * second write erases the first's change. Funnelling every entry point through
 * one queue removes the overlap; the worker is single-threaded, so that is all
 * mutual exclusion requires here.
 *
 * An eviction discards the queue along with everything else, dropping work that
 * had not started yet — the same failure the reconcilers already repair.
 */
const serialize = createSerialQueue()

// --- Listeners: registered synchronously, before any await. ---

handleRequests((request) => serialize(() => route(request)))

onAlarm(
  {
    [Alarms.routineScan]: () =>
      serialize(async () => {
        // Routines own no alarms of their own: this regenerates the scheduled
        // activities they describe and then lets the ordinary scheduler derive the
        // alarms from those rows. Cheap when nothing has moved — `generate()`
        // writes nothing when the plan already matches storage — and it is what
        // keeps a weekly row's first date rolling forward as the weeks pass.
        await routines.generate()
        await scheduler.reconcile()
      }),
    [Alarms.scheduleSweep]: () =>
      serialize(async () => {
        // Before the scheduler reconcile, so a routine row this sweep creates gets
        // its alarm in the same pass rather than half an hour later.
        await routines.generate()
        await scheduler.reconcile()
        // Same sweep, same reason: a focus session whose end passed while the
        // browser was closed is completed here rather than lost.
        await focusSessions.reconcile()
        // And the standalone timer with the same rule again.
        await timers.reconcile()
        // And after it, because completing a session changes what should be
        // blocked. Dynamic rules outlive the worker, so this is the sweep that
        // guarantees an eviction cannot leave websites blocked indefinitely.
        await blocking.reconcile()
      }),
  },
  // Activity, snooze, focus and timer alarms carry an id in their name, so
  // they are routed here rather than by a fixed key. Two due in the same minute
  // arrive as two concurrent callbacks, which is exactly what the queue is for.
  (parsed) =>
    serialize(async () => {
      if (parsed.kind === 'activity') {
        await scheduler.fireActivity(parsed.activityId)
        return
      }
      if (parsed.kind === 'snooze') {
        await scheduler.fireSnooze(parsed.activityId)
        return
      }
      if (parsed.kind === 'focus') {
        await focusSessions.fireFocus(parsed.sessionId)
        return
      }
      if (parsed.kind === 'timer') {
        await timers.fireTimer(parsed.timerId)
      }
    }),
)

onNotificationAction({
  onButton: (notificationId, buttonIndex) =>
    serialize(async () => {
      const timerId = timerIdFromNotification(notificationId)
      if (timerId !== null) {
        // The completion notification has one button, and it only acknowledges:
        // the timer was already marked completed when it was raised.
        await timers.acknowledge(timerId)
        return
      }

      const focusId = focusSessionIdFromNotification(notificationId)
      if (focusId !== null) {
        // The completion notification has one button, and it only acknowledges:
        // the session was already marked completed when it was raised.
        await focusSessions.acknowledge(focusId)
        return
      }

      const activityId = activityIdFromNotification(notificationId)
      if (activityId === null) return

      if (buttonIndex === BUTTON_DONE) {
        await scheduler.complete(activityId)
        return
      }
      if (buttonIndex === BUTTON_SNOOZE) {
        await scheduler.snooze(activityId, scheduler.BUTTON_SNOOZE_MINUTES)
      }
    }),
  onClick: (notificationId) =>
    serialize(async () => {
      const timerId = timerIdFromNotification(notificationId)
      if (timerId !== null) {
        await timers.acknowledge(timerId)
        return
      }

      const focusId = focusSessionIdFromNotification(notificationId)
      if (focusId !== null) {
        await focusSessions.acknowledge(focusId)
        return
      }

      const activityId = activityIdFromNotification(notificationId)
      if (activityId === null) return
      // Clicking the body is an acknowledgement, not a completion: close it and
      // leave the schedule and the completion mark alone.
      await dismiss(notificationId)
    }),
})

chrome.runtime.onInstalled.addListener((details) => {
  void serialize(async () => {
    await initializeStorage()
    // An update from a build that registered the one-minute tick leaves it in
    // Chrome's alarm store, waking the worker every minute for a handler that no
    // longer exists. Clearing it is the whole migration.
    await clearAlarm(LEGACY_TICK_ALARM)
    await schedulePeriodic(Alarms.routineScan, ROUTINE_SCAN_MINUTES)
    await schedulePeriodic(Alarms.scheduleSweep, SWEEP_MINUTES)
    // The popup owns the toolbar click; the side panel is opened explicitly.
    await setOpenOnActionClick(false)
    // An update can arrive with activities already stored and their alarms
    // cleared, so reconcile here too rather than only on start-up.
    // Routines first: an update that changed how a routine expands should leave
    // storage holding the new rows before alarms are derived from them.
    await routines.generate()
    await scheduler.reconcile()
    await focusSessions.reconcile()
    await timers.reconcile()
    // Starter lists, on a genuinely empty store only.
    await blocklists.seedDefaults()
    // An extension update keeps dynamic rules but not necessarily the ids this
    // version allocates, so reconcile before anything can read stale state.
    await blocking.reconcile()

    if (details.reason === 'install') {
      console.info('[timepilot] installed')
    }
  }).catch((error: unknown) => {
    console.error('[timepilot] install failed', error)
  })
})

chrome.runtime.onStartup.addListener(() => {
  // Alarms survive browser restarts, but re-asserting them is cheap and makes
  // recovery from a cleared alarm store automatic. The reconcile is the one that
  // matters: it rebuilds every activity alarm from storage alone, so a restart
  // that lost them (or a clock that moved while the browser was closed) is
  // repaired before the user notices.
  void serialize(async () => {
    await clearAlarm(LEGACY_TICK_ALARM)
    await schedulePeriodic(Alarms.routineScan, ROUTINE_SCAN_MINUTES)
    await schedulePeriodic(Alarms.scheduleSweep, SWEEP_MINUTES)
    // Routines are regenerated before the reconcile for the same reason as on
    // install: a routine whose generated rows were lost is repaired here, and the
    // reconcile that follows gives them their alarms.
    await routines.generate()
    await scheduler.reconcile()
    // A focus session that ran past its end while the browser was closed is
    // completed here, at the first opportunity anything is listening.
    await focusSessions.reconcile()
    // The timer with the same rule: closed-over ends are completed, not lost.
    await timers.reconcile()
    // Dynamic rules survived the restart whether or not the session did. This is
    // what restores blocking for a session still running, and what releases the
    // websites of one that is not.
    await blocking.reconcile()
  }).catch((error: unknown) => {
    console.error('[timepilot] startup failed', error)
  })
})
