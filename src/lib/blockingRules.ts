import { blocklistFor, type Blocklist, type FocusSession } from '../models'

/**
 * Pure planner for declarativeNetRequest blocking rules.
 *
 * Same shape and same reason as `schedulePlan` and `focusPlan`: the worker cannot
 * trust its own memory, so "which rules should exist" is derived every time from
 * the persisted blocklists plus the live Focus session plus the rules Chrome
 * actually holds. No Chrome calls and no I/O here, so the rules below can be
 * read — and exercised — on their own.
 *
 * Storage is the source of truth. Rules are never stored; they are a projection
 * of it, recomputed whenever either side might have moved.
 */

/* --- Rule id ownership ---------------------------------------------------- */

/**
 * TimePilot's reserved dynamic-rule id range: 1_000_000 – 1_009_999.
 *
 * Dynamic rules live in one flat, extension-wide namespace that persists across
 * browser sessions and extension updates. Reserving a documented range is what
 * lets reconciliation say "this rule is mine, that one is not" from the id alone,
 * so a rule belonging to a future TimePilot subsystem — or to anything else
 * sharing the namespace — is never deleted by a sweep it was not part of.
 *
 * Deliberately far from 1: an id near the bottom of the space is what a
 * hand-written static ruleset or a quick experiment would pick.
 *
 * Allocation inside the range: one band of BAND_SIZE per simultaneously active
 * blocklist, assigned in stable id order (see `planBlockingIntent`). With
 * BAND_SIZE 200 and MAX_BLOCKLIST_DOMAINS 200, every list fits its band even
 * when full, and bands can never bleed into one another.
 *
 * Within a band, a domain's id is `base + index` over the band's domains sorted
 * lexicographically. Sorting is what makes the allocation deterministic — the
 * same list produces the same rules regardless of the order the user typed them
 * in — and the cost is that inserting a domain shifts the ids after it. That is
 * harmless: an update is one atomic `updateDynamicRules` call, and the ids are
 * recomputed from the list rather than remembered.
 */
export const TIMEPILOT_RULE_ID_MIN = 1_000_000
export const TIMEPILOT_RULE_ID_MAX = 1_009_999

/** Ids per band. Matches `MAX_BLOCKLIST_DOMAINS`, so a full list always fits. */
export const BAND_SIZE = 200

/** The first id of a band. */
export function blockingBand(band: number): number {
  return TIMEPILOT_RULE_ID_MIN + Math.max(0, Math.trunc(band)) * BAND_SIZE
}

/** How many bands fit the reserved range — the cap on simultaneously active lists. */
export const MAX_ACTIVE_LISTS = Math.floor(
  (TIMEPILOT_RULE_ID_MAX - TIMEPILOT_RULE_ID_MIN + 1) / BAND_SIZE,
)

/** The first band, kept as a named base for the Focus blocklist's rules. */
export const FOCUS_BLOCK_RULE_BASE = blockingBand(0)

/** Whether this rule id belongs to TimePilot and may therefore be removed by us. */
export function isTimePilotRuleId(id: number): boolean {
  return (
    Number.isInteger(id) &&
    id >= TIMEPILOT_RULE_ID_MIN &&
    id <= TIMEPILOT_RULE_ID_MAX
  )
}

/* --- What to block -------------------------------------------------------- */

/**
 * The resource types a block rule covers, as plain literals.
 *
 * Declared here rather than imported from `chrome.declarativeNetRequest`: that
 * typing is a TS `enum`, and depending on it would drag the Chrome API into a
 * module whose entire purpose is to be a pure, testable planner. The strings are
 * the wire format either way, so `services/blocking` hands them straight to
 * Chrome.
 */
export type BlockedResourceType =
  | 'main_frame'
  | 'sub_frame'
  | 'xmlhttprequest'
  | 'websocket'
  | 'script'
  | 'media'

/**
 * The resource types a blocking rule covers.
 *
 * Chosen so the site cannot be used normally, and no wider:
 *
 * - `main_frame` — the page itself. On its own this is most of the effect.
 * - `sub_frame` — an embed on another page (a YouTube player in an article).
 * - `xmlhttprequest` — the API calls a single-page app needs to function, so a
 *   tab left open before blocking began stops working rather than carrying on.
 * - `websocket` — the same, for anything holding a live connection.
 * - `script` and `media` — the app bundle and the video/audio stream.
 *
 * `image`, `font` and `stylesheet` are deliberately excluded. The site is already
 * unreachable through `main_frame`, so blocking its assets adds no protection —
 * it only breaks the *other* pages that happen to embed an avatar or a thumbnail
 * from the domain, which is a browsing problem rather than a focus one.
 */
