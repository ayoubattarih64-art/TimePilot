import { createId } from '../../lib/id'
import { normalizeDomain } from '../../lib/domain'
import {
  blocklistName,
  createBlocklist,
  DEFAULT_BLOCKLISTS,
  MAX_BLOCKLISTS,
  MAX_BLOCKLIST_DOMAINS,
  normalizeBlocklist,
  withDomain,
  withoutDomain,
  type Blocklist,
  type BlocklistMode,
  type NewBlocklist,
} from '../../models'
import { readKey, writeKey } from '../../services/storage'

/**
 * Blocklist persistence.
 *
 * Storage only — this module never touches declarativeNetRequest. What the user
 * edits is the list; turning a list into rules is `./blocking`'s job, and the
 * router reconciles after every mutation here so an edit during an active Focus
 * session reaches the network layer through the same path a restart would use.
 *
 * Domains are re-normalised on read as well as on write: storage is writable by
 * anything running as the extension, and a malformed host must never reach the
 * rule planner.
 */

async function read(): Promise<Blocklist[]> {
  const stored: unknown = await readKey('blocklists')
  if (!Array.isArray(stored)) return []
  return stored
    .map((row) => normalizeBlocklist(row))
    .filter((list): list is Blocklist => list !== null)
}

async function write(lists: readonly Blocklist[]): Promise<void> {
  await writeKey('blocklists', [...lists])
}

export async function list(): Promise<Blocklist[]> {
  return read()
}

export async function get(id: string): Promise<Blocklist | null> {
  const lists = await read()
  return lists.find((entry) => entry.id === id) ?? null
}

/**
 * Seed the starter lists, once.
 *
 * Only on a genuinely empty store: a user who has deleted every list has said
 * something, and re-creating the defaults on the next install would undo it.
 */
export async function seedDefaults(now = Date.now()): Promise<Blocklist[]> {
  const existing = await read()
  if (existing.length > 0) return existing

  const seeded = DEFAULT_BLOCKLISTS.map((preset) =>
    createBlocklist(createId(), preset, now),
  )
  await write(seeded)
  return seeded
}

export type BlocklistError = 'not-found' | 'limit' | 'full' | 'invalid-domain'

export type BlocklistResult =
  | { ok: true; list: Blocklist }
  | { ok: false; reason: BlocklistError }

export async function create(
  input: NewBlocklist,
  now = Date.now(),
): Promise<BlocklistResult> {
  const existing = await read()
  if (existing.length >= MAX_BLOCKLISTS) return { ok: false, reason: 'limit' }

  const created = createBlocklist(createId(), input, now)
  await write([...existing, created])
  return { ok: true, list: created }
}

export async function rename(
  id: string,
  name: string,
  now = Date.now(),
): Promise<BlocklistResult> {
  return patch(id, (list) => ({
    ...list,
    name: blocklistName(name),
    updatedAt: now,
  }))
}

export async function setEnabled(
  id: string,
  enabled: boolean,
  now = Date.now(),
): Promise<BlocklistResult> {
  return patch(id, (list) => ({ ...list, enabled, updatedAt: now }))
}

/**
 * Switch when a list is enforced. The router reconciles blocking after this,
 * so an `always` list enabled for the first time is blocking before the reply
 * returns to the UI.
 */
export async function setMode(
  id: string,
  mode: BlocklistMode,
  now = Date.now(),
): Promise<BlocklistResult> {
  return patch(id, (list) => ({
    ...list,
    mode: mode === 'always' ? 'always' : 'focus',
    updatedAt: now,
  }))
}

/** Add a domain. A duplicate succeeds without changing anything. */
export async function addDomain(
  id: string,
  domain: string,
  now = Date.now(),
): Promise<BlocklistResult> {
  // Validate before reading storage so a bad input is refused with its own
  // reason rather than a generic failure.
  const normalized = normalizeDomain(domain)
  if (!normalized.ok) return { ok: false, reason: 'invalid-domain' }

  const lists = await read()
  const index = lists.findIndex((entry) => entry.id === id)
  if (index === -1) return { ok: false, reason: 'not-found' }
  if (lists[index].domains.length >= MAX_BLOCKLIST_DOMAINS) {
    return { ok: false, reason: 'full' }
  }

  const result = withDomain(lists[index], domain, now)
  if (!result.ok) {
    return { ok: false, reason: result.reason === 'full' ? 'full' : 'invalid-domain' }
  }
  if (!result.added) return { ok: true, list: result.list }

  const next = [...lists]
  next[index] = result.list
  await write(next)
  return { ok: true, list: result.list }
}

export async function removeDomain(
  id: string,
  domain: string,
  now = Date.now(),
): Promise<BlocklistResult> {
  return patch(id, (list) => withoutDomain(list, domain, now))
}

/** Returns false when nothing matched the id. */
export async function remove(id: string): Promise<boolean> {
  const lists = await read()
  const next = lists.filter((entry) => entry.id !== id)
  if (next.length === lists.length) return false
  await write(next)
  return true
}

/** Read-modify-write one list, leaving order untouched. */
async function patch(
  id: string,
  change: (list: Blocklist) => Blocklist,
): Promise<BlocklistResult> {
  const lists = await read()
  const index = lists.findIndex((entry) => entry.id === id)
  if (index === -1) return { ok: false, reason: 'not-found' }

  const updated = change(lists[index])
  const next = [...lists]
  next[index] = updated
  await write(next)
  return { ok: true, list: updated }
}
