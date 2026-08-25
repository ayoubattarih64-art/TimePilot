import { describe, expect, it } from 'vitest'
import {
  isFirstRun,
  ROUTINE_TEMPLATES,
  whenChoices,
} from './onboarding'
import {
  MAX_ROUTINE_STEPS,
  parseTimeMinutes,
  normalizeStartTime,
  buildStep,
} from '../models'

/**
 * Unit tests for the welcome tour's pure pieces.
 *
 * The choices and templates here become real data through the ordinary create
 * paths, so their contract is the same as the editors': valid dates, valid
 * times, step shapes the routine engine will accept as typed.
 */

const local = (
  year: number,
  month: number,
  day: number,
  hour = 12,
): number => new Date(year, month - 1, day, hour, 0, 0, 0).getTime()

describe('whenChoices', () => {
  it('offers an hour from now, rounded to the minute', () => {
    const now = local(2026, 8, 22, 15, ) // 15:00:00
    const [first] = whenChoices(now)
    expect(first?.label).toBe('In an hour')
    expect(first?.date).toBe('2026-08-22')
    expect(first?.time).toBe('16:00')
  })

  it('rolls the date at midnight and lands the morning choice on the next day', () => {
    const now = local(2026, 8, 22, 23, ) // 23:00
    const choices = whenChoices(now)
    // In an hour is tomorrow 00:00.
    expect(choices[0]?.date).toBe('2026-08-23')
    expect(choices[0]?.time).toBe('00:00')
    // The morning choice is tomorrow at a fixed 9:00, not the same clock time.
    expect(choices[1]?.time).toBe('09:00')
    expect(choices[1]?.date).toBe('2026-08-23')
    expect(choices[2]?.time).toBe('19:00')
  })

  it('produces shapes the scheduled-activity engine accepts', () => {
    for (const choice of whenChoices(local(2026, 12, 31, 18))) {
      expect(choice.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(choice.time).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/)
      expect(choice.id.length).toBeGreaterThan(0)
    }
  })
})

describe('ROUTINE_TEMPLATES', () => {
  it('holds routines the real create path would accept', () => {
    expect(ROUTINE_TEMPLATES.length).toBeGreaterThanOrEqual(3)
    let counter = 0
    for (const template of ROUTINE_TEMPLATES) {
      const steps = template.input.steps ?? []
      expect(template.name.trim().length).toBeGreaterThan(0)
      expect(parseTimeMinutes(normalizeStartTime(template.input.startTime))).not.toBeNull()
      expect(steps.length).toBeGreaterThan(0)
      expect(steps.length).toBeLessThanOrEqual(MAX_ROUTINE_STEPS)
      // Every step builds through the model's own constructor — the same
      // normalisation the worker applies on create.
      const built = steps.map((step) =>
        buildStep(step, () => `id-${String((counter += 1))}`),
      )
      expect(built).toHaveLength(steps.length)
      for (const step of built) {
        expect(['reminder', 'timer', 'focus']).toContain(step.type)
        expect(step.title.length).toBeGreaterThan(0)
      }
      for (const day of template.input.daysOfWeek ?? []) {
        expect(day).toBeGreaterThanOrEqual(0)
        expect(day).toBeLessThanOrEqual(6)
      }
      expect(template.summary).toContain(String(steps.length))
    }
  })

  it('uses distinct ids and names', () => {
    expect(new Set(ROUTINE_TEMPLATES.map((t) => t.id)).size).toBe(ROUTINE_TEMPLATES.length)
    expect(new Set(ROUTINE_TEMPLATES.map((t) => t.name)).size).toBe(ROUTINE_TEMPLATES.length)
  })
})

describe('isFirstRun', () => {
  const empty = { scheduled: 0, routines: 0, focusUsed: false, timerUsed: false }

  it('is true only for a store nobody has used', () => {
    expect(isFirstRun(empty)).toBe(true)
    expect(isFirstRun({ ...empty, scheduled: 1 })).toBe(false)
    expect(isFirstRun({ ...empty, routines: 2 })).toBe(false)
    expect(isFirstRun({ ...empty, focusUsed: true })).toBe(false)
    expect(isFirstRun({ ...empty, timerUsed: true })).toBe(false)
  })
})
