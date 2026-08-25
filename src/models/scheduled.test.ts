import { describe, expect, it } from 'vitest'
import { normalizeActivity, type ScheduledActivity } from './scheduled'

/**
 * `normalizeActivity` is the boundary between `chrome.storage.local` — writable
 * by anything running as the extension, and carrying rows from every version
 * this profile has ever run — and everything downstream that treats a
 * `ScheduledActivity` as fully formed. These tests are about that guarantee:
 * what survives is complete, and what cannot be repaired is dropped rather than
 * passed on.
 */

/** A row exactly as the current writer produces it. */
function stored(): ScheduledActivity {
  return {
    id: 'a1',
    title: 'Stretch',
    type: 'reminder',
    date: '2026-08-23',
    time: '07:30',
    repeat: 'daily',
    durationMinutes: 10,
    categoryId: 'health',
    notify: 'at-time',
    createdAt: 1_700_000_000_000,
    enabled: true,
    lastFiredAt: null,
    lastCompletedAt: null,
  }
}

describe('normalizeActivity', () => {
  it('passes a well-formed row through unchanged', () => {
    const row = stored()
    expect(normalizeActivity(row)).toEqual({
      ...row,
      routineId: null,
      routineStepId: null,
      routineStepType: null,
    })
  })

  it('drops rows nothing can address or place in time', () => {
    expect(normalizeActivity(null)).toBeNull()
    expect(normalizeActivity(undefined)).toBeNull()
    expect(normalizeActivity(42)).toBeNull()
    expect(normalizeActivity('nonsense')).toBeNull()
    expect(normalizeActivity([])).toBeNull()
    expect(normalizeActivity({})).toBeNull()
    expect(normalizeActivity({ id: '' , date: '2026-01-01', time: '09:00' })).toBeNull()
    // No date/time at all, and unusable ones: every occurrence is derived from
    // them, so a row without them has no schedule to honour.
    expect(normalizeActivity({ id: 'a1' })).toBeNull()
    expect(normalizeActivity({ id: 'a1', date: '2026-01-01' })).toBeNull()
    expect(normalizeActivity({ id: 'a1', date: 'yesterday', time: '09:00' })).toBeNull()
    expect(normalizeActivity({ id: 'a1', date: '2026-01-01', time: '25' })).toBeNull()
  })

  it('fills a missing enabled flag as on, the pre-existing behaviour', () => {
    const withoutEnabled: Record<string, unknown> = { ...stored() }
    delete withoutEnabled.enabled
    expect(normalizeActivity(withoutEnabled)?.enabled).toBe(true)
    expect(normalizeActivity({ ...stored(), enabled: false })?.enabled).toBe(false)
    // Anything that is not an explicit `false` counts as enabled.
    expect(normalizeActivity({ ...stored(), enabled: 'yes' })?.enabled).toBe(true)
  })

  it('replaces unusable enum values with their defaults', () => {
    const repaired = normalizeActivity({
      ...stored(),
      type: 'focus',
      repeat: 'fortnightly',
      notify: 'someday',
    })
    expect(repaired?.type).toBe('reminder')
    expect(repaired?.repeat).toBe('none')
    expect(repaired?.notify).toBe('at-time')
  })

  it('repairs the scalar fields the scheduler and the cards read', () => {
    const repaired = normalizeActivity({
      ...stored(),
      title: '   ',
      durationMinutes: -5.6,
      categoryId: 7,
      createdAt: 'ages ago',
      lastFiredAt: Number.NaN,
      lastCompletedAt: 'never',
    })
    expect(repaired?.title).toBe('Untitled activity')
    expect(repaired?.durationMinutes).toBe(0)
    expect(repaired?.categoryId).toBe('personal')
    expect(repaired?.createdAt).toBe(0)
    expect(repaired?.lastFiredAt).toBeNull()
    expect(repaired?.lastCompletedAt).toBeNull()
  })

  it('trims a title rather than storing the padding', () => {
    expect(normalizeActivity({ ...stored(), title: '  Read  ' })?.title).toBe('Read')
  })

  it('keeps both routine marks or neither', () => {
    // Ownership is two marks; half a mark is a row regeneration could neither
    // recognise as its own nor leave alone, so it reads as hand-made.
    const halfA = normalizeActivity({ ...stored(), routineId: 'r1' })
    expect(halfA?.routineId).toBeNull()
    expect(halfA?.routineStepId).toBeNull()

    const halfB = normalizeActivity({ ...stored(), routineStepId: 's1' })
    expect(halfB?.routineId).toBeNull()
    expect(halfB?.routineStepId).toBeNull()

    const whole = normalizeActivity({
      ...stored(),
      routineId: 'r1',
      routineStepId: 's1',
      routineStepType: 'focus',
    })
    expect(whole?.routineId).toBe('r1')
    expect(whole?.routineStepId).toBe('s1')
    expect(whole?.routineStepType).toBe('focus')
  })

  it('drops a step type it does not know', () => {
    expect(
      normalizeActivity({ ...stored(), routineStepType: 'website-block' })
        ?.routineStepType,
    ).toBeNull()
  })

  it('keeps a custom category name only when one is stored', () => {
    expect(
      normalizeActivity({ ...stored(), categoryId: 'custom', customCategory: 'Chores' })
        ?.customCategory,
    ).toBe('Chores')
    expect('customCategory' in (normalizeActivity(stored()) ?? {})).toBe(false)
  })
})
