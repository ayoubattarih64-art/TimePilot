import {
  emptyState,
  SCHEMA_VERSION,
  type PersistedState,
} from '../models/state'

/**
 * chrome.storage.local wrapper.
 *
 * `local` rather than `sync`: activity history grows without a natural bound and
 * sync caps at ~100KB with per-minute write quotas, which the write rate of a
 * running session would blow through. Settings could sync later under a separate
 * key if cross-device preferences are wanted.
 */

const STORAGE_KEYS = [
  'schemaVersion',
  'scheduled',
  'routines',
  'focusSessions',
  'timers',
  'blocklists',
  'settings',
] as const satisfies readonly (keyof PersistedState)[]

/** Read one collection, falling back to its default. */
export async function readKey<K extends keyof PersistedState>(
  key: K,
): Promise<PersistedState[K]> {
  const stored = await chrome.storage.local.get<Partial<PersistedState>>(key)
  const value = stored[key]
  return value ?? emptyState()[key]
}

/** Write one collection. */
export async function writeKey<K extends keyof PersistedState>(
  key: K,
  value: PersistedState[K],
): Promise<void> {
  await chrome.storage.local.set({ [key]: value } as Partial<PersistedState>)
}

/**
 * Ensure the store has a schema version and a default for every key.
 *
 * Only the keys that are actually absent are written. That distinction matters:
 * a store holding real activities but no `schemaVersion` — an update from a
 * build before it was stamped, or a partially cleared store — must be stamped,
 * not replaced. Writing `emptyState()` wholesale here would delete the user's
 * data to fix a missing version number.
 *
 * Future versions branch on the value read here; today there is only v1.
 */
export async function initializeStorage(): Promise<void> {
  const defaults = emptyState()
  const stored = await chrome.storage.local.get<Partial<PersistedState>>([
    ...STORAGE_KEYS,
  ])

  const missing: Partial<PersistedState> = {}
  for (const key of STORAGE_KEYS) {
    if (stored[key] === undefined) {
      // Index-safe by construction: the key comes from STORAGE_KEYS, which is
      // constrained to keyof PersistedState.
      Object.assign(missing, { [key]: defaults[key] })
    }
  }

  if (Object.keys(missing).length > 0) await chrome.storage.local.set(missing)
}

/** Subscribe to external changes so open surfaces stay in sync. */
export function onStateChanged(
  listener: (changes: Partial<Record<keyof PersistedState, unknown>>) => void,
): () => void {
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName !== 'local') return
    const mapped: Partial<Record<keyof PersistedState, unknown>> = {}
    for (const [key, change] of Object.entries(changes)) {
      mapped[key as keyof PersistedState] = change.newValue
    }
    listener(mapped)
  }
  chrome.storage.onChanged.addListener(handler)
  return () => chrome.storage.onChanged.removeListener(handler)
}

export { SCHEMA_VERSION }
