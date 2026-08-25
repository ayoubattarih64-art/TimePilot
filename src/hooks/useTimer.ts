import { useCallback, useEffect, useMemo, useState } from 'react'
import { send } from '../services/messaging'
import { onStateChanged } from '../services/storage'
import type { NewTimerSession, TimerSession } from '../models'

/**
 * The surfaces' single door to timer state.
 *
 * Mirrors `useFocusSession` minus everything focus-specific: the worker owns
 * the writes, the alarm and the notification; this hook sends requests and
 * mirrors the result. It deliberately holds no countdown — components derive
 * remaining time from the timer's persisted `endsAt`/`remainingMs` and a
 * clock, so a closed panel or an evicted worker cannot desynchronise it.
 */

export type TimerState = {
  /** The live timer — running or paused — or null. */
  timer: TimerSession | null
  /** The most recently settled timer, for the completed state. */
  last: TimerSession | null
  loading: boolean
  error: string | null
  busy: boolean
  /**
   * Start a timer. `started: false` means one was already live and the
   * returned timer is that one — the caller offers it rather than replacing it.
   */
  start: (input: NewTimerSession) => Promise<TimerStartOutcome>
  pause: () => Promise<boolean>
  resume: () => Promise<boolean>
  add: (minutes: number) => Promise<boolean>
  cancel: () => Promise<boolean>
  refresh: () => void
}

export type TimerStartOutcome = {
  ok: boolean
  /** False when a timer was already live. */
  started: boolean
  timer: TimerSession | null
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** Module scope so the reference is stable. */
const START_FAILED: TimerStartOutcome = {
  ok: false,
  started: false,
  timer: null,
}

export function useTimer(): TimerState {
  const [timer, setTimer] = useState<TimerSession | null>(null)
  const [last, setLast] = useState<TimerSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => {
    setNonce((value) => value + 1)
  }, [])

  useEffect(() => {
    let active = true
    send({ type: 'timer/current' }).then(
      (data) => {
        if (!active) return
        setTimer(data.timer)
        setLast(data.last)
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

  // A timer completing in the background (its alarm fired while the panel was
  // closed) must appear here without waiting for a remount.
  useEffect(() => {
    return onStateChanged((changes) => {
      if ('timers' in changes) refresh()
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
    (input: NewTimerSession) =>
      run(async () => {
        const data = await send({ type: 'timer/start', input })
        return {
          ok: true,
          started: data.started,
          timer: data.timer,
        }
      }, START_FAILED),
    [run],
  )

  const pause = useCallback(
    () =>
      run(async () => {
        const data = await send({ type: 'timer/pause' })
        return data.timer !== null
      }, false),
    [run],
  )

  const resume = useCallback(
    () =>
      run(async () => {
        const data = await send({ type: 'timer/resume' })
        return data.timer !== null
      }, false),
    [run],
  )

  const add = useCallback(
    (minutes: number) =>
      run(async () => {
        const data = await send({ type: 'timer/add', minutes })
        return data.timer !== null
      }, false),
    [run],
  )

  const cancel = useCallback(
    () =>
      run(async () => {
        const data = await send({ type: 'timer/cancel' })
        return data.timer !== null
      }, false),
    [run],
  )

  return useMemo(
    () => ({
      timer,
      last,
      loading,
      error,
      busy,
      start,
      pause,
      resume,
      add,
      cancel,
      refresh,
    }),
    [timer, last, loading, error, busy, start, pause, resume, add, cancel, refresh],
  )
}
