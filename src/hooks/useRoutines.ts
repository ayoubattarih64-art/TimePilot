import { useCallback, useEffect, useMemo, useState } from 'react'
import { send } from '../services/messaging'
import { onStateChanged } from '../services/storage'
import type { RoutineError } from '../background/features/routines'
import type { NewRoutine, Routine } from '../models'

/**
 * The surfaces' single door to routine state.
 *
 * Same shape as `useBlocklists`, and for the same reasons: the worker owns every
 * write, this hook only sends and mirrors. Nothing here generates activities or
 * touches alarms — the UI edits a plan and the worker decides what that means for
 * the schedule.
 *
 * A mutation resolves to a reason rather than throwing on a refusal, because "you
 * already have 50 routines" belongs next to the button that was pressed. It also
 * carries `generated`, the number of scheduled activities the routine now owns,
 * which is what lets the page say "4 steps, scheduled" as an observation rather
 * than a claim.
 */

export type RoutineOutcome =
  | { ok: true; routine: Routine; generated: number }
  | { ok: false; reason: RoutineError | 'failed' }

export type RoutinesState = {
  routines: Routine[]
  loading: boolean
  error: string | null
  busy: boolean
  create: (input: NewRoutine) => Promise<RoutineOutcome>
  update: (id: string, input: NewRoutine) => Promise<RoutineOutcome>
  setEnabled: (id: string, enabled: boolean) => Promise<RoutineOutcome>
  remove: (id: string) => Promise<boolean>
  refresh: () => void
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** Module scope so the reference is stable across renders. */
const FAILED: RoutineOutcome = { ok: false, reason: 'failed' }

export function useRoutines(): RoutinesState {
  const [routines, setRoutines] = useState<Routine[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => {
    setNonce((value) => value + 1)
  }, [])

  useEffect(() => {
    let active = true
    send({ type: 'routine/list' }).then(
      (data) => {
        if (!active) return
        setRoutines(data.routines)
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

  // Another surface may edit a routine, and the hourly sweep may regenerate one.
  useEffect(() => {
    return onStateChanged((changes) => {
      if ('routines' in changes) refresh()
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
        refresh()
      }
    },
    [refresh],
  )

  const create = useCallback(
    (input: NewRoutine) =>
      run(async () => {
        const data = await send({ type: 'routine/create', input })
        return data.ok
          ? ({ ok: true, routine: data.routine, generated: data.generated } as const)
          : ({ ok: false, reason: data.reason } as const)
      }, FAILED),
    [run],
  )

  const update = useCallback(
    (id: string, input: NewRoutine) =>
      run(async () => {
        const data = await send({ type: 'routine/update', id, input })
        return data.ok
          ? ({ ok: true, routine: data.routine, generated: data.generated } as const)
          : ({ ok: false, reason: data.reason } as const)
      }, FAILED),
    [run],
  )

  const setEnabled = useCallback(
    (id: string, enabled: boolean) =>
      run(async () => {
        const data = await send({ type: 'routine/set-enabled', id, enabled })
        return data.ok
          ? ({ ok: true, routine: data.routine, generated: data.generated } as const)
          : ({ ok: false, reason: data.reason } as const)
      }, FAILED),
    [run],
  )

  const remove = useCallback(
    (id: string) =>
      run(async () => {
        const data = await send({ type: 'routine/remove', id })
        return data.removed
      }, false),
    [run],
  )

  return useMemo(
    () => ({
      routines,
      loading,
      error,
      busy,
      create,
      update,
      setEnabled,
      remove,
      refresh,
    }),
    [
      routines,
      loading,
      error,
      busy,
      create,
      update,
      setEnabled,
      remove,
      refresh,
    ],
  )
}