export const BLOCKED_RESOURCE_TYPES: readonly BlockedResourceType[] = [
  'main_frame',
  'sub_frame',
  'xmlhttprequest',
  'websocket',
  'script',
  'media',
]

/** The TimePilot page a blocked request is redirected to. */
export const BLOCKED_PAGE_PATH = '/blocked.html'

/**
 * The redirect target for one domain, carrying the domain so the page can say
 * what was stopped. Encoded in the query — DNR has no per-request templating,
 * so the one variable a rule can know is baked into the rule it belongs to.
 */
export function blockedPagePath(domain: string): string {
  return `${BLOCKED_PAGE_PATH}?d=${encodeURIComponent(domain)}`
}

/** A minimal structural view of a dynamic rule, so this file needs no Chrome API. */
export type BlockingRule = {
  id: number
  priority: number
  action: {
    type: 'redirect'
    redirect: { extensionPath: string }
  }
  condition: {
    requestDomains: string[]
    resourceTypes: BlockedResourceType[]
  }
}

/**
 * Rules for one blocklist, allocated from `base`.
 *
 * One rule per domain, matched with `requestDomains` rather than a URL pattern:
 * Chrome matches a listed domain *and its subdomains`, so `youtube.com` covers
 * `www.youtube.com`, `m.youtube.com` and the rest without enumerating any of
 * them — and without ever widening into a wildcard.
 *
 * The action is a redirect to the TimePilot blocked page rather than a bare
 * `block`, so the user meets a calm explanation instead of a browser error. A
 * redirect needs no loop guard of its own: the rules match the blocklisted
 * domains, and the page they point at lives on the extension's own origin,
 * which no rule in this range ever matches.
 *
 * Deterministic by construction: domains are sorted, so the same list always
 * yields the same ids and the same rules in the same order.
 */
export function planBlockingRules(
  blocklist: Blocklist | null,
  base: number = FOCUS_BLOCK_RULE_BASE,
): BlockingRule[] {
  if (!blocklist || !blocklist.enabled) return []

  const domains = [...new Set(blocklist.domains)].sort()
  // Never allocate past the band: an over-long list is truncated rather than
  // allowed to collide with the next band's ids.
  return domains.slice(0, BAND_SIZE).map((domain, index) => ({
    id: base + index,
    priority: 1,
    action: {
      type: 'redirect' as const,
      redirect: { extensionPath: blockedPagePath(domain) },
    },
    condition: {
      requestDomains: [domain],
      resourceTypes: [...BLOCKED_RESOURCE_TYPES],
    },
  }))
}

/* --- What should be active ------------------------------------------------ */

/** Why nothing is blocked, when nothing is. */
export type BlockingIdleReason =
  /** No manual list is active and no Focus session is running. A paused session counts as idle. */
  | 'nothing-active'
  /** The session chose no blocklist. */
  | 'no-blocklist'
  /** The list the session named is gone, disabled, or empty. */
  | 'blocklist-unavailable'

export type BlockingIntent =
  | { active: true; lists: Blocklist[]; rules: BlockingRule[] }
  | { active: false; reason: BlockingIdleReason }

/** A list that enforces on its own, without a Focus session. */
function isManuallyActive(list: Blocklist): boolean {
  return list.enabled && list.mode === 'always' && list.domains.length > 0
}

/**
 * What should be blocked, given the live session and the saved lists.
 *
 * Pure, so the rules that decide "is blocking owed" can be read in one place.
 * Two independent sources may be active at once, and both are honoured — a
 * manually enabled list and the list a running Focus session named stay blocked
 * together unless they are the same list, in which case it is blocked once:
 *
 * - a *running* session blocks. A paused session is explicitly idle — pausing
 *   means the websites come back — and a completed or cancelled one owns
 *   nothing;
 * - a list in `always` mode blocks from the moment it is enabled until it is
 *   disabled, restarts included, because the reconciler re-derives it from
 *   storage at every recovery point;
 * - a list the session named is honoured only if it still exists, is enabled,
 *   and holds at least one domain — a deleted, disabled or emptied list blocks
 *   nothing rather than failing the session.
 *
 * Bands are assigned to the active lists in id order, so the same active set
 * always yields the same ids. The band count is capped at what the reserved
 * range holds; with MAX_BLOCKLISTS 50 against 50 bands, an owner of that many
 * simultaneously active full lists is past anything the UI suggests.
 */
