/**
 * Run async operations one at a time, in call order.
 *
 * Everything the service worker does to storage is `read the whole key ->
 * modify -> write the whole key back`. That is only safe if two of them never
 * overlap: if a second handler reads before the first has written, it modifies
 * the stale array and its write erases the first one's change. Chrome gives no
 * such guarantee — two alarms due in the same minute, a notification button
 * pressed while a sweep runs, or two surfaces sending at once all arrive as
 * independent, concurrently-awaited callbacks.
 *
 * A queue is enough because the worker is single-threaded: once every entry
 * point (messages, alarms, notification actions, install, start-up) goes
 * through the same queue, no two read-modify-write pairs can interleave.
 *
 * Pure and self-contained so the ordering guarantee can be tested without
 * Chrome.
 */

/** Runs `operation` after everything queued before it has settled. */
export type Serialize = <R>(operation: () => Promise<R>) => Promise<R>

/**
 * A fresh queue.
 *
 * The returned function holds a reference to the tail of the chain — the one
 * piece of module-scope state the worker keeps, and deliberately not domain
 * state: it is a position in a queue, not data. If the worker is evicted the
 * chain goes with it, dropping whatever had not started, which is the same
 * failure the reconcilers already exist to repair.
 *
 * A failed operation does not stall the queue: the next one runs either way,
 * and each caller sees its own rejection.
 */
export function createSerialQueue(): Serialize {
  let tail: Promise<unknown> = Promise.resolve()

  return <R>(operation: () => Promise<R>): Promise<R> => {
    const result = tail.then(operation, operation)
    // Swallow here only — `result` keeps the rejection for the caller.
    tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
