import {
  ownedRuleIds,
  planBlockingIntent,
  planRuleUpdate,
  type BlockingIntent,
  type BlockingRule,
} from '../../lib/blockingRules'
import {
  liveFocusOf,
  normalizeBlocklist,
  normalizeFocusSession,
  type Blocklist,
  type FocusSession,
} from '../../models'
import {
  getDynamicRules,
  isAvailable,
  updateRules,
} from '../../services/blocking'
import { readKey } from '../../services/storage'

/**
 * The website blocking engine.
 *
 * One idempotent reconciler, built the same way as `scheduler.reconcile()`,
 * `focusSessions.reconcile()` and `timers.reconcile()`, and for the same
 * reason: the worker is evictable, so nothing may be remembered between
 * wake-ups. Desired state is derived from chrome.storage — the blocklists plus
 * the live focus session — and actual state is read back from
 * `chrome.declarativeNetRequest.getDynamicRules()`. The difference is applied
 * as one atomic update.
 *
 * Two things can make blocking owed, and both are honoured at once: a manually
 * enabled list (`mode: 'always'`) and the list a *running* focus session named.
 * A paused session releases its websites — that is what pausing means here —
 * and a completed or cancelled one owns nothing. The pure rules live in
 * `lib/blockingRules`; see `planBlockingIntent` for the full contract.
 *
 * Dynamic rules outlive the worker, the browser session, and extension updates.
 * That is exactly why this exists: without reconciliation, a session interrupted
 * by a crash would leave websites blocked forever. Every entry point into Focus
 * and every blocklist mutation ends here, so "what is blocked" always follows
 * "what storage says" rather than being tracked alongside it.
 *
 * There is deliberately no cached "blocking is on" flag anywhere. Whether rules
 * are in force is read from Chrome, so the UI can never claim protection that is
 * not actually there.
 */

/* --- Reading storage ------------------------------------------------------ */

/**
 * Read the live session straight from storage rather than through
 * `focusSessions`, which imports this module — a cycle would make module
 * initialisation order load-bearing in a worker that re-runs from scratch on
 * every wake-up.
 */
async function readLiveSession(): Promise<FocusSession | null> {
  const stored: unknown = await readKey('focusSessions')
  if (!Array.isArray(stored)) return null
  const sessions = stored
    .map((row) => normalizeFocusSession(row))
    .filter((session): session is FocusSession => session !== null)
  return liveFocusOf(sessions)
}

async function readBlocklists(): Promise<Blocklist[]> {
  const stored: unknown = await readKey('blocklists')
  if (!Array.isArray(stored)) return []
  return stored
    .map((row) => normalizeBlocklist(row))
    .filter((list): list is Blocklist => list !== null)
}

async function readIntent(): Promise<BlockingIntent> {
  const [session, blocklists] = await Promise.all([
    readLiveSession(),
    readBlocklists(),
  ])
  return planBlockingIntent(session, blocklists)
}

/* --- Reconciliation ------------------------------------------------------- */

/** One active list, as the status reports it. */
export type BlockingListStatus = {
  id: string
  name: string
  domainCount: number
}

export type BlockingStatus = {
  /** Whether TimePilot rules are in force right now, read back from Chrome. */
  active: boolean
  /** The lists that are being enforced, when any are. */
  lists: BlockingListStatus[]
  /** How many domains are actually blocked, counted from Chrome's own rules. */
  domainCount: number
  /**
   * Set when blocking was owed but could not be applied. The UI shows this rather
   * than implying the session is protected.
   */
  error: string | null
}

const IDLE: BlockingStatus = {
  active: false,
  lists: [],
  domainCount: 0,
  error: null,
}

/**
 * Bring Chrome's dynamic rules in line with persisted state.
 *
 * Called on install, on start-up, on every sweep, after every focus transition,
 * after every blocklist edit, and when any surface asks for the status. Reads
 * both sides fresh and applies the difference, so it is safe to run at any time
 * and free when there is nothing to do — which is the normal case.
 *
 * The returned status is derived from a *re-read* of Chrome's rules, not from the
 * plan that was just written. An update that Chrome rejected therefore reports
 * `active: false` with a reason, and never a success the network layer would
 * contradict.
 */
export async function reconcile(): Promise<BlockingStatus> {
  if (!isAvailable()) {
    return {
      ...IDLE,
      error: 'Website blocking is not available in this browser.',
    }
  }

  const intent = await readIntent()
  const existing = await getDynamicRules()

  if (!intent.active) {
    // Nothing is owed. Every rule in our range goes, whatever put it there —
    // a list disabled while the browser was closed, or a stale rule from a
    // previous version of this code.
    const ids = ownedRuleIds(existing)
    if (ids.length === 0) return IDLE

    const removed = await updateRules({ removeRuleIds: ids })
    if (!removed.ok) {
      // Rules we could not remove are still in force: report that plainly
      // rather than saying nothing is blocked.
      return {
        ...IDLE,
        active: true,
        domainCount: ids.length,
        error: `Blocked websites could not be released: ${removed.message}`,
      }
    }
    return IDLE
  }

  const plan = planRuleUpdate(intent.rules, existing)
  if (plan.addRules.length > 0 || plan.removeRuleIds.length > 0) {
    const applied = await updateRules({
      addRules: plan.addRules,
      removeRuleIds: plan.removeRuleIds,
    })
    if (!applied.ok) {
      return {
        active: false,
        lists: toListStatus(intent),
        domainCount: 0,
        error:
          applied.reason === 'unavailable'
            ? 'Website blocking is not available in this browser.'
            : `Blocking could not be activated: ${applied.message}`,
      }
    }
  }

  return verify(intent)
}

function toListStatus(intent: Extract<BlockingIntent, { active: true }>): BlockingListStatus[] {
  return intent.lists.map((list) => ({
    id: list.id,
    name: list.name,
    domainCount: list.domains.length,
  }))
}

/**
 * Confirm from Chrome what is actually in force.
 *
 * The one thing that makes "blocking is active" trustworthy: it is a read of the
 * network layer's own state, taken after the write, not an assumption based on
 * the write having returned.
 */
async function verify(intent: Extract<BlockingIntent, { active: true }>): Promise<BlockingStatus> {
  const rules = await getDynamicRules()
  const count = ownedRuleIds(rules).length
  const expected = intent.rules.length

  return {
    active: count > 0,
    lists: toListStatus(intent),
    domainCount: count,
    error:
      count >= expected
        ? null
        : count === 0
          ? 'Blocking could not be activated.'
          : 'Some websites could not be blocked.',
  }
}

/**
 * What is blocked right now, without changing anything.
 *
 * Read-only, for the UI. Counted from Chrome's rules so the answer is the network
 * layer's, not this module's.
 */
export async function status(): Promise<BlockingStatus> {
  if (!isAvailable()) {
    return {
      ...IDLE,
      error: 'Website blocking is not available in this browser.',
    }
  }

  const [intent, rules] = await Promise.all([readIntent(), getDynamicRules()])
  const count = ownedRuleIds(rules).length

  if (!intent.active) {
    // Rules with nothing behind them are stale; say so rather than pretending
    // they are protection. The next reconcile removes them.
    return {
      ...IDLE,
      active: count > 0,
      domainCount: count,
      error: count > 0 ? 'Stale blocking rules are being cleared.' : null,
    }
  }
  return verify(intent)
}

/** Re-exported so callers of the engine can reach the rule type it applies. */
export type { BlockingRule }
