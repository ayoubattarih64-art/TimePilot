/**
 * A one-shot hand-off between surfaces.
 *
 * The popup's quick actions have to open the side panel and tell it what the
 * user asked for, but the panel is not running yet when the click happens and
 * the popup is destroyed immediately after. So the intent is parked in
 * chrome.storage.session — session rather than local because it must not
 * survive a browser restart and reopen an editor days later — and the panel
 * consumes it once on mount.
 *
 * `session` needs no permission beyond the `storage` one already declared.
 */

import type { ActivityType } from '../models'

const KEY = 'pendingIntent'

export type Intent =
  | { kind: 'new-activity'; type: ActivityType }
  /** Open the panel on the Timer surface. */
  | { kind: 'open-timer' }
  /** Open the panel on the Focus surface. */
  | { kind: 'open-focus' }

function isIntent(value: unknown): value is Intent {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Intent>
  if (candidate.kind === 'open-timer' || candidate.kind === 'open-focus') {
    return true
  }
  return (
    candidate.kind === 'new-activity' &&
    (candidate.type === 'reminder' || candidate.type === 'timer')
  )
}

export async function setIntent(intent: Intent): Promise<void> {
  await chrome.storage.session.set({ [KEY]: intent })
}

/** Read and clear the pending intent. Returns null when there is none. */
export async function takeIntent(): Promise<Intent | null> {
  const stored = await chrome.storage.session.get(KEY)
  const value: unknown = stored[KEY]
  if (!isIntent(value)) return null
  await chrome.storage.session.remove(KEY)
  return value
}
