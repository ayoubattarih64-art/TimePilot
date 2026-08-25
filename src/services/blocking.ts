/**
 * chrome.declarativeNetRequest wrapper.
 *
 * DNR rather than a blocking `webRequest` listener: MV3 removed the blocking
 * variant, and a content script cannot stop a request that has already been made.
 * Declarative rules are enforced by the network layer itself, which means they
 * keep working while the service worker is evicted — the same property that makes
 * alarms the only reliable scheduler here.
 *
 * Dynamic rules rather than a static ruleset: the blocklist is user data, so the
 * rules cannot be known at package time. Dynamic rules persist across browser
 * sessions and extension updates, which is exactly why reconciliation exists.
 *
 * Every function here is total — a refused or unavailable API is reported, never
 * thrown, because a failure to block must be visible to the caller rather than
 * taking the worker down.
 */

import type { BlockingRule, ExistingRule } from '../lib/blockingRules'

/** Whether the API is present at all — it needs the declarativeNetRequest permission. */
export function isAvailable(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.declarativeNetRequest?.updateDynamicRules === 'function'
  )
}

/**
 * Every dynamic rule Chrome currently holds, ours and anyone else's.
 *
 * The caller filters by id range; returning the lot is what lets it tell "not
 * mine" apart from "missing".
 */
export async function getDynamicRules(): Promise<ExistingRule[]> {
  if (!isAvailable()) return []
  try {
    const rules = await chrome.declarativeNetRequest.getDynamicRules()
    return rules.map((rule) => ({
      id: rule.id,
      condition: { requestDomains: rule.condition.requestDomains },
    }))
  } catch (error: unknown) {
    console.warn('[timepilot] could not read dynamic rules', error)
    return []
  }
}

export type RuleUpdateResult =
  | { ok: true }
  | { ok: false; reason: 'unavailable' | 'rejected'; message: string }

/**
 * Apply a rule change as one atomic operation.
 *
 * `updateDynamicRules` either applies everything or nothing, so there is no
 * partial state to clean up: a rejection leaves Chrome exactly as it was, and the
 * next reconcile tries again from the same starting point.
 */
export async function updateRules(options: {
  addRules?: readonly BlockingRule[]
  removeRuleIds?: readonly number[]
}): Promise<RuleUpdateResult> {
  if (!isAvailable()) {
    return {
      ok: false,
      reason: 'unavailable',
      message: 'Website blocking is not available in this browser.',
    }
  }

  const addRules = options.addRules ?? []
  const removeRuleIds = options.removeRuleIds ?? []
  if (addRules.length === 0 && removeRuleIds.length === 0) return { ok: true }

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      // The structural type is deliberately ours, not Chrome's: the planner is
      // pure and must not import the API. The shapes agree by construction.
      addRules: addRules as unknown as chrome.declarativeNetRequest.Rule[],
      removeRuleIds: [...removeRuleIds],
    })
    return { ok: true }
  } catch (error: unknown) {
    // Rule limit, a malformed rule, or a quota rejection. Reported rather than
    // thrown so the caller can say blocking is not active.
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[timepilot] could not update dynamic rules', error)
    return { ok: false, reason: 'rejected', message }
  }
}
