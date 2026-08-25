import { describe, expect, it } from 'vitest'
import { timerAlarmName } from '../services/alarms'
import {
  cancelTimerSession,
  pauseTimerSession,
  startTimerSession,
  type TimerSession,
} from '../models'
import { planTimerAlarm, type ExistingAlarm } from './timerPlan'

/**
 * Unit tests for the pure timer alarm planner.
 *
 * The planner is the whole recovery story: given what storage says and what
 * Chrome holds, it decides what the timer namespace should look like. These
 * tests cover each rule it encodes — one alarm while running, none otherwise,
 * stale names cleared, closed-over ends completed rather than rescheduled.
 */

const MINUTE = 60_000
const NOW = 1_000_000_000_000

const alarm = (name: string, scheduledTime: number): ExistingAlarm => ({
  name,
  scheduledTime,
})

describe('planTimerAlarm', () => {
  const running = startTimerSession('t1', { title: '', durationMinutes: 25 }, NOW)
  const name = timerAlarmName('t1')

  it('wants exactly one alarm for a running timer', () => {
    const plan = planTimerAlarm(running, [], NOW + MINUTE)
    expect(plan.create).toEqual({ name, when: running.endsAt })
    expect(plan.clear).toEqual([])
    expect(plan.completeDue).toBeNull()
  })

  it('keeps a correct alarm and never churns it', () => {
    const plan = planTimerAlarm(
      running,
      [alarm(name, running.endsAt ?? 0)],
      NOW + MINUTE,
    )
    expect(plan.create).toBeNull()
    expect(plan.clear).toEqual([])
  })

  it('replaces an alarm that drifted beyond tolerance', () => {
    const plan = planTimerAlarm(
      running,
      [alarm(name, (running.endsAt ?? 0) + 5 * MINUTE)],
      NOW + MINUTE,
    )
    expect(plan.create).toEqual({ name, when: running.endsAt })
  })

  it('clears every timer alarm when none is live', () => {
    const paused = pauseTimerSession(running, NOW + 10 * MINUTE)
    for (const [label, timer] of [
      ['paused', paused],
      ['cancelled', cancelTimerSession(running, NOW + MINUTE)],
      ['null', null],
    ] as const) {
      const plan = planTimerAlarm(
        timer,
        [alarm(name, NOW + 20 * MINUTE), alarm(timerAlarmName('other'), NOW)],
        NOW + 10 * MINUTE,
      )
      expect(plan.create, label).toBeNull()
      expect(plan.completeDue, label).toBeNull()
      expect(plan.clear, label).toHaveLength(2)
    }
  })

  it('clears stale and duplicate alarms alongside the right one', () => {
    const plan = planTimerAlarm(
      running,
      [
        alarm(timerAlarmName('t1'), running.endsAt ?? 0),
        alarm(timerAlarmName('t1-dup'), NOW + 20 * MINUTE),
        alarm(timerAlarmName('gone'), NOW + 30 * MINUTE),
        alarm('timepilot:activity:x', NOW),
        alarm('foreign-alarm', NOW),
      ],
      NOW + MINUTE,
    )
    // Duplicate ids cannot exist in Chrome, but a same-prefix leftover from an
    // older timer can; only the timer namespace is touched.
    expect(plan.clear).toEqual([timerAlarmName('t1-dup'), timerAlarmName('gone')])
    expect(plan.create).toBeNull()
  })

  it('completes a timer whose end passed while nothing was listening', () => {
    const plan = planTimerAlarm(running, [alarm(name, running.endsAt ?? 0)], NOW + 30 * MINUTE)
    expect(plan.create).toBeNull()
    expect(plan.completeDue).toBe('t1')
    // The alarm is moot: cleared, not rewritten into the past.
    expect(plan.clear).toContain(name)
  })

  it('ignores the exact-boundary fire as a normal completion signal', () => {
    // endsAt <= now counts as due — one millisecond before does not.
    const before = planTimerAlarm(
      running,
      [],
      (running.endsAt ?? 0) - 1,
    )
    expect(before.completeDue).toBeNull()
    expect(before.create).toEqual({ name, when: running.endsAt })
  })

  it('treats a run of the mill settled timer like any other non-live state', () => {
    const settled: TimerSession = {
      ...running,
      status: 'completed',
      endsAt: null,
      remainingMs: null,
      endedAt: NOW + 25 * MINUTE,
    }
    const plan = planTimerAlarm(settled, [alarm(name, NOW + 20 * MINUTE)], NOW + 30 * MINUTE)
    expect(plan.create).toBeNull()
    expect(plan.completeDue).toBeNull()
    expect(plan.clear).toEqual([name])
  })
})
