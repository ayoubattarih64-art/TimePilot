/**
 * Pure countdown arithmetic.
 *
 * A countdown is stored as two absolute instants — when it began and when it is
 * due — never as a running number. That is what makes it survive everything the
 * platform does to us: the side panel closes, the service worker is evicted, the
 * browser restarts, and the remaining time is still correct because it is
 * recomputed from `endsAt` and the current clock rather than counted down.
 *
 * Nothing here touches Chrome, React, or storage, so it can be reasoned about on
 * its own and is equally usable by focus sessions today and by a general timer
 * later. `setInterval` belongs in the UI, to decide when to re-render; it is
 * never the source of truth.
 */

export const MINUTE_MS = 60_000

/** Milliseconds left until `endsAt`. Clamped at zero: never negative. */
export function remainingMs(endsAt: number, now: number = Date.now()): number {
  if (!Number.isFinite(endsAt)) return 0
  return Math.max(0, endsAt - now)
}

/** The instant a countdown of `durationMs` started at `startedAt` is due. */
export function endsAtFrom(startedAt: number, durationMs: number): number {
  return startedAt + Math.max(0, durationMs)
}