export function planBlockingIntent(
  session: FocusSession | null,
  blocklists: readonly Blocklist[],
): BlockingIntent {
  const manual = blocklists.filter(isManuallyActive)

  let focusList: Blocklist | null = null
  if (session && session.status === 'running' && session.blocklistId !== null) {
    focusList = blocklistFor(blocklists, session.blocklistId)
  }

  const active = [...new Map([...manual, ...(focusList ? [focusList] : [])].map((list) => [list.id, list])).values()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, MAX_ACTIVE_LISTS)

  if (active.length === 0) {
    if (session && session.status === 'running' && session.blocklistId !== null) {
      return { active: false, reason: 'blocklist-unavailable' }
    }
    if (session && session.status === 'running') {
      return { active: false, reason: 'no-blocklist' }
    }
    return { active: false, reason: 'nothing-active' }
  }

  const rules = active.flatMap((list, band) =>
    planBlockingRules(list, blockingBand(band)),
  )
  return { active: true, lists: active, rules }
}

/* --- Reconciliation ------------------------------------------------------- */

/**
 * What one atomic `updateDynamicRules` call should do.
 *
 * `removeRuleIds` is applied before `addRules` by Chrome, so listing an id in
 * both is how a rule is replaced.
 */
export type BlockingRulePlan = {
  addRules: BlockingRule[]
  removeRuleIds: number[]
  /** True when the plan is a no-op — nothing needs to be written at all. */
  unchanged: boolean
}

/** A rule as read back from Chrome, narrowed to what comparison needs. */
export type ExistingRule = {
  id: number
  condition?: { requestDomains?: string[] }
}

/**
 * Diff the rules Chrome holds against the rules that should exist, across the
 * whole reserved range.
 *
 * Only ids inside TimePilot's range are ever proposed for removal — a rule from
 * another extension, or from a future TimePilot subsystem outside this range, is
 * left strictly alone. That is the whole ownership contract, and it is what
 * makes stale rules (a list deleted while the worker was down), duplicate rules
 * (a write repeated across an eviction) and band shifts (the active set
 * changing) all clean up through the same diff.
 *
 * Idempotent: given the state it just produced, it returns `unchanged`.
 */
export function planRuleUpdate(
  desired: readonly BlockingRule[],
  existing: readonly ExistingRule[],
): BlockingRulePlan {
  const ours = existing.filter((rule) => isTimePilotRuleId(rule.id))
  const byId = new Map(ours.map((rule) => [rule.id, rule]))
  const wanted = new Set(desired.map((rule) => rule.id))

  // An id we own that is not wanted is stale. An id that is wanted but whose
  // domain differs must be rewritten, so it is removed and re-added.
  const removeRuleIds = ours
    .filter((rule) => {
      if (!wanted.has(rule.id)) return true
      const target = desired.find((candidate) => candidate.id === rule.id)
      return target === undefined || !sameDomains(rule, target)
    })
    .map((rule) => rule.id)

  const addRules = desired.filter((rule) => {
    const current = byId.get(rule.id)
    return current === undefined || !sameDomains(current, rule)
  })

  return {
    addRules,
    removeRuleIds,
    unchanged: addRules.length === 0 && removeRuleIds.length === 0,
  }
}

/**
 * Whether an existing rule already redirects what the desired one does.
 *
 * Only the domain is compared: the redirect target is derived from it, and the
 * resource types are a constant of this module, so a rule whose id and domain
 * match was written by this same code. Comparing the whole condition would make
 * every change to `BLOCKED_RESOURCE_TYPES` a silent no-op instead — but so would
 * ignoring it, and the id-range sweep on install is what actually reissues
 * rules after an update.
 */
function sameDomains(existing: ExistingRule, desired: BlockingRule): boolean {
  const current = existing.condition?.requestDomains
  if (!current || current.length !== desired.condition.requestDomains.length) {
    return false
  }
  return current.every(
    (domain, index) => domain === desired.condition.requestDomains[index],
  )
}

/** Every id TimePilot may hold, for a full teardown. */
export function ownedRuleIds(existing: readonly ExistingRule[]): number[] {
  return existing.filter((rule) => isTimePilotRuleId(rule.id)).map((rule) => rule.id)
}
