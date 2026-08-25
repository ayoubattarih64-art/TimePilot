import { useCallback, useEffect, useMemo, useState } from 'react'
import { send } from '../services/messaging'
import { onStateChanged } from '../services/storage'
import type { FocusSession } from '../models'

/**
 * The full focus session history, for Insights.
 *
 * Read-only, and separate from `useFocusSession` on purpose: that hook mirrors
 * the live session and would re-poll the worker every time Focus re-renders,
 * while Insights wants the whole archive once plus a nudge whenever a session
 * settles. No component touches chrome.* — the request and the storage
 * subscription both live here.
 */

export type FocusHistoryState = {
  sessions: FocusSession[]
  loading: boolean
  error: string | null
}

export function useFocusHistory(): FocusHistoryState {
  const [sessions, setSessions] = useState<FocusSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => {
    setNonce((value) => value + 1)
  }, [])

  useEffect(() => {
    let active = true
    send({ type: 'focus/list' }).then(
      (data) => {
        if (!active) return
        setSessions(data.sessions)
        setError(null)
        setLoading(false)
      },
      (cause: unknown) => {
        if (!active) return
        setError(cause instanceof Error ? cause.message : String(cause))
        setLoading(false)
      },
    )
    return () => {
      active = false
    }
  }, [nonce])

  // A session completing in the background (its alarm fired, the panel was
  // closed) must appear here without waiting for a remount.
  useEffect(() => {
    return onStateChanged((changes) => {
      if ('focusSessions' in changes) refresh()
    })
  }, [refresh])

  return useMemo(
    () => ({ sessions, loading, error }),
    [sessions, loading, error],
  )
}
