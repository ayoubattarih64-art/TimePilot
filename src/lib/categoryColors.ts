import type { CategorySlot } from '../models'

/**
 * Background utilities for the fixed categorical slots. Declared as a literal map
 * rather than a template string so Tailwind's scanner sees every class name.
 */
export const CATEGORY_BG: Record<CategorySlot, string> = {
  1: 'bg-cat-1',
  2: 'bg-cat-2',
  3: 'bg-cat-3',
  4: 'bg-cat-4',
  5: 'bg-cat-5',
  6: 'bg-cat-6',
  other: 'bg-cat-other',
}
