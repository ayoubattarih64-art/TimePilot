import { describe, expect, it } from 'vitest'
import {
  cancelTimerSession,
  clampTimerMinutes,
  completeTimerSession,
  extendTimerSession,
  isLiveTimer,
  liveTimerOf,
  MAX_TIMER_MINUTES,
  normalizeTimerSession,
  pauseTimerSession,
  resumeTimerSession,
  startTimerSession,
  timerRemainingMs,
  TIMER_PRESET_MINUTES,
  type TimerSession,
} from './timer'

/**
 * Unit tests for the pure timer lifecycle.
 *
 * Everything here is arithmetic on stored fields — no Chrome, no clock reads
 * (`now` is always a parameter) — which is what lets the background engine be
 * a thin persistence layer and what makes these tests exhaustive about the
 * invariants that engine depends on.
 */

const MINUTE = 60_000
const NOW = 1_000_000_000_000

function started(): TimerSession {
  return startTimerSession('t1', { title: 'Tea', durationMinutes: 25 }, NOW)
}

describe('startTimerSession', () => {
  it('creates a running timer with the invariants holding', () => {
    const timer = started()
    expect(timer.status).toBe('running')
    expect(timer.endsAt).toBe(NOW + 25 * MINUTE)
    expect(timer.remainingMs).toBeNull()
    expect(timer.endedAt).toBeNull()
    expect(timer.plannedMs).toBe(25 * MINUTE)
    expect(timerRemainingMs(timer, NOW)).toBe(25 * MINUTE)
  })

  it('clamps the duration and defaults the title', () => {
    const zero = startTimerSession('t', { title: '', durationMinutes: 0 }, NOW)
    expect(zero.plannedMs).toBe(MINUTE) // clamped up to the minimum
    expect(zero.title).toBe('Timer')

    const huge = startTimerSession('t', { title: '', durationMinutes: 99999 }, NOW)
    expect(huge.plannedMs).toBe(MAX_TIMER_MINUTES * MINUTE)
    expect(clampTimerMinutes(-5)).toBe(1)
    expect(clampTimerMinutes(Number.NaN)).toBe(1)
    expect(TIMER_PRESET_MINUTES).toContain(1)
    expect(TIMER_PRESET_MINUTES).toContain(60)
  })

  it('is a duplicate-start gate: a live timer is findable, a settled one is not', () => {
    // `liveTimerOf` is exactly what the engine's start() refuses on.
    const running = started()
    expect(liveTimerOf([running])).toBe(running)

    const cancelled = cancelTimerSession(running, NOW + 1000)
    expect(liveTimerOf([cancelled])).toBeNull()
  })
})

describe('pauseTimerSession', () => {
  it('captures the remainder and stops the clock', () => {
    const paused = pauseTimerSession(started(), NOW + 10 * MINUTE)
    expect(paused.status).toBe('paused')
    expect(paused.endsAt).toBeNull()
    expect(paused.remainingMs).toBe(15 * MINUTE)
    // The remaining time no longer depends on the clock.
    expect(timerRemainingMs(paused, NOW + 10 * MINUTE)).toBe(15 * MINUTE)
    expect(timerRemainingMs(paused, NOW + 3_000 * MINUTE)).toBe(15 * MINUTE)
  })

  it('completes instead of freezing at exactly zero', () => {
    const paused = pauseTimerSession(started(), NOW + 25 * MINUTE)
    expect(paused.status).toBe('completed')
    expect(paused.remainingMs).toBeNull()
    expect(paused.endedAt).toBe(NOW + 25 * MINUTE)
  })

  it('leaves a non-running timer alone', () => {
    const already = pauseTimerSession(started(), NOW)
    const again = pauseTimerSession(already, NOW)
    expect(again).toBe(already)
  })
})

describe('resumeTimerSession', () => {
  it('rebuilds the end from what was left', () => {
    const paused = pauseTimerSession(started(), NOW + 10 * MINUTE)
    const resumed = resumeTimerSession(paused, NOW + 40 * MINUTE)
    expect(resumed.status).toBe('running')
    expect(resumed.endsAt).toBe(NOW + 40 * MINUTE + 15 * MINUTE)
    expect(resumed.remainingMs).toBeNull()
    expect(timerRemainingMs(resumed, NOW + 40 * MINUTE)).toBe(15 * MINUTE)
  })

  it('completes when nothing was left to resume with', () => {
    const paused: TimerSession = {
      ...pauseTimerSession(started(), NOW + 10 * MINUTE),
      remainingMs: 0,
    }
    const resumed = resumeTimerSession(paused, NOW + 60 * MINUTE)
    expect(resumed.status).toBe('completed')
  })
})

