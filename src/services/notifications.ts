import { readKey } from './storage'

/**
 * chrome.notifications wrapper. Every call checks the user's setting first, so
 * callers do not each have to remember to.
 */

const ICON_URL = 'icons/icon-128.png'

/**
 * Notification id namespace for scheduled activities.
 *
 * The id carries the activity id so a button click can be traced back to what
 * raised it — the click arrives in a fresh worker with no memory of the fire.
 * Reusing the same id for the same activity also means Chrome replaces the
 * previous notification instead of stacking a second one.
 */
export const ACTIVITY_NOTIFICATION_PREFIX = 'timepilot:activity:'

export function activityNotificationId(activityId: string): string {
  return `${ACTIVITY_NOTIFICATION_PREFIX}${activityId}`
}

/** The activity a notification belongs to, or null if it is not one of ours. */
export function activityIdFromNotification(
  notificationId: string,
): string | null {
  if (!notificationId.startsWith(ACTIVITY_NOTIFICATION_PREFIX)) return null
  const id = notificationId.slice(ACTIVITY_NOTIFICATION_PREFIX.length)
  return id.length > 0 ? id : null
}

/**
 * Notification id namespace for focus sessions.
 *
 * Carries the session id for the same reason the activity one does: the click
 * arrives in a fresh worker, and the id is the only thing that travels with it.
 * Keyed per session so a completion notification can never be mistaken for a
 * previous session's.
 */
export const FOCUS_NOTIFICATION_PREFIX = 'timepilot:focus:'

export function focusNotificationId(sessionId: string): string {
  return `${FOCUS_NOTIFICATION_PREFIX}${sessionId}`
}

/** The focus session a notification belongs to, or null if it is not one. */
export function focusSessionIdFromNotification(
  notificationId: string,
): string | null {
  if (!notificationId.startsWith(FOCUS_NOTIFICATION_PREFIX)) return null
  const id = notificationId.slice(FOCUS_NOTIFICATION_PREFIX.length)
  return id.length > 0 ? id : null
}

/**
 * Notification id namespace for timers.
 *
 * Same contract as the focus one: the id carries the timer id so a button
 * click in a freshly woken worker can be traced back, and re-raising replaces
 * rather than stacks.
 */
export const TIMER_NOTIFICATION_PREFIX = 'timepilot:timer:'

export function timerNotificationId(timerId: string): string {
  return `${TIMER_NOTIFICATION_PREFIX}${timerId}`
}

/** The timer a notification belongs to, or null if it is not one. */
export function timerIdFromNotification(
  notificationId: string,
): string | null {
  if (!notificationId.startsWith(TIMER_NOTIFICATION_PREFIX)) return null
  const id = notificationId.slice(TIMER_NOTIFICATION_PREFIX.length)
  return id.length > 0 ? id : null
}

export type NotifyButton = { title: string }

export type NotifyOptions = {
  id?: string
  title: string
  message: string
  /** Keeps the notification on screen until dismissed. */
  requireInteraction?: boolean
  /** Chrome renders at most two; a third is silently dropped by the platform. */
  buttons?: NotifyButton[]
}

export async function notify(options: NotifyOptions): Promise<string | null> {
  const settings = await readKey('settings')
  if (!settings.notificationsEnabled) return null

  return new Promise((resolve) => {
    try {
      chrome.notifications.create(
        options.id ?? '',
        {
          type: 'basic',
          iconUrl: chrome.runtime.getURL(ICON_URL),
          title: options.title,
          message: options.message,
          requireInteraction: options.requireInteraction ?? false,
          silent: false,
          ...(options.buttons ? { buttons: options.buttons } : {}),
        },
        (id) => {
          // Creation can fail (e.g. OS-level blocks); surface it as null.
          if (chrome.runtime.lastError) {
            console.warn(
              '[timepilot] notification failed',
              chrome.runtime.lastError.message,
            )
            resolve(null)
            return
          }
          resolve(id)
        },
      )
    } catch (error: unknown) {
      // A synchronous throw (bad options, unavailable API) must not take the
      // worker down with it — a missed notification is recoverable.
      console.warn('[timepilot] notification threw', error)
      resolve(null)
    }
  })
}

export async function dismiss(id: string): Promise<void> {
  try {
    await chrome.notifications.clear(id)
  } catch (error: unknown) {
    console.warn('[timepilot] could not clear notification', error)
  }
}

/**
 * Register notification listeners. Called synchronously at worker start-up: a
 * button click is one of the events that can wake the worker, so the listener
 * has to exist before any await.
 */
export function onNotificationAction(handlers: {
  onClick?: (notificationId: string) => void | Promise<void>
  onButton?: (notificationId: string, buttonIndex: number) => void | Promise<void>
  onClosed?: (notificationId: string, byUser: boolean) => void | Promise<void>
}): void {
  const guard = (label: string, result: void | Promise<void>) => {
    void Promise.resolve(result).catch((error: unknown) => {
      console.error(`[timepilot] notification ${label} handler failed`, error)
    })
  }

  if (handlers.onClick) {
    const onClick = handlers.onClick
    chrome.notifications.onClicked.addListener((id) => {
      guard('click', onClick(id))
    })
  }
  if (handlers.onButton) {
    const onButton = handlers.onButton
    chrome.notifications.onButtonClicked.addListener((id, index) => {
      guard('button', onButton(id, index))
    })
  }
  if (handlers.onClosed) {
    const onClosed = handlers.onClosed
    chrome.notifications.onClosed.addListener((id, byUser) => {
      guard('close', onClosed(id, byUser))
    })
  }
}
