import { useCallback, useEffect, useMemo, useState } from 'react'
import { send } from '../services/messaging'
import { onStateChanged } from '../services/storage'
import type { NewScheduledActivity, ScheduledActivity } from '../models'

/**
 * The surfaces' single door to activity data.
 *
 * Every chrome.* call for scheduled activities lives here, so the components
 * below stay presentational and testable. The worker owns the writes and owns
 * scheduling; this hook only sends requests and mirrors the result — no
 * component ever touches chrome.alarms or chrome.notifications.
 */

/** Fire time per activity id, read back from chrome.alarms via the worker. */
export type ScheduledTimes = Record<string, number>

export type ActivitiesState = {
  activities: ScheduledActivity[]
  /** When each activity's next notification will fire. Absent = not scheduled. */
  scheduledTimes: ScheduledTimes
  loading: boolean
  error: string | null
  busy: boolean
  /** Resolves to the fire time when scheduled, null when nothing is owed. */
  create: (input: NewScheduledActivity) => Promise<SaveResult>
  update: (
    id: string,
    patch: Partial<NewScheduledActivity>,
  ) => Promise<SaveResult>
  remove: (id: string) => Promise<boolean>
  setEnabled: (id: string, enabled: boolean) => Promise<SaveResult>
  complete: (id: string) => Promise<boolean>
  snooze: (id: string, minutes: number) => Promise<boolean>
  refresh: () => void
}

export type SaveResult = {
  ok: boolean
  /** The instant the reminder will fire, when the worker scheduled one. */
  scheduledAt: number | null
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** Module scope so it is a stable reference across renders. */
const SAVE_FAILED: SaveResult = { ok: false, scheduledAt: null }

export function useActivities(): ActivitiesState {
  const [activities, setActivities] = useState<ScheduledActivity[]>([])
  const [scheduledTimes, setScheduledTimes] = useState<ScheduledTimes>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => {
    setNonce((value) => value + 1)
  }, [])

  useEffect(() => {
    let active = true
    Promise.all([
      send({ type: 'scheduled/list' }),
      send({ type: 'scheduled/alarms' }),
    ]).then(
      ([listed, alarms]) => {
        if (!active) return
        setActivities(listed.activities)
        setScheduledTimes(alarms.times)
        setError(null)
        setLoading(false)
      },
      (cause: unknown) => {
        if (!active) return
        setError(messageOf(cause))
        setLoading(false)
      },
    )
    return () => {
      active = false
    }
  }, [nonce])

  // A write from another surface (or the worker firing an alarm) must show up
  // here too.
  useEffect(() => {
    return onStateChanged((changes) => {
      if ('scheduled' in changes) refresh()
    })
  }, [refresh])

  const run = useCallback(
    async <T,>(action: () => Promise<T>, fallback: T): Promise<T> => {
      setBusy(true)
      try {
        const result = await action()
        setError(null)
        return result
      } catch (cause: unknown) {
        setError(messageOf(cause))
        return fallback
      } finally {
        setBusy(false)
        // The storage listener also fires, but refreshing here keeps the UI
        // correct even when the write changed nothing observable — and it is
        // what picks up the new alarm times.
        refresh()
      }
    },
    [refresh],
  )

  const create = useCallback(
    (input: NewScheduledActivity) =>
      run(async () => {
        const data = await send({ type: 'scheduled/create', input })
        return { ok: true, scheduledAt: data.scheduledAt }
      }, SAVE_FAILED),
    [run],
  )

  const update = useCallback(
    (id: string, patch: Partial<NewScheduledActivity>) =>
      run(async () => {
        const data = await send({ type: 'scheduled/update', id, patch })
        return { ok: data.activity !== null, scheduledAt: data.scheduledAt }
      }, SAVE_FAILED),
    [run],
  )

  const remove = useCallback(
    (id: string) =>
      run(async () => {
        const data = await send({ type: 'scheduled/remove', id })
        return data.removed
      }, false),
    [run],
  )

  const setEnabled = useCallback(
    (id: string, enabled: boolean) =>
      run(async () => {
        const data = await send({
          type: 'scheduled/set-enabled',
          id,
          enabled,
        })
        return { ok: data.activity !== null, scheduledAt: data.scheduledAt }
      }, SAVE_FAILED),
    [run],
  )

  const complete = useCallback(
    (id: string) =>
      run(async () => {
        const data = await send({ type: 'scheduled/complete', id })
        return data.ok
      }, false),
    [run],
  )

  const snooze = useCallback(
    (id: string, minutes: number) =>
      run(async () => {
        const data = await send({ type: 'scheduled/snooze', id, minutes })
        return data.ok
      }, false),
    [run],
  )

  return useMemo(
    () => ({
      activities,
      scheduledTimes,
      loading,
      error,
      busy,
      create,
      update,
      remove,
      setEnabled,
      complete,
      snooze,
      refresh,
    }),
    [
      activities,
      scheduledTimes,
      loading,
      error,
      busy,
      create,
      update,
      remove,
      setEnabled,
      complete,
      snooze,
      refresh,
    ],
  )
}