describe('extendTimerSession', () => {
  it('extends a running timer by moving the end', () => {
    const timer = started()
    const extended = extendTimerSession(timer, 5)
    expect(extended.endsAt).toBe(NOW + 30 * MINUTE)
    expect(extended.plannedMs).toBe(30 * MINUTE)
    expect(extended.remainingMs).toBeNull()
    expect(timerRemainingMs(extended, NOW)).toBe(30 * MINUTE)
  })

  it('grows the frozen remainder of a paused timer', () => {
    const paused = pauseTimerSession(started(), NOW + 10 * MINUTE)
    const extended = extendTimerSession(paused, 1)
    expect(extended.status).toBe('paused')
    expect(extended.remainingMs).toBe(16 * MINUTE)
    expect(extended.endsAt).toBeNull()
  })

  it('clamps to the maximum total and rejects nonsense', () => {
    const nearMax = startTimerSession('t', { title: '', durationMinutes: MAX_TIMER_MINUTES }, NOW)
    expect(extendTimerSession(nearMax, 5).plannedMs).toBe(MAX_TIMER_MINUTES * MINUTE)
    expect(extendTimerSession(started(), 0)).toEqual(started())
    expect(extendTimerSession(started(), -3)).toEqual(started())
    expect(extendTimerSession(started(), Number.NaN)).toEqual(started())
  })

  it('leaves a settled timer unchanged', () => {
    const cancelled = cancelTimerSession(started(), NOW + 5 * MINUTE)
    expect(extendTimerSession(cancelled, 5)).toBe(cancelled)
    const completed = completeTimerSession(started(), NOW + 25 * MINUTE)
    expect(extendTimerSession(completed, 5)).toBe(completed)
  })
})

describe('cancel and complete', () => {
  it('settle with the same shape, different statuses', () => {
    const cancelled = cancelTimerSession(started(), NOW + 5 * MINUTE)
    expect(cancelled.status).toBe('cancelled')
    const completed = completeTimerSession(started(), NOW + 25 * MINUTE)
    expect(completed.status).toBe('completed')
    for (const settled of [cancelled, completed]) {
      expect(settled.endsAt).toBeNull()
      expect(settled.remainingMs).toBeNull()
      expect(settled.endedAt).not.toBeNull()
      expect(isLiveTimer(settled)).toBe(false)
      expect(timerRemainingMs(settled, NOW)).toBe(0)
    }
  })
})

describe('normalizeTimerSession', () => {
  it('drops rows with no usable id or start', () => {
    expect(normalizeTimerSession(null)).toBeNull()
    expect(normalizeTimerSession({ title: 'x' })).toBeNull()
    expect(normalizeTimerSession({ id: '', startedAt: NOW })).toBeNull()
    expect(normalizeTimerSession({ id: 't', startedAt: 'yesterday' })).toBeNull()
  })

  it('derives a missing end for a running row and repairs invariants', () => {
    const repaired = normalizeTimerSession({
      id: 't',
      title: '  ',
      plannedMs: 10 * MINUTE,
      startedAt: NOW,
      status: 'running',
      // no endsAt, and a stale remainingMs that running must not carry
      remainingMs: 42,
    })
    expect(repaired).not.toBeNull()
    expect(repaired?.endsAt).toBe(NOW + 10 * MINUTE)
    expect(repaired?.remainingMs).toBeNull()
    expect(repaired?.title).toBe('Timer')
  })

  it('repairs a paused row with no remainder and settles unknown statuses', () => {
    const paused = normalizeTimerSession({
      id: 't',
      plannedMs: 10 * MINUTE,
      startedAt: NOW,
      status: 'paused',
    })
    expect(paused?.remainingMs).toBe(0)

    const unknown = normalizeTimerSession({
      id: 't',
      plannedMs: 10 * MINUTE,
      startedAt: NOW,
      status: 'exploded',
    })
    expect(unknown?.status).toBe('cancelled')
  })

  it('keeps a well-formed row untouched apart from defaults', () => {
    const timer = started()
    const round = normalizeTimerSession(timer)
    expect(round).toEqual(timer)
  })
})
