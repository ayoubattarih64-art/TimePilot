import { useCallback, useEffect, useMemo, useState } from 'react'
import { send } from '../services/messaging'
import { onStateChanged } from '../services/storage'
import type { BlocklistError } from '../background/features/blocklists'
import type { Blocklist } from '../models'

/**
 * The surfaces' single door to blocklist state.
 *
 * Same shape as `useFocusSession`, and for the same reasons: the worker owns
 * every write, this hook only sends and mirrors. Nothing here touches
 * declarativeNetRequest — the UI edits a list of domains and the worker decides
 * what that means for the network layer.
 *
 * Each mutation resolves to a reason rather than throwing on a refusal, because
 * "that is not a valid domain" and "the list is full" are things to show next to
 * the input, not error banners.
 */

export type BlocklistOutcome =
  | { ok: true; list: Blocklist }
  | { ok: false; reason: BlocklistError | 'failed' }

export type BlocklistsState = {
  blocklists: Blocklist[]
  loading: boolean
  error: string | null
  busy: boolean
  create: (name: string) => Promise<BlocklistOutcome>
  rename: (id: string, name: string) => Promise<BlocklistOutcome>
  addDomain: (id: string, domain: string) => Promise<BlocklistOutcome>
  removeDomain: (id: string, domain: string) => Promise<BlocklistOutcome>
  setEnabled: (id: string, enabled: boolean) => Promise<BlocklistOutcome>
  setMode: (
    id: string,
    mode: 'focus' | 'always',
  ) => Promise<BlocklistOutcome>
  remove: (id: string) => Promise<boolean>
  refresh: () => void
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** Module scope so the reference is stable across renders. */
const FAILED: BlocklistOutcome = { ok: false, reason: 'failed' }

export function useBlocklists(): BlocklistsState {
  const [blocklists, setBlocklists] = useState<Blocklist[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => {
    setNonce((value) => value + 1)
  }, [])

  useEffect(() => {
    let active = true
    send({ type: 'blocklist/list' }).then(
      (data) => {
        if (!active) return
        setBlocklists(data.blocklists)
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

  // Another surface — or a future install-time seed — may change the lists.
  useEffect(() => {
    return onStateChanged((changes) => {
      if ('blocklists' in changes) refresh()
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
    (name: string) =>
      run(async () => {
        const data = await send({ type: 'blocklist/create', name })
        return data.ok
          ? ({ ok: true, list: data.list } as const)
          : ({ ok: false, reason: data.reason } as const)
      }, FAILED),
    [run],
  )

  const rename = useCallback(
    (id: string, name: string) =>
      run(async () => {
        const data = await send({ type: 'blocklist/rename', id, name })
        return data.ok
          ? ({ ok: true, list: data.list } as const)
          : ({ ok: false, reason: data.reason } as const)
      }, FAILED),
    [run],
  )

  const addDomain = useCallback(
    (id: string, domain: string) =>
      run(async () => {
        const data = await send({ type: 'blocklist/add-domain', id, domain })
        return data.ok
          ? ({ ok: true, list: data.list } as const)
          : ({ ok: false, reason: data.reason } as const)
      }, FAILED),
    [run],
  )

  const removeDomain = useCallback(
    (id: string, domain: string) =>
      run(async () => {
        const data = await send({ type: 'blocklist/remove-domain', id, domain })
        return data.ok
          ? ({ ok: true, list: data.list } as const)
          : ({ ok: false, reason: data.reason } as const)
      }, FAILED),
    [run],
  )

  const setEnabled = useCallback(
    (id: string, enabled: boolean) =>
      run(async () => {
        const data = await send({ type: 'blocklist/set-enabled', id, enabled })
        return data.ok
          ? ({ ok: true, list: data.list } as const)
          : ({ ok: false, reason: data.reason } as const)
      }, FAILED),
    [run],
  )

  const setMode = useCallback(
    (id: string, mode: 'focus' | 'always') =>
      run(async () => {
        const data = await send({ type: 'blocklist/set-mode', id, mode })
        return data.ok
          ? ({ ok: true, list: data.list } as const)
          : ({ ok: false, reason: data.reason } as const)
      }, FAILED),
    [run],
  )

  const remove = useCallback(
    (id: string) =>
      run(async () => {
        const data = await send({ type: 'blocklist/remove', id })
        return data.removed
      }, false),
    [run],
  )

  return useMemo(
    () => ({
      blocklists,
      loading,
      error,
      busy,
      create,
      rename,
      addDomain,
      removeDomain,
      setEnabled,
      setMode,
      remove,
      refresh,
    }),
    [
      blocklists,
      loading,
      error,
      busy,
      create,
      rename,
      addDomain,
      removeDomain,
      setEnabled,
      setMode,
      remove,
      refresh,
    ],
  )
}
