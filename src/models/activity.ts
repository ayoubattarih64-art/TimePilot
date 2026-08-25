/**
 * Core domain types. These describe what TimePilot stores and passes around;
 * they intentionally contain no Chrome API references so they can be used from
 * the service worker and any UI surface alike.
 */

/** Milliseconds since the Unix epoch. */
export type Timestamp = number

/** A duration in milliseconds. */
export type DurationMs = number

/**
 * Fixed categorical slots, aligned with the design system's `--color-cat-*`
 * tokens. A seventh category folds into `other` rather than adding a hue.
 */
export type CategorySlot = 1 | 2 | 3 | 4 | 5 | 6 | 'other'

/** A user-defined grouping for activities ("Deep work", "Email", …). */
export type Category = {
  id: string
  name: string
  slot: CategorySlot
}
