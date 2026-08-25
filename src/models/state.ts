import type { Timestamp } from './activity'
import type { Blocklist } from './blocklist'
import type { FocusSession } from './focus'
import type { Routine } from './routine'
import type { ScheduledActivity } from './scheduled'
import type { TimerSession } from './timer'

export type Settings = {
  /** Whether TimePilot may raise notifications (routine start, focus end). */
  notificationsEnabled: boolean
  /**
   * When the welcome tour was last finished or dismissed. Null until then —
   * the one thing that keeps a tour from ever ambushing someone twice — and
   * re-settable from Settings, because "show me again" is a legitimate ask.
   */
  onboardingCompletedAt: Timestamp | null
}

/**
 * The full persisted shape, versioned so migrations have something to branch
 * on. Everything lives under one top-level key per collection in
 * chrome.storage.local; see `services/storage.ts`.
 *
 * The theme is deliberately absent: it must be readable synchronously by a page
 * before its first paint, which `chrome.storage` cannot do, so it lives in
 * `localStorage` under the extension's own origin (see `theme/ThemeProvider`).
 * Keeping a second copy here would only be a source of truth to disagree with.
 */
export type PersistedState = {
  schemaVersion: number
  /** Planned activities (reminders, timers) — what the user scheduled. */
  scheduled: ScheduledActivity[]
  /** Reusable daily plans. They generate `scheduled` rows; they own no alarms. */
  routines: Routine[]
  focusSessions: FocusSession[]
  /** Standalone countdowns. Timer steps inside routines stay scheduled rows. */
  timers: TimerSession[]
  /** Named domain sets a focus session may enforce. Rules are derived, not stored. */
  blocklists: Blocklist[]
  settings: Settings
}

export const SCHEMA_VERSION = 1

export const DEFAULT_SETTINGS: Settings = {
  notificationsEnabled: true,
  onboardingCompletedAt: null,
}

export function emptyState(): PersistedState {
  return {
    schemaVersion: SCHEMA_VERSION,
    scheduled: [],
    routines: [],
    focusSessions: [],
    timers: [],
    blocklists: [],
    settings: { ...DEFAULT_SETTINGS },
  }
}
