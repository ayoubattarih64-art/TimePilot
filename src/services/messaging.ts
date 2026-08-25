/**
 * Typed message bus between UI surfaces and the service worker.
 *
 * The worker is not a persistent process — it is torn down when idle and
 * restarted on demand — so UI code must never hold state in it. Every exchange
 * is a request/response over chrome.runtime, and the worker reads and writes
 * chrome.storage as its only memory.
 */

import type { BlockingStatus } from '../background/features/blocking'
import type { BlocklistError } from '../background/features/blocklists'
import type { RoutineError } from '../background/features/routines'
import type {
  Blocklist,
  FocusSession,
  NewFocusSession,
  NewRoutine,
  NewScheduledActivity,
  NewTimerSession,
  Routine,
  ScheduledActivity,
  Settings,
  TimerSession,
} from '../models'

/** Requests a UI surface may send to the worker. */
export type Request =
  | { type: 'ping' }
  | { type: 'focus/start'; input: NewFocusSession }
  | { type: 'focus/pause' }
  | { type: 'focus/resume' }
  | { type: 'focus/cancel' }
  | { type: 'focus/current' }
  /** Every stored session, for Insights. Read-only; the worker owns writes. */
  | { type: 'focus/list' }
  /**
   * The standalone timer. Same lifecycle shape as focus, minus everything
   * that makes focus focus — no blocklists, no activity link.
   */
  | { type: 'timer/start'; input: NewTimerSession }
  | { type: 'timer/pause' }
  | { type: 'timer/resume' }
  | { type: 'timer/add'; minutes: number }
  | { type: 'timer/cancel' }
  | { type: 'timer/current' }
  | { type: 'scheduled/list' }
  | { type: 'scheduled/create'; input: NewScheduledActivity }
  | { type: 'scheduled/update'; id: string; patch: Partial<NewScheduledActivity> }
  | { type: 'scheduled/remove'; id: string }
  | { type: 'scheduled/set-enabled'; id: string; enabled: boolean }
  | { type: 'scheduled/complete'; id: string }
  | { type: 'scheduled/snooze'; id: string; minutes: number }
  /** Fire times per activity id — what Chrome actually holds. */
  | { type: 'scheduled/alarms' }
  /**
   * Blocklists are edited as lists of domains; the UI never sees a DNR rule and
   * cannot send one. Every mutation below reconciles blocking afterwards, so an
   * edit during an active session takes effect through the ordinary path.
   */
  | { type: 'blocklist/list' }
  | { type: 'blocklist/create'; name: string }
  | { type: 'blocklist/rename'; id: string; name: string }
  | { type: 'blocklist/set-enabled'; id: string; enabled: boolean }
  /** Switch when a list is enforced: during Focus, or always. */
  | { type: 'blocklist/set-mode'; id: string; mode: 'focus' | 'always' }
  | { type: 'blocklist/add-domain'; id: string; domain: string }
  | { type: 'blocklist/remove-domain'; id: string; domain: string }
  | { type: 'blocklist/remove'; id: string }
  /** What is blocked right now, read back from Chrome. */
  | { type: 'blocking/status' }
  /** The persisted settings, for the surfaces' gates and toggles. */
  | { type: 'settings/get' }
  /**
   * Turn TimePilot's own notifications on or off. The gate is enforced in
   * `services/notifications`, so this is the only thing standing between a
   * reminder and the OS — the worker owns the write, as with every setting.
   */
  | { type: 'settings/set-notifications'; enabled: boolean }
  /**
   * Stamp the welcome tour as finished (or dismissed — same mark). The worker
   * owns the write so the merge with the rest of Settings is atomic.
   */
  | { type: 'settings/complete-onboarding' }
  /**
   * Routines are reusable plans. Every mutation below regenerates the scheduled
   * activities they own and then reconciles alarms, so a routine never schedules
   * anything itself — it changes what the existing scheduler has to work with.
   */
  | { type: 'routine/list' }
  | { type: 'routine/create'; input: NewRoutine }
  | { type: 'routine/update'; id: string; input: NewRoutine }
  | { type: 'routine/set-enabled'; id: string; enabled: boolean }
  | { type: 'routine/remove'; id: string }

export type RequestType = Request['type']

