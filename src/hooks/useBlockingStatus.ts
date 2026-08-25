import { useCallback, useEffect, useMemo, useState } from 'react'
import { send } from '../services/messaging'
import { onStateChanged } from '../services/storage'
import type { BlockingStatus } from '../background/features/blocking'

/**
 * What is blocked right now, for surfaces that want the quiet status line.
 *
 * Read-only and always read back from Chrome through the worker: blocking is
 * the one piece of state the UI must never derive on its own, because whether
 * rules are actually in force is the network layer's answer, not storage's.
 * Re-read whenever anything that feeds the reconciler might have moved.
 */
export function useBlockingStatus() {
  const [status, setStatus] = useState<BlockingStatus | null>(null)
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => {
    setNonce((value) => value + 1)
  }, [])

  useEffect(() => {
    let active = true
    send({ type: 'blocking/status' }).then(
      (data) => {
        if (active) setStatus(data.blocking)
      },
      () => {
        /* Leave the previous status in place: an unanswered ask is not a
           claim that nothing is blocked. */
      },
    )
    return () => {
      active = false
    }
  }, [nonce])

  useEffect(() => {
    return onStateChanged((changes) => {
      if ('blocklists' in changes || 'focusSessions' in changes) refresh()
    })
  }, [refresh])

  return useMemo(
    () => ({
      status,
      /** Ids of the lists currently being enforced, when the answer arrived. */
      activeIds:
        status?.active && status.lists
          ? new Set(status.lists.map((list) => list.id))
          : new Set<string>(),
    }),
    [status],
  )
}
