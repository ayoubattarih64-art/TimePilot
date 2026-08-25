import { describe, expect, it } from 'vitest'
import type { Blocklist, FocusSession } from '../models'
import {
  blockedPagePath,
  blockingBand,
  BAND_SIZE,
  isTimePilotRuleId,
  MAX_ACTIVE_LISTS,
  planBlockingIntent,
  planBlockingRules,
  planRuleUpdate,
  TIMEPILOT_RULE_ID_MIN,
} from './blockingRules'

/**
 * Unit tests for the pure blocking planner.
 *
 * Everything the reconciler does is decided here, in plain data: which lists
 * are active, which rules they produce, and what the diff against Chrome
 * should be. The Focus lifecycle cases are expressed as storage states, the
 * way an evicted worker would find them.
 */

const MINUTE = 60_000
const NOW = 1_000_000_000_000

/** Assert the intent is active and hand back the narrowed shape. */
function activeOf(intent: ReturnType<typeof planBlockingIntent>) {
  if (!intent.active) throw new Error('expected the intent to be active')
  return intent
}

function list(overrides: Partial<Blocklist> = {}): Blocklist {
  return {
    id: 'list-a',
    name: 'Social Media',
    domains: ['instagram.com', 'youtube.com'],
    enabled: true,
    mode: 'focus',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function session(overrides: Partial<FocusSession> = {}): FocusSession {
  return {
    id: 'fs-1',
    title: 'Study',
    plannedMs: 25 * MINUTE,
    startedAt: NOW,
    endsAt: NOW + 25 * MINUTE,
    remainingMs: null,
    endedAt: null,
    activityId: null,
    status: 'running',
    blocklistId: 'list-a',
    ...overrides,
  }
}

describe('planBlockingRules', () => {
  it('produces one redirect rule per domain, sorted, with stable ids', () => {
    const rules = planBlockingRules(list(), TIMEPILOT_RULE_ID_MIN)
    expect(rules.map((rule) => rule.condition.requestDomains[0])).toEqual([
      'instagram.com',
      'youtube.com',
    ])
    expect(rules.map((rule) => rule.id)).toEqual([
      TIMEPILOT_RULE_ID_MIN,
      TIMEPILOT_RULE_ID_MIN + 1,
    ])
    // Deterministic: the same list, typed in another order, is the same plan.
    expect(planBlockingRules(list({ domains: ['youtube.com', 'instagram.com'] }))).toEqual(rules)
  })

  it('redirects to the TimePilot blocked page carrying the domain', () => {
    const [rule] = planBlockingRules(list())
    expect(rule.action.type).toBe('redirect')
    expect(rule.action.redirect.extensionPath).toBe(
      blockedPagePath('instagram.com'),
    )
    expect(blockedPagePath('youtube.com')).toBe('/blocked.html?d=youtube.com')
  })

  it('returns nothing for a disabled, empty or missing list', () => {
    expect(planBlockingRules(null)).toEqual([])
    expect(planBlockingRules(list({ enabled: false }))).toEqual([])
    expect(planBlockingRules(list({ domains: [] }))).toEqual([])
  })

  it('deduplicates domains and never allocates past the band', () => {
    const many = Array.from({ length: BAND_SIZE + 50 }, (_, i) => `site${String(i)}.com`)
    const rules = planBlockingRules(list({ domains: many }))
    expect(rules).toHaveLength(BAND_SIZE)
    expect(rules[rules.length - 1]?.id).toBe(
      TIMEPILOT_RULE_ID_MIN + BAND_SIZE - 1,
    )
  })
})

describe('planBlockingIntent', () => {
  it('blocks the focus list while the session runs', () => {
    const intent = activeOf(planBlockingIntent(session(), [list()]))
    expect(intent.lists).toHaveLength(1)
    expect(intent.lists[0]?.id).toBe('list-a')
    expect(intent.rules).toHaveLength(2)
  })

  it('releases the focus list when the session pauses, settles, or names none', () => {
    for (const overrides of [
      { status: 'paused' as const, endsAt: null, remainingMs: 10 * MINUTE },
      { status: 'completed' as const, endsAt: null, endedAt: NOW },
      { status: 'cancelled' as const, endsAt: null, endedAt: NOW },
      { blocklistId: null },
    ]) {
      const intent = planBlockingIntent(session(overrides), [list()])
      expect(intent.active, JSON.stringify(overrides)).toBe(false)
    }
  })

  it('says why nothing is blocking', () => {
    expect(planBlockingIntent(null, [list()])).toEqual({
      active: false,
      reason: 'nothing-active',
    })
    expect(planBlockingIntent(session({ blocklistId: null }), [])).toEqual({
      active: false,
      reason: 'no-blocklist',
    })
    expect(planBlockingIntent(session(), [])).toEqual({
      active: false,
      reason: 'blocklist-unavailable',
    })
  })

  it('does not follow a deleted, disabled or emptied focus list', () => {
    expect(planBlockingIntent(session(), [list({ enabled: false })]).active).toBe(false)
    expect(planBlockingIntent(session(), [list({ domains: [] })]).active).toBe(false)
    // The disabled-and-named case still reports the specific reason.
    expect(planBlockingIntent(session(), [list({ enabled: false })])).toEqual({
      active: false,
      reason: 'blocklist-unavailable',
    })
  })

  it('blocks a manual list with no session at all', () => {
    const always = list({ id: 'list-b', mode: 'always' })
    const intent = activeOf(planBlockingIntent(null, [always]))
    expect(intent.lists[0]?.id).toBe('list-b')
  })

  it('ignores an always list that is disabled or empty', () => {
    expect(planBlockingIntent(null, [list({ mode: 'always', enabled: false })]).active).toBe(false)
    expect(planBlockingIntent(null, [list({ mode: 'always', domains: [] })]).active).toBe(false)
  })

  it('keeps a manual list and a focus list active together, once each', () => {
    const manual = list({ id: 'list-b', name: 'News', domains: ['news.com'], mode: 'always' })
    const focus = list({ id: 'list-a', domains: ['youtube.com'] })
    const intent = activeOf(planBlockingIntent(session(), [focus, manual]))
    // Id order, so the allocation is deterministic.
    expect(intent.lists.map((entry) => entry.id)).toEqual(['list-a', 'list-b'])
    // Band per list: disjoint id ranges by construction.
    const ids = new Set(intent.rules.map((rule) => rule.id))
    expect(ids.size).toBe(intent.rules.length)
    const firstBand = intent.rules
      .filter((rule) => rule.id < blockingBand(1))
      .map((rule) => rule.id)
    const secondBand = intent.rules
      .filter((rule) => rule.id >= blockingBand(1))
      .map((rule) => rule.id)
    expect(firstBand.length).toBe(1)
    expect(secondBand.length).toBe(1)
  })

  it('de-duplicates the same list named by focus and set to always', () => {
    const both = list({ mode: 'always' })
    const intent = activeOf(planBlockingIntent(session(), [both]))
    expect(intent.lists).toHaveLength(1)
  })

  it('caps the active set at the bands the reserved range holds', () => {
    const many = Array.from({ length: MAX_ACTIVE_LISTS + 5 }, (_, i) =>
      list({ id: `list-${String(i).padStart(2, '0')}`, mode: 'always', domains: [`site${String(i)}.com`] }),
    )
    const intent = activeOf(planBlockingIntent(null, many))
    expect(intent.lists).toHaveLength(MAX_ACTIVE_LISTS)
  })
})

describe('planRuleUpdate', () => {
  it('adds desired rules that are missing and keeps matching ones', () => {
    const desired = planBlockingRules(list())
    const existing = [
      { id: desired[0]?.id as number, condition: { requestDomains: ['instagram.com'] } },
    ]
    const plan = planRuleUpdate(desired, existing)
    expect(plan.addRules).toEqual([desired[1]])
    expect(plan.removeRuleIds).toEqual([])
    expect(plan.unchanged).toBe(false)
  })

  it('is a no-op against the state it just produced', () => {
    const desired = planBlockingRules(list())
    const existing = desired.map((rule) => ({
      id: rule.id,
      condition: { requestDomains: rule.condition.requestDomains },
    }))
    expect(planRuleUpdate(desired, existing)).toEqual({
      addRules: [],
      removeRuleIds: [],
      unchanged: true,
    })
  })

  it('rewrites a rule whose domain moved, and removes stale ids', () => {
    const desired = planBlockingRules(list())
    const stale = blockingBand(3) + 7
    const existing = [
      { id: desired[0]?.id as number, condition: { requestDomains: ['tiktok.com'] } },
      { id: stale, condition: { requestDomains: ['old.com'] } },
    ]
    const plan = planRuleUpdate(desired, existing)
    expect(plan.removeRuleIds).toContain(desired[0]?.id as number)
    expect(plan.removeRuleIds).toContain(stale)
    expect(plan.addRules.map((rule) => rule.id)).toContain(desired[0]?.id as number)
  })

  it('never touches rules outside the reserved range', () => {
    const foreign = [{ id: 1, condition: { requestDomains: ['elsewhere.com'] } }]
    const plan = planRuleUpdate([], foreign)
    expect(plan.removeRuleIds).toEqual([])
    expect(plan.addRules).toEqual([])
  })

  it('owns exactly the reserved range', () => {
    expect(isTimePilotRuleId(TIMEPILOT_RULE_ID_MIN)).toBe(true)
    expect(isTimePilotRuleId(TIMEPILOT_RULE_ID_MIN + 9_999)).toBe(true)
    expect(isTimePilotRuleId(TIMEPILOT_RULE_ID_MIN - 1)).toBe(false)
    expect(isTimePilotRuleId(TIMEPILOT_RULE_ID_MIN + 10_000)).toBe(false)
    expect(isTimePilotRuleId(1)).toBe(false)
  })
})