/** Response shape per request type. */
export type ResponseMap = {
  ping: { ok: true; version: string }
  /**
   * `started` is false when a session was already live — the live one comes back
   * so the surface can offer it rather than silently replacing it.
   *
   * `blocking` is present only on a real start, and describes what Chrome
   * actually holds: it carries the reason when a session began without the
   * protection it asked for, so the UI never implies blocking that is not there.
   */
  'focus/start': {
    started: boolean
    session: FocusSession
    blocking?: BlockingStatus
  }
  'focus/pause': { session: FocusSession | null }
  'focus/resume': { session: FocusSession | null }
  'focus/cancel': { session: FocusSession | null }
  /** The live session, plus the one that settled most recently. */
  'focus/current': {
    session: FocusSession | null
    last: FocusSession | null
    /** Read back from Chrome on every poll, never remembered. */
    blocking: BlockingStatus
  }
  /**
   * The full history, normalised on the way out. Insights is the only reader;
   * the Focus surface works off `focus/current` because it cares about the live
   * session, not the archive.
   */
  'focus/list': { sessions: FocusSession[] }
  /**
   * `started` is false when a timer was already live — the live one comes back
   * so the surface can offer it rather than silently replacing it.
   */
  'timer/start': { started: boolean; timer: TimerSession }
  'timer/pause': { timer: TimerSession | null }
  'timer/resume': { timer: TimerSession | null }
  'timer/add': { timer: TimerSession | null }
  'timer/cancel': { timer: TimerSession | null }
  /** The live timer, plus the one that settled most recently. */
  'timer/current': {
    timer: TimerSession | null
    last: TimerSession | null
  }
  'scheduled/list': { activities: ScheduledActivity[] }
  /** `scheduledAt` is null when the activity is owed no notification. */
  'scheduled/create': {
    activity: ScheduledActivity
    scheduledAt: number | null
  }
  'scheduled/update': {
    activity: ScheduledActivity | null
    scheduledAt: number | null
  }
  'scheduled/remove': { removed: boolean }
  'scheduled/set-enabled': {
    activity: ScheduledActivity | null
    scheduledAt: number | null
  }
  'scheduled/complete': { ok: boolean }
  'scheduled/snooze': { ok: boolean }
  'scheduled/alarms': { times: Record<string, number> }
  'blocklist/list': { blocklists: Blocklist[] }
  /**
   * A mutation reports the reason it was refused rather than throwing, so the UI
   * can say "that domain is not valid" instead of showing a generic failure.
   * `blocking` is the state Chrome holds after the edit was reconciled.
   */
  'blocklist/create': BlocklistMutation
  'blocklist/rename': BlocklistMutation
  'blocklist/set-enabled': BlocklistMutation
  'blocklist/set-mode': BlocklistMutation
  'blocklist/add-domain': BlocklistMutation
  'blocklist/remove-domain': BlocklistMutation
  'blocklist/remove': { removed: boolean; blocking: BlockingStatus }
  'blocking/status': { blocking: BlockingStatus }
  'settings/get': { settings: Settings }
  'settings/set-notifications': { settings: Settings }
  'settings/complete-onboarding': { settings: Settings }
  'routine/list': { routines: Routine[] }
  /**
   * `generated` is how many scheduled activities the routine now owns — what
   * makes "4 steps, scheduled" an observation rather than a claim.
   */
  'routine/create': RoutineMutation
  'routine/update': RoutineMutation
  'routine/set-enabled': RoutineMutation
  'routine/remove': { removed: boolean }
}

export type RoutineMutation =
  | { ok: true; routine: Routine; generated: number }
  | { ok: false; reason: RoutineError }

export type BlocklistMutation =
  | { ok: true; list: Blocklist; blocking: BlockingStatus }
  | { ok: false; reason: BlocklistError }

export type Response<T extends RequestType> = ResponseMap[T]

/** What actually travels back: either a payload or a surfaced error. */
export type Envelope<T extends RequestType> =
  | { ok: true; data: Response<T> }
  | { ok: false; error: string }

/**
 * Send a request to the service worker and await its reply.
 *
 * Throws when the worker reports an error or the channel fails, so callers can
 * use ordinary try/catch instead of inspecting a result object.
 */
export async function send<T extends Request>(
  request: T,
): Promise<Response<T['type']>> {
  const envelope = (await chrome.runtime.sendMessage(request)) as
    | Envelope<T['type']>
    | undefined

  if (!envelope) {
    // No listener replied, or the worker died mid-flight.
    throw new Error(`No response for "${request.type}"`)
  }
  if (!envelope.ok) throw new Error(envelope.error)
  return envelope.data
}

/**
 * Register the worker-side handler. Returns synchronously `true` to keep the
 * message channel open for the async reply, which MV3 requires.
 */
export function handleRequests(
  handler: <T extends Request>(request: T) => Promise<Response<T['type']>>,
): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const request = message as Request
    if (typeof request?.type !== 'string') return false

    handler(request).then(
      (data) => sendResponse({ ok: true, data }),
      (error: unknown) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
    )
    return true
  })
}
