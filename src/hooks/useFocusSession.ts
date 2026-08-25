import { useCallback, useEffect, useMemo, useState } from 'react'
import { send } from '../services/messaging'
import { onStateChanged } from '../services/storage'
import type { BlockingStatus } from '../background/features/blocking'
import type { FocusSession, NewFocusSession } from '../models'

/**
 * The surfaces' single door to focus session state.
 *
 * Every chrome.* call for focus lives here, so the pages below stay
 * presentational. The worker owns the writes, the alarm, and the notification;
 * this hook sends requests and mirrors the result. It deliberately does not hold
 * a countdown — components derive remaining time from the session's `endsAt` and
 * a clock, so a closed panel or an evicted worker cannot desynchronise it.
 *
 * `blocking` comes back from the worker on every poll and is never cached across
 * one: it is what Chrome's network layer actually holds, so the UI can only ever
 * show protection that exists.
 */

export type FocusState = {
  /** The live session — running or paused — or null. */
  session: FocusSession | null
  /** The most recently settled session, for the completed/cancelled states. */
  last: FocusSession | null
  /** What is blocked right now. Null until the first reply arrives. */
  blocking: BlockingStatus | null
  loading: boolean
  error: string | null
  busy: boolean
  /**
   * Start a session. `started: false` means one was already running and the
   * returned session is that one — the caller offers it rather than replacing it.
   */
  start: (input: NewFocusSession) => Promise<StartOutcome>
  pause: () => Promise<boolean>
  resume: () => Promise<boolean>
  cancel: () => Promise<boolean>
  refresh: () => void
}

export type StartOutcome = {
  ok: boolean
  /** False when a session was already live. */
  started: boolean
  session: FocusSession | null
  /**
   * Present when a session actually started. Its `error` is how the caller learns
   * that blocking was asked for but could not be applied.
   */
  blocking: BlockingStatus | null
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** Module scope so it is a stable reference across renders. */
const START_FAILED: StartOutcome = {
  ok: false,
  started: false,
  session: null,
  blocking: null,
}

export function useFocusSession(): FocusState {
  const [session, setSession] = useState<FocusSession | null>(null)
  const [last, setLast] = useState<FocusSession | null>(null)
  const [blocking, setBlocking] = useState<BlockingStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => {
    setNonce((value) => value + 1)
  }, [])

  useEffect(() => {
    let active = true
    send({ type: 'focus/current' }).then(
      (data) => {
        if (!active) return
        setSession(data.session)
        setLast(data.last)
        setBlocking(data.blocking)
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

  // The worker completing a session (or another surface cancelling one) must
  // show up here too — and so must a blocklist edit, since what is enforced
  // during a running session follows the list.
  useEffect(() => {
    return onStateChanged((changes) => {
      if ('focusSessions' in changes || 'blocklists' in changes) refresh()
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
        // The storage listener also fires; refreshing here keeps the UI correct
        // even when the write changed nothing observable.
        refresh()
      }
    },
    [refresh],
  )

  const start = useCallback(
    (input: NewFocusSession) =>
      run(async () => {
        const data = await send({ type: 'focus/start', input })
        return {
          ok: true,
          started: data.started,
          session: data.session,
          blocking: data.blocking ?? null,
        }
      }, START_FAILED),
    [run],
  )

  const pause = useCallback(
    () =>
      run(async () => {
        const data = await send({ type: 'focus/pause' })
        return data.session !== null
      }, false),
    [run],
  )

  const resume = useCallback(
    () =>
      run(async () => {
        const data = await send({ type: 'focus/resume' })
        return data.session !== null
      }, false),
    [run],
  )

  const cancel = useCallback(
    () =>
      run(async () => {
        const data = await send({ type: 'focus/cancel' })
        return data.session !== null
      }, false),
    [run],
  )

  return useMemo(
    () => ({
      session,
      last,
      blocking,
      loading,
      error,
      busy,
      start,
      pause,
      resume,
      cancel,
      refresh,
    }),
    [
      session,
      last,
      blocking,
      loading,
      error,
      busy,
      start,
      pause,
      resume,
      cancel,
      refresh,
    ],
  )
}
