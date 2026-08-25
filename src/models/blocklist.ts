import type { Timestamp } from './activity'
import { normalizeDomain, normalizeDomains } from '../lib/domain'

/**
 * A blocklist: a named set of domains the user does not want to reach while
 * focusing.
 *
 * Deliberately just that. The DNR rules that actually do the blocking are
 * *derived* from this (see `lib/blockingRules`), never stored — storing them
 * would create a second source of truth that could disagree with the list, and
 * the list is the thing the user edits.
 */
/**
 * When a list's domains are enforced.
 *
 * - `focus` — only while a running Focus session names this list.
 * - `always` — manually active: blocked from the moment it is enabled until
 *   it is disabled, browser restarts included.
 *
 * A third state — scheduled blocking — is deliberately absent; it would add a
 * second scheduler for one more idea, and this phase's product question is
 * "protect focused time", not "run a firewall".
 */
export type BlocklistMode = 'focus' | 'always'

export type Blocklist = {
  id: string
  name: string
  /** Bare, lowercase, validated hosts. Never URLs. See `lib/domain`. */
  domains: readonly string[]
  /** A disabled list is never enforced, whatever its mode. */
  enabled: boolean
  mode: BlocklistMode
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type NewBlocklist = {
  name: string
  domains?: readonly string[]
  mode?: BlocklistMode
}

/** Bounds. High enough to be irrelevant in practice, low enough to catch abuse. */
export const MAX_BLOCKLIST_NAME = 60
export const MAX_BLOCKLIST_DOMAINS = 200
export const MAX_BLOCKLISTS = 50

/** A name that is never empty, whatever the user typed. */
export function blocklistName(input: string): string {
  const trimmed = input.trim().slice(0, MAX_BLOCKLIST_NAME)
  return trimmed.length > 0 ? trimmed : 'Blocklist'
}

export function createBlocklist(
  id: string,
  input: NewBlocklist,
  now: number = Date.now(),
): Blocklist {
  return {
    id,
    name: blocklistName(input.name),
    domains: normalizeDomains(input.domains ?? []).slice(
      0,
      MAX_BLOCKLIST_DOMAINS,
    ),
    enabled: true,
    mode: input.mode === 'always' ? 'always' : 'focus',
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Add a domain, normalising it first.
 *
 * Returns the same list when the domain is already present — a duplicate is not
 * an error, it is a no-op, and the caller can tell the difference by identity.
 */
export function withDomain(
  list: Blocklist,
  input: string,
  now: number = Date.now(),
): { ok: true; list: Blocklist; added: boolean } | { ok: false; reason: string } {
  const result = normalizeDomain(input)
  if (!result.ok) return { ok: false, reason: result.reason }
  if (list.domains.includes(result.domain)) {
    return { ok: true, list, added: false }
  }
  if (list.domains.length >= MAX_BLOCKLIST_DOMAINS) {
    return { ok: false, reason: 'full' }
  }
  return {
    ok: true,
    added: true,
    list: { ...list, domains: [...list.domains, result.domain], updatedAt: now },
  }
}

export function withoutDomain(
  list: Blocklist,
  domain: string,
  now: number = Date.now(),
): Blocklist {
  if (!list.domains.includes(domain)) return list
  return {
    ...list,
    domains: list.domains.filter((entry) => entry !== domain),
    updatedAt: now,
  }
}

/**
 * Repair a stored blocklist.
 *
 * Domains are re-normalised on the way out rather than trusted: storage is
 * writable by anything with the extension's origin, and a malformed host must
 * never reach the rule planner. A row with no usable id is dropped.
 */
export function normalizeBlocklist(stored: unknown): Blocklist | null {
  if (typeof stored !== 'object' || stored === null) return null
  const raw = stored as Partial<Blocklist>

  if (typeof raw.id !== 'string' || raw.id.length === 0) return null

  const createdAt =
    typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
      ? raw.createdAt
      : 0

  return {
    id: raw.id,
    name: blocklistName(typeof raw.name === 'string' ? raw.name : ''),
    domains: (Array.isArray(raw.domains)
      ? normalizeDomains(raw.domains)
      : []
    ).slice(0, MAX_BLOCKLIST_DOMAINS),
    enabled: raw.enabled !== false,
    mode: raw.mode === 'always' ? 'always' : 'focus',
    createdAt,
    updatedAt:
      typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
        ? raw.updatedAt
        : createdAt,
  }
}

/** The list a focus session names, if it still exists and is usable. */
export function blocklistFor(
  lists: readonly Blocklist[],
  id: string | null | undefined,
): Blocklist | null {
  if (typeof id !== 'string' || id.length === 0) return null
  const found = lists.find((list) => list.id === id)
  if (!found || !found.enabled || found.domains.length === 0) return null
  return found
}

/**
 * The starter lists.
 *
 * Seeded once on install and then owned by the user: editable, renamable, and
 * deletable like any other. Kept short and obvious — a long opinionated default
 * is a list nobody trusts, and every domain here is one a user would recognise
 * as a distraction rather than something they need.
 */
export const DEFAULT_BLOCKLISTS: ReadonlyArray<{
  name: string
  domains: readonly string[]
}> = [
  {
    name: 'Social Media',
    domains: [
      'youtube.com',
      'instagram.com',
      'tiktok.com',
      'facebook.com',
      'reddit.com',
      'x.com',
    ],
  },
  {
    name: 'Video',
    domains: ['youtube.com', 'twitch.tv', 'netflix.com'],
  },
]
